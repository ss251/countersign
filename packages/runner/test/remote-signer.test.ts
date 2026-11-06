import { describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canonicalHash,
  canaryMessage,
  offerHash,
  publishMessage,
  runnerAuthMessage,
  slipBodyFor,
  slipTypedData,
  type JobOrder,
  type Offer,
} from "@countersign/core";
import { recoverMessageAddress, verifyTypedData, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { RunnerTypedData } from "../src/account.ts";
import { main } from "../src/cli.ts";
import { startRunner } from "../src/daemon.ts";
import {
  BONDED_REMOTE_REFUSAL,
  NOT_SIGNED_IN,
  remoteAccountFromSession,
  remoteRunnerAccount,
  type RemoteRunnerAccount,
} from "../src/remote-signer.ts";
import { readSkill, skillOffer } from "../src/skill.ts";

const SESSION = "cs_test_session_7c1f9a2e4b6d8f0";
const FIXTURE = join(import.meta.dir, "fixtures", "SKILL.md");
const BUYER = "0x2222222222222222222222222222222222222222" as Address;
const ESCROW = "0x4444444444444444444444444444444444444444" as Address;
const OTHER = "0x5555555555555555555555555555555555555555" as Address;
const ASSET = "0x3600000000000000000000000000000000000000" as Address;
const NOW = 1_700_000_000;

type Mode = "ok" | "mismatch" | "forged" | "401" | "403" | "502" | "500";

type SignBody =
  | { kind: "message"; message: string }
  | {
      kind: "typed-data";
      typedData: {
        domain?: unknown;
        types: Record<string, readonly { name: string; type: string }[]>;
        primaryType: string;
        message: Record<string, unknown>;
      };
    };

interface RecordedRequest {
  method: string;
  path: string;
  authorization: string | null;
  body: unknown;
}

interface Hub {
  url: string;
  address: Address;
  requests: RecordedRequest[];
  stop(): void;
}

function startHub(mode: Mode = "ok"): Hub {
  const account = privateKeyToAccount(generatePrivateKey());
  const requests: RecordedRequest[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const authorization = request.headers.get("authorization");
      const record: RecordedRequest = {
        method: request.method,
        path: url.pathname,
        authorization,
        body: undefined,
      };
      requests.push(record);

      if (url.pathname.startsWith("/cli/") && authorization !== `Bearer ${SESSION}`) {
        return Response.json({ code: "not-signed-in", message: NOT_SIGNED_IN }, { status: 401 });
      }
      if (request.method === "GET" && url.pathname === "/cli/session") {
        if (mode === "401") {
          return Response.json({ code: "not-signed-in", message: NOT_SIGNED_IN }, { status: 401 });
        }
        if (mode === "500") return Response.json({ code: "boom" }, { status: 500 });
        return Response.json({ address: account.address, expiresAt: NOW + 3600 });
      }
      if (request.method === "POST" && url.pathname === "/cli/sign") {
        const body = (await request.json().catch(() => ({ kind: "message", message: "" }))) as SignBody;
        record.body = body;
        if (mode === "401") {
          return Response.json({ code: "not-signed-in", message: NOT_SIGNED_IN }, { status: 401 });
        }
        if (mode === "403") return Response.json({ code: "envelope-closed" }, { status: 403 });
        if (mode === "502") return Response.json({ code: "privy-failed" }, { status: 502 });
        if (mode === "500") return Response.json({ code: "boom" }, { status: 500 });

        // "forged": the right address, but a signature made by another key.
        const signature = await signBody(mode === "forged" ? privateKeyToAccount(generatePrivateKey()) : account, body);
        return Response.json({
          signature,
          address: mode === "mismatch" ? OTHER : account.address,
        });
      }
      if (request.method === "POST" && url.pathname === "/offers") {
        const body = (await request.json()) as { offer: Offer; sig: Hex };
        record.body = body;
        return Response.json({ offerHash: offerHash(body.offer) });
      }
      return new Response("not found", { status: 404 });
    },
  });

  return {
    url: `http://127.0.0.1:${server.port}`,
    address: account.address,
    requests,
    stop: () => server.stop(true),
  };
}

/** Sign the way the hub does: uint values arrive as decimal strings and are revived first. */
async function signBody(
  account: ReturnType<typeof privateKeyToAccount>,
  body: SignBody,
): Promise<Hex> {
  if (body.kind === "message") return account.signMessage({ message: body.message });
  const fields = body.typedData.types[body.typedData.primaryType] ?? [];
  const message: Record<string, unknown> = { ...body.typedData.message };
  for (const field of fields) {
    const value = message[field.name];
    if (/^u?int\d*$/.test(field.type) && typeof value === "string") {
      message[field.name] = BigInt(value);
    }
  }
  return account.signTypedData({
    domain: body.typedData.domain,
    types: body.typedData.types,
    primaryType: body.typedData.primaryType,
    message,
  } as never);
}

function remoteFor(hub: Hub, hubUrl: string = hub.url): RemoteRunnerAccount {
  return remoteRunnerAccount({ hubUrl, session: SESSION, address: hub.address });
}

function slipFixture(seller: Address) {
  const order: JobOrder = {
    jobId: `0x${"ab".repeat(32)}`,
    offerHash: `0x${"cd".repeat(32)}`,
    input: { question: "what is arc?" },
    rail: "escrow",
    network: "eip155:5042002",
    buyer: BUYER,
    payTo: seller,
    asset: ASSET,
    amount: "1000",
    deadline: NOW + 120,
    escrow: ESCROW,
    chainId: 5042002,
    lineage: [],
  };
  return slipBodyFor(
    order,
    seller,
    canonicalHash(order.input),
    canonicalHash({ answer: "arc" }),
    NOW + 1,
  );
}

async function offerWithBond(seller: Address, bond: string): Promise<Offer> {
  const skill = await readSkill(FIXTURE);
  const offer = skillOffer({
    seller,
    skill,
    price: "1000",
    deadline: 120,
    rails: ["escrow"],
    now: NOW,
  });
  return bond === "0" ? offer : { ...offer, bond, reviewWindow: 60 };
}

function stateDir(): string {
  return mkdtempSync(join(tmpdir(), "cs-remote-signer-"));
}

async function withEnv<T>(
  vars: Record<string, string | undefined>,
  run: () => Promise<T>,
): Promise<T> {
  const saved = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(vars)) {
    saved.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function signRequests(hub: Hub): RecordedRequest[] {
  return hub.requests.filter((request) => request.path === "/cli/sign");
}

describe("remote signer", () => {
  test("the hello signature is made by the hub over the runner challenge", async () => {
    const hub = startHub();
    try {
      const account = remoteFor(hub);
      const nonce = "0123456789abcdef0123456789abcdef";
      const message = runnerAuthMessage(nonce);
      const signature = await account.signMessage({ message });

      expect(account.kind).toBe("remote");
      expect(account.address).toBe(hub.address);
      expect(
        (
          await recoverMessageAddress({ message, signature })
        ).toLowerCase(),
      ).toBe(hub.address.toLowerCase());

      const sent = signRequests(hub);
      expect(sent).toHaveLength(1);
      expect(sent[0]?.authorization).toBe(`Bearer ${SESSION}`);
      expect(sent[0]?.body).toEqual({ kind: "message", message });
    } finally {
      hub.stop();
    }
  });

  test("the canary answer is made by the hub over the canary message", async () => {
    const hub = startHub();
    try {
      const account = remoteFor(hub);
      const hash = `0x${"12".repeat(32)}` as Hex;
      const nonce = "fedcba9876543210fedcba9876543210";
      const message = canaryMessage(hash, nonce);
      const signature = await account.signMessage({ message });

      expect(
        (
          await recoverMessageAddress({ message, signature })
        ).toLowerCase(),
      ).toBe(hub.address.toLowerCase());

      const sent = signRequests(hub);
      expect(sent).toHaveLength(1);
      expect(sent[0]?.authorization).toBe(`Bearer ${SESSION}`);
      expect(sent[0]?.body).toEqual({ kind: "message", message });
    } finally {
      hub.stop();
    }
  });

  test("a slip Release is signed by the hub and verifies against slipTypedData", async () => {
    const hub = startHub();
    try {
      const account = remoteFor(hub);
      const body = slipFixture(hub.address);
      const typedData = slipTypedData(body);
      const signature = await account.signTypedData(typedData);

      expect(await verifyTypedData({ ...typedData, signature, address: hub.address })).toBe(true);

      const sent = signRequests(hub);
      expect(sent).toHaveLength(1);
      expect(sent[0]?.authorization).toBe(`Bearer ${SESSION}`);
      expect(sent[0]?.body).toEqual({ kind: "typed-data", typedData });
    } finally {
      hub.stop();
    }
  });

  test("typed data bigints travel as decimal strings", async () => {
    const hub = startHub();
    try {
      const account = remoteFor(hub);
      const typedData = {
        domain: { name: "Countersign", version: "1", chainId: 5042002 },
        types: { Amount: [{ name: "amount", type: "uint256" }] },
        primaryType: "Amount",
        message: { amount: 12345678901234567890n },
      } as const;
      const signature = await account.signTypedData(typedData as unknown as RunnerTypedData);

      expect(await verifyTypedData({ ...typedData, signature, address: hub.address })).toBe(true);
      expect((signRequests(hub)[0]?.body as SignBody & { kind: "typed-data" }).typedData.message).toEqual({
        amount: "12345678901234567890",
      });
    } finally {
      hub.stop();
    }
  });

  test("a signature from another wallet is refused", async () => {
    const hub = startHub("mismatch");
    try {
      const account = remoteFor(hub);
      await expect(account.signMessage({ message: "countersign runner nonce" })).rejects.toThrow(
        "The hub signed with a different wallet.",
      );
    } finally {
      hub.stop();
    }
  });

  test("401 is the not-signed-in message", async () => {
    const hub = startHub("401");
    try {
      await expect(remoteFor(hub).signMessage({ message: "hello" })).rejects.toThrow(
        NOT_SIGNED_IN,
      );
    } finally {
      hub.stop();
    }
  });

  test("403 carries the hub's code", async () => {
    const hub = startHub("403");
    try {
      await expect(remoteFor(hub).signMessage({ message: "hello" })).rejects.toThrow(
        "The hub refused to sign this: envelope-closed",
      );
    } finally {
      hub.stop();
    }
  });

  test("502 is the privy-failed sentence", async () => {
    const hub = startHub("502");
    try {
      await expect(remoteFor(hub).signMessage({ message: "hello" })).rejects.toThrow(
        "The hub could not sign right now (privy-failed).",
      );
    } finally {
      hub.stop();
    }
  });

  test("another status is reported by number", async () => {
    const hub = startHub("500");
    try {
      await expect(remoteFor(hub).signMessage({ message: "hello" })).rejects.toThrow(
        "The hub could not sign right now (500).",
      );
    } finally {
      hub.stop();
    }
  });

  test("a hub that is down is unreachable", async () => {
    const hub = startHub();
    const url = hub.url;
    hub.stop();
    await expect(remoteFor(hub, url).signMessage({ message: "hello" })).rejects.toThrow(
      "The hub could not sign right now (unreachable).",
    );
  });

  test("the session supplies the address and trailing slashes are stripped", async () => {
    const hub = startHub();
    try {
      const account = await remoteAccountFromSession({ hubUrl: `${hub.url}///`, session: SESSION });
      expect(account.kind).toBe("remote");
      expect(account.address).toBe(hub.address);

      const session = hub.requests.find((request) => request.path === "/cli/session");
      expect(session?.authorization).toBe(`Bearer ${SESSION}`);

      const signature = await account.signMessage({ message: "hello" });
      expect(
        (
          await recoverMessageAddress({ message: "hello", signature })
        ).toLowerCase(),
      ).toBe(hub.address.toLowerCase());
    } finally {
      hub.stop();
    }
  });

  test("a 401 from the session route is the not-signed-in message", async () => {
    const hub = startHub("401");
    try {
      await expect(
        remoteAccountFromSession({ hubUrl: hub.url, session: SESSION }),
      ).rejects.toThrow(NOT_SIGNED_IN);
    } finally {
      hub.stop();
    }
  });
});

describe("what the remote signer trusts", () => {
  test("a 200 naming the session wallet but signed by another key is refused, message and typed data", async () => {
    const hub = startHub("forged");
    try {
      const account = await remoteAccountFromSession({ hubUrl: hub.url, session: SESSION });
      await expect(account.signMessage({ message: "countersign runner 0x01" })).rejects.toThrow(
        "The hub signed with a different wallet.",
      );
      await expect(account.signTypedData(slipTypedData(slipFixture(account.address)))).rejects.toThrow(
        "The hub signed with a different wallet.",
      );
    } finally {
      hub.stop();
    }
  });

  test("the session token is never sent to a plain http hub other than this machine", async () => {
    let called = 0;
    const spy = (async () => {
      called += 1;
      return new Response("{}");
    }) as unknown as typeof fetch;
    await expect(
      remoteAccountFromSession({ hubUrl: "http://evil.example", session: SESSION, fetch: spy }),
    ).rejects.toThrow("The session is sent only to an https hub.");
    expect(() =>
      remoteRunnerAccount({ hubUrl: "http://evil.example/", session: SESSION, address: OTHER, fetch: spy }),
    ).toThrow("The session is sent only to an https hub.");
    expect(called).toBe(0);
  });
});

describe("the seller CLI's account precedence", () => {
  test("CS_SELLER_KEY wins even when CS_SESSION is set", async () => {
    const hub = startHub();
    const key = generatePrivateKey();
    const local = privateKeyToAccount(key);
    const log = spyOn(console, "log").mockImplementation(() => undefined);
    try {
      await withEnv(
        { CS_SELLER_KEY: key, CS_SESSION: SESSION, CS_HUB: hub.url },
        async () => {
          await main([
            "publish",
            "--hub",
            hub.url,
            "--skill",
            FIXTURE,
            "--price",
            "1000",
            "--state",
            stateDir(),
          ]);
          // Dropped even on the override's path: nothing this process starts later can see it.
          expect(process.env.CS_SESSION).toBeUndefined();
        },
      );

      const published = hub.requests.filter((request) => request.path === "/offers");
      expect(published).toHaveLength(1);
      expect((published[0]?.body as { offer: Offer }).offer.seller).toBe(local.address);
      expect(signRequests(hub)).toHaveLength(0);
      expect(hub.requests.some((request) => request.path === "/cli/session")).toBe(false);
    } finally {
      log.mockRestore();
      hub.stop();
    }
  });

  test("CS_SESSION signs publish through CS_HUB", async () => {
    const sessionHub = startHub();
    const target = startHub();
    const log = spyOn(console, "log").mockImplementation(() => undefined);
    try {
      await withEnv(
        { CS_SELLER_KEY: undefined, CS_SESSION: SESSION, CS_HUB: sessionHub.url },
        async () => {
          await main([
            "publish",
            "--hub",
            target.url,
            "--skill",
            FIXTURE,
            "--price",
            "1000",
            "--state",
            stateDir(),
          ]);
          // Read once and dropped: nothing this process starts later can see the token.
          expect(process.env.CS_SESSION).toBeUndefined();
        },
      );

      expect(signRequests(target)).toHaveLength(0);
      expect(sessionHub.requests.some((request) => request.path === "/cli/session")).toBe(true);
      const signed = signRequests(sessionHub);
      expect(signed).toHaveLength(1);

      const published = target.requests.find((request) => request.path === "/offers");
      const body = published?.body as { offer: Offer; sig: Hex };
      expect(body.offer.seller).toBe(sessionHub.address);
      expect(
        (
          await recoverMessageAddress({
            message: publishMessage(offerHash(body.offer)),
            signature: body.sig,
          })
        ).toLowerCase(),
      ).toBe(sessionHub.address.toLowerCase());
      expect(signed[0]?.body).toEqual({
        kind: "message",
        message: publishMessage(offerHash(body.offer)),
      });
    } finally {
      log.mockRestore();
      sessionHub.stop();
      target.stop();
    }
  });

  test("without CS_HUB the session is checked against the hub the command targets", async () => {
    const hub = startHub();
    const log = spyOn(console, "log").mockImplementation(() => undefined);
    try {
      await withEnv(
        { CS_SELLER_KEY: undefined, CS_SESSION: SESSION, CS_HUB: undefined },
        () =>
          main([
            "publish",
            "--hub",
            hub.url,
            "--skill",
            FIXTURE,
            "--price",
            "1000",
            "--state",
            stateDir(),
          ]),
      );

      expect(hub.requests.some((request) => request.path === "/cli/session")).toBe(true);
      const published = hub.requests.find((request) => request.path === "/offers");
      expect((published?.body as { offer: Offer }).offer.seller).toBe(hub.address);
    } finally {
      log.mockRestore();
      hub.stop();
    }
  });

  test("with no key and no session the CLI asks the person to log in", async () => {
    const hub = startHub();
    try {
      await expect(
        withEnv({ CS_SELLER_KEY: undefined, CS_SESSION: undefined, CS_HUB: undefined }, () =>
          main([
            "publish",
            "--hub",
            hub.url,
            "--skill",
            FIXTURE,
            "--price",
            "1000",
            "--state",
            stateDir(),
          ]),
        ),
      ).rejects.toThrow(NOT_SIGNED_IN);
      expect(hub.requests).toHaveLength(0);
    } finally {
      hub.stop();
    }
  });
});

describe("bonded offers on a remote account", () => {
  test("a bonded offer is refused with the Lock message", async () => {
    const hub = startHub();
    try {
      const account = remoteFor(hub);
      const offer = await offerWithBond(hub.address, "100");
      expect(() =>
        startRunner({
          hubUrl: hub.url,
          account,
          served: [{ offer, spec: { adapter: "skill", skillPath: FIXTURE } }],
        }),
      ).toThrow(BONDED_REMOTE_REFUSAL);
    } finally {
      hub.stop();
    }
  });

  test("an unbonded offer serves normally", async () => {
    const hub = startHub();
    try {
      const account = remoteFor(hub);
      const offer = await offerWithBond(hub.address, "0");
      const handle = startRunner({
        hubUrl: hub.url,
        account,
        served: [{ offer, spec: { adapter: "skill", skillPath: FIXTURE } }],
      });
      handle.stop();
    } finally {
      hub.stop();
    }
  });
});

describe("redaction", () => {
  test("the session token appears in no error and no console output", async () => {
    const printed: string[] = [];
    const errors: string[] = [];
    const spies = [
      spyOn(console, "log"),
      spyOn(console, "info"),
      spyOn(console, "warn"),
      spyOn(console, "error"),
      spyOn(console, "debug"),
    ];
    for (const spy of spies) {
      spy.mockImplementation((...args: unknown[]) => {
        printed.push(args.map((arg) => String(arg)).join(" "));
      });
    }

    try {
      for (const mode of ["ok", "mismatch", "401", "403", "502", "500"] as const) {
        const hub = startHub(mode);
        try {
          const account = remoteFor(hub);
          try {
            await account.signMessage({ message: "countersign runner redaction" });
          } catch (error) {
            errors.push(error instanceof Error ? error.message : String(error));
          }
          try {
            const fromSession = await remoteAccountFromSession({
              hubUrl: hub.url,
              session: SESSION,
            });
            await fromSession.signMessage({ message: "countersign canary redaction" });
          } catch (error) {
            errors.push(error instanceof Error ? error.message : String(error));
          }
        } finally {
          hub.stop();
        }
      }

      expect(errors.length).toBeGreaterThan(0);
      expect(errors.join("\n")).not.toContain(SESSION);
      expect(printed.join("\n")).not.toContain(SESSION);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});
