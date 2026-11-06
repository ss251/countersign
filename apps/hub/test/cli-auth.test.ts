import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { recoverMessageAddress, recoverTypedDataAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createHub, type HubDeps } from "../src/app.ts";
import { CliAuthStore } from "../src/cli-auth/store.ts";
import type { Envelope, ErrorBody } from "../src/deps.ts";
import { PRIVY_HEADER, PrivySessionError, type Person, type PrivyVerifier } from "../src/privy.ts";
import { Store } from "../src/store.ts";
import {
  privyWalletApi,
  type TypedDataInput,
  type WalletApi,
} from "../src/wallets/privy-wallets.ts";
import { ESCROW, FakeRail } from "./fake-rail.ts";
import { NOW } from "./support.ts";

const CLI_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const CLI = privateKeyToAccount(CLI_KEY);
const ADDRESS = CLI.address.toLowerCase();
const USDC = "0x3600000000000000000000000000000000000000";
const CHAIN_ID = 5042002;
const NON_ESCROW = `0x${"22".repeat(20)}`;
const OTHER_ADDRESS = `0x${"33".repeat(20)}`;
const NOT_SIGNED_IN = "Not signed in. Run: npx -y @countersign-hub/cli login";

const verifier: PrivyVerifier = {
  async verify(token: string): Promise<Person> {
    if (token === "alice") return { userId: "did:privy:alice", wallets: [] };
    if (token === "bob") return { userId: "did:privy:bob", wallets: [] };
    throw new PrivySessionError("nope");
  },
};

interface WalletCalls {
  created: string[];
  found: string[];
  typed: Array<{ walletId: string; typed: TypedDataInput }>;
  messages: Array<{ walletId: string; message: string }>;
}

type FakeWallet = WalletApi & { calls: WalletCalls };

function fakeWallet(options: { found?: { id: string; address: string } } = {}): FakeWallet {
  const calls: WalletCalls = { created: [], found: [], typed: [], messages: [] };
  let serial = 0;
  return {
    calls,
    async createWallet(externalId) {
      calls.created.push(externalId);
      serial += 1;
      return { id: `privy-wallet-${serial}`, address: ADDRESS };
    },
    async findWallet(externalId) {
      calls.found.push(externalId);
      return options.found ?? null;
    },
    async signTypedData(walletId, typed) {
      calls.typed.push({ walletId, typed });
      return CLI.signTypedData({
        domain: typed.domain,
        types: typed.types,
        primaryType: typed.primaryType,
        message: typed.message,
      } as never);
    },
    async personalSign(walletId, message) {
      calls.messages.push({ walletId, message });
      return CLI.signMessage({ message });
    },
  };
}

interface TestHub {
  url: string;
  store: Store;
  cliStore: CliAuthStore;
  rail: FakeRail;
  wallets: FakeWallet;
  setNow: (at: number) => void;
  close: () => void;
}

let hubs: TestHub[] = [];
let captured: string[] = [];
let secrets = new Set<string>();
let originalLog: typeof console.log;
let originalError: typeof console.error;

beforeEach(() => {
  captured = [];
  secrets = new Set();
  originalLog = console.log;
  originalError = console.error;
  console.log = ((...args: unknown[]) => {
    captured.push(args.map((arg) => String(arg)).join(" "));
  }) as typeof console.log;
  console.error = ((...args: unknown[]) => {
    captured.push(args.map((arg) => String(arg)).join(" "));
  }) as typeof console.error;
});

afterEach(() => {
  console.log = originalLog;
  console.error = originalError;
  for (const hub of hubs) hub.close();
  hubs = [];
  for (const line of captured) {
    for (const secret of secrets) {
      expect(line.includes(secret)).toBe(false);
    }
  }
});

function remember(secret: string): void {
  secrets.add(secret);
}

function startCliHub(options: { found?: { id: string; address: string } } = {}): TestHub {
  const store = new Store(":memory:");
  const wallets = fakeWallet(options);
  const cliStore = new CliAuthStore(":memory:");
  const rail = new FakeRail("escrow");
  let now = NOW;
  const deps: HubDeps = {
    store,
    rails: [rail],
    now: () => now,
    publicUrl: "http://hub.test",
    privy: verifier,
    cliAuth: {
      store: cliStore,
      wallets,
      consoleUrl: "https://console.test",
    },
  };
  const { app, websocket, runners } = createHub(deps);
  const server = Bun.serve({
    port: 0,
    fetch: (request, bunServer) => app.fetch(request, bunServer),
    websocket,
  });
  const hub: TestHub = {
    url: `http://127.0.0.1:${server.port}`,
    store,
    cliStore,
    rail,
    wallets,
    setNow: (at) => {
      now = at;
    },
    close: () => {
      runners.stop();
      server.stop(true);
    },
  };
  hubs.push(hub);
  return hub;
}

function postJson(
  hub: TestHub,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${hub.url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

interface StartedLogin {
  code: string;
  deviceSecret: string;
  verifyUrl: string;
  interval: number;
  expiresAt: number;
}

interface IssuedSession {
  code: string;
  deviceSecret: string;
  token: string;
  address: string;
  expiresAt: number;
}

async function startLogin(hub: TestHub): Promise<StartedLogin> {
  const response = await postJson(hub, "/cli/login/start", {});
  expect(response.status).toBe(200);
  const started = (await response.json()) as StartedLogin;
  remember(started.deviceSecret);
  return started;
}

async function login(hub: TestHub): Promise<IssuedSession> {
  const started = await startLogin(hub);
  const pending = await postJson(hub, "/cli/login/poll", { deviceSecret: started.deviceSecret });
  expect(pending.status).toBe(200);
  expect(await pending.json()).toEqual({ status: "pending" });

  const approved = await postJson(
    hub,
    "/cli/login/approve",
    { code: started.code },
    { [PRIVY_HEADER]: "alice" },
  );
  expect(approved.status).toBe(200);

  const polled = await postJson(hub, "/cli/login/poll", { deviceSecret: started.deviceSecret });
  expect(polled.status).toBe(200);
  const session = (await polled.json()) as {
    status: string;
    sessionToken: string;
    address: string;
    expiresAt: number;
  };
  expect(session.status).toBe("approved");
  expect(session.address).toBe(ADDRESS);
  expect(session.expiresAt).toBe(NOW + 604_800);
  remember(session.sessionToken);
  return {
    code: started.code,
    deviceSecret: started.deviceSecret,
    token: session.sessionToken,
    address: session.address,
    expiresAt: session.expiresAt,
  };
}

function buyerTyped(
  overrides: {
    chainId?: number;
    token?: string;
    from?: string;
    to?: string;
    value?: string;
    primaryType?: string;
  } = {},
): TypedDataInput {
  return {
    domain: {
      name: "USD Coin",
      version: "2",
      chainId: overrides.chainId ?? CHAIN_ID,
      verifyingContract: overrides.token ?? USDC,
    },
    types: {
      ReceiveWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: overrides.primaryType ?? "ReceiveWithAuthorization",
    message: {
      from: overrides.from ?? ADDRESS,
      to: overrides.to ?? ESCROW,
      value: overrides.value ?? "10000",
      validAfter: "0",
      validBefore: "9999999999",
      nonce: `0x${"ab".repeat(32)}`,
    },
  };
}

function releaseTyped(overrides: { escrow?: string; chainId?: number } = {}): TypedDataInput {
  return {
    domain: {
      name: "Countersign",
      version: "1",
      chainId: overrides.chainId ?? CHAIN_ID,
      verifyingContract: overrides.escrow ?? ESCROW,
    },
    types: {
      Release: [
        { name: "jobId", type: "bytes32" },
        { name: "slipHash", type: "bytes32" },
      ],
    },
    primaryType: "Release",
    message: {
      jobId: `0x${"11".repeat(32)}`,
      slipHash: `0x${"22".repeat(32)}`,
    },
  };
}

function signTyped(hub: TestHub, token: string, typedData: TypedDataInput): Promise<Response> {
  return postJson(hub, "/cli/sign", { kind: "typed-data", typedData }, bearer(token));
}

function signMessage(hub: TestHub, token: string, message: string): Promise<Response> {
  return postJson(hub, "/cli/sign", { kind: "message", message }, bearer(token));
}

async function recoverTyped(typed: TypedDataInput, signature: string): Promise<string> {
  return recoverTypedDataAddress({
    domain: typed.domain,
    types: typed.types,
    primaryType: typed.primaryType,
    message: typed.message,
    signature: signature as Hex,
  } as never);
}

function seedEnvelope(hub: TestHub, address: string, overrides: Partial<Envelope> = {}): void {
  const envelope: Envelope = {
    v: 1,
    agent: address as Address,
    cap: "5000000",
    perMerchant: "1000000",
    allowlist: [],
    revoked: false,
    askAbove: "100000",
    ...overrides,
  };
  hub.store.putEnvelopeMirror({
    agent: address,
    envelope,
    spent: { total: "0", bySeller: {} },
    signedAt: NOW,
    sig: "0x",
  });
}

describe("the CLI device flow", () => {
  test("start, pending poll, approve, then one approved poll", async () => {
    const hub = startCliHub();
    const started = await startLogin(hub);
    expect(started.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(started.deviceSecret).toMatch(/^csd_[0-9a-f]{64}$/);
    expect(started.verifyUrl).toBe(`https://console.test/#/cli-login?code=${started.code}`);
    expect(started.interval).toBe(3);
    expect(started.expiresAt).toBe(NOW + 600);

    const pending = await postJson(hub, "/cli/login/poll", { deviceSecret: started.deviceSecret });
    expect(pending.status).toBe(200);
    expect(await pending.json()).toEqual({ status: "pending" });

    const anonymous = await postJson(hub, "/cli/login/approve", { code: started.code });
    expect(anonymous.status).toBe(401);
    expect(((await anonymous.json()) as ErrorBody).code).toBe("sign-in-required");

    const approved = await postJson(
      hub,
      "/cli/login/approve",
      { code: started.code },
      { [PRIVY_HEADER]: "alice" },
    );
    expect(approved.status).toBe(200);
    expect(await approved.json()).toEqual({ code: started.code, address: ADDRESS });
    expect(hub.wallets.calls.created).toHaveLength(1);
    expect(hub.wallets.calls.created[0]).toMatch(/^cs_[0-9a-f]{40}$/);

    const polled = await postJson(hub, "/cli/login/poll", { deviceSecret: started.deviceSecret });
    expect(polled.status).toBe(200);
    const session = (await polled.json()) as {
      status: string;
      sessionToken: string;
      address: string;
      expiresAt: number;
    };
    expect(session.status).toBe("approved");
    expect(session.sessionToken).toMatch(/^css_[0-9a-f]{64}$/);
    expect(session.address).toBe(ADDRESS);
    expect(session.expiresAt).toBe(NOW + 604_800);
    remember(session.sessionToken);

    const second = await postJson(hub, "/cli/login/poll", { deviceSecret: started.deviceSecret });
    expect(second.status).toBe(410);
    expect(((await second.json()) as ErrorBody).code).toBe("used");
  });

  test("a lost wallet mapping finds the Privy wallet by external id instead of creating one", async () => {
    const hub = startCliHub({ found: { id: "w-existing", address: ADDRESS } });
    const session = await login(hub);

    expect(session.address).toBe(ADDRESS);
    expect(hub.wallets.calls.created).toHaveLength(0);
    expect(hub.wallets.calls.found).toHaveLength(1);
    expect(hub.wallets.calls.found[0]).toMatch(/^cs_[0-9a-f]{40}$/);
  });

  test("a code approves once", async () => {
    const hub = startCliHub();
    const started = await startLogin(hub);

    const first = await postJson(
      hub,
      "/cli/login/approve",
      { code: started.code },
      { [PRIVY_HEADER]: "alice" },
    );
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ code: started.code, address: ADDRESS });

    const second = await postJson(
      hub,
      "/cli/login/approve",
      { code: started.code },
      { [PRIVY_HEADER]: "bob" },
    );
    expect(second.status).toBe(409);
    expect(((await second.json()) as ErrorBody).code).toBe("already-approved");
    expect(hub.wallets.calls.created).toHaveLength(1);

    const polled = await postJson(hub, "/cli/login/poll", { deviceSecret: started.deviceSecret });
    expect(polled.status).toBe(200);
    const session = (await polled.json()) as { status: string; sessionToken: string; address: string };
    expect(session.status).toBe("approved");
    expect(session.address).toBe(ADDRESS);
    remember(session.sessionToken);

    const stored = hub.cliStore.getSession(
      createHash("sha256").update(session.sessionToken).digest("hex"),
    );
    expect(stored?.userId).toBe("did:privy:alice");
    expect(stored?.walletId).toBe("privy-wallet-1");
  });
});

describe("the Privy wallet API", () => {
  test("createWallet sends only fields Privy accepts", async () => {
    const requests: Array<{ url: string; method: string; headers: Headers; body: string }> = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? "GET";
      requests.push({
        url,
        method,
        headers: new Headers(init?.headers),
        body: typeof init?.body === "string" ? init.body : "",
      });
      if (method === "GET") {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "w1",
                address: "0xABCDEF0123456789abcdef0123456789ABCDEF01",
                chain_type: "ethereum",
                external_id: "cs_x",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ id: "w1", address: "0x1111111111111111111111111111111111111111" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const api = privyWalletApi("app", "secret", { fetchImpl });
    const created = await api.createWallet("cs_x");
    expect(created).toEqual({ id: "w1", address: "0x1111111111111111111111111111111111111111" });

    const plain = requests[0]!;
    expect(plain.method).toBe("POST");
    expect(plain.url).toBe("https://api.privy.io/v1/wallets");
    expect(Object.keys(JSON.parse(plain.body) as Record<string, unknown>).sort()).toEqual([
      "chain_type",
      "external_id",
    ]);
    expect(plain.headers.get("content-type")).toBe("application/json");
    for (const name of plain.headers.keys()) {
      expect(name.toLowerCase().includes("idempotency")).toBe(false);
    }

    const withPolicy = privyWalletApi("app", "secret", { policyId: "p1", fetchImpl });
    await withPolicy.createWallet("cs_x");

    const policy = requests[1]!;
    const policyBody = JSON.parse(policy.body) as Record<string, unknown>;
    expect(Object.keys(policyBody).sort()).toEqual(["chain_type", "external_id", "policy_ids"]);
    expect(policyBody.policy_ids).toEqual(["p1"]);
    for (const name of policy.headers.keys()) {
      expect(name.toLowerCase().includes("idempotency")).toBe(false);
    }

    expect(await api.findWallet("cs_x")).toEqual({
      id: "w1",
      address: "0xabcdef0123456789abcdef0123456789abcdef01",
    });
    expect(await api.findWallet("cs_y")).toBeNull();

    const lookup = requests[2]!;
    expect(lookup.method).toBe("GET");
    expect(lookup.url).toContain("external_id=cs_x");
    expect(lookup.headers.get("content-type")).toBeNull();
  });
});

describe("CLI sessions", () => {
  test("a session reads, logs out, and expires", async () => {
    const hub = startCliHub();
    const session = await login(hub);

    const read = await fetch(`${hub.url}/cli/session`, { headers: bearer(session.token) });
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual({ address: ADDRESS, expiresAt: session.expiresAt });

    const loggedOut = await postJson(hub, "/cli/logout", {}, bearer(session.token));
    expect(loggedOut.status).toBe(200);
    expect(await loggedOut.json()).toEqual({ revoked: true });

    const afterLogout = await fetch(`${hub.url}/cli/session`, { headers: bearer(session.token) });
    expect(afterLogout.status).toBe(401);
    const refused = (await afterLogout.json()) as ErrorBody;
    expect(refused.code).toBe("not-signed-in");
    expect(refused.message).toBe(NOT_SIGNED_IN);

    const fresh = await login(hub);
    hub.setNow(NOW + 604_801);
    const expired = await fetch(`${hub.url}/cli/session`, { headers: bearer(fresh.token) });
    expect(expired.status).toBe(401);
    expect(((await expired.json()) as ErrorBody).code).toBe("not-signed-in");
  });
});

describe("CLI signing", () => {
  test("a buyer authorization is signed and recovers to the session wallet", async () => {
    const hub = startCliHub();
    const session = await login(hub);
    const typed = buyerTyped();

    const response = await signTyped(hub, session.token, typed);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { signature: string; address: string };
    expect(body.address).toBe(ADDRESS);
    remember(body.signature);
    expect((await recoverTyped(typed, body.signature)).toLowerCase()).toBe(ADDRESS);
    expect(hub.wallets.calls.typed).toHaveLength(1);
    expect(hub.wallets.calls.typed[0]?.walletId).toBe("privy-wallet-1");
  });

  test("unsafe buyer authorizations are refused before Privy is called", async () => {
    const hub = startCliHub();
    const session = await login(hub);

    const cases: Array<{ typed: TypedDataInput; reason: string }> = [
      { typed: buyerTyped({ primaryType: "Transfer" }), reason: "type" },
      { typed: buyerTyped({ token: `0x${"11".repeat(20)}` }), reason: "token" },
      { typed: buyerTyped({ chainId: 1 }), reason: "token" },
      { typed: buyerTyped({ to: NON_ESCROW }), reason: "escrow" },
      { typed: buyerTyped({ from: OTHER_ADDRESS }), reason: "from" },
      { typed: buyerTyped({ value: "2000000" }), reason: "value" },
    ];

    for (const entry of cases) {
      const before = hub.wallets.calls.typed.length;
      const response = await signTyped(hub, session.token, entry.typed);
      expect(response.status).toBe(403);
      const body = (await response.json()) as ErrorBody & { reason?: string };
      expect(body.code).toBe("not-allowed");
      expect(body.reason).toBe(entry.reason);
      expect(hub.wallets.calls.typed).toHaveLength(before);
    }
  });

  test("an envelope perMerchant caps the buyer authorization", async () => {
    const hub = startCliHub();
    const session = await login(hub);
    seedEnvelope(hub, session.address, { perMerchant: "5000" });

    const response = await signTyped(hub, session.token, buyerTyped({ value: "10000" }));
    expect(response.status).toBe(403);
    const body = (await response.json()) as ErrorBody & { reason?: string };
    expect(body.code).toBe("not-allowed");
    expect(body.reason).toBe("value");
    expect(hub.wallets.calls.typed).toHaveLength(0);
  });

  test("a seller release and a runner message are signed", async () => {
    const hub = startCliHub();
    const session = await login(hub);

    const release = releaseTyped();
    const released = await signTyped(hub, session.token, release);
    expect(released.status).toBe(200);
    const releaseBody = (await released.json()) as { signature: string; address: string };
    remember(releaseBody.signature);
    expect((await recoverTyped(release, releaseBody.signature)).toLowerCase()).toBe(ADDRESS);

    const message = `countersign runner ${"ab".repeat(16)}`;
    const signed = await signMessage(hub, session.token, message);
    expect(signed.status).toBe(200);
    const messageBody = (await signed.json()) as { signature: string; address: string };
    remember(messageBody.signature);
    expect(
      (
        await recoverMessageAddress({
          message,
          signature: messageBody.signature as Hex,
        })
      ).toLowerCase(),
    ).toBe(ADDRESS);

    const before = hub.wallets.calls.messages.length;
    const refused = await signMessage(hub, session.token, "hello");
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as ErrorBody).code).toBe("not-allowed");
    expect(hub.wallets.calls.messages).toHaveLength(before);
  });
});

describe("CLI redaction", () => {
  test("tokens, device secrets and signatures never reach a log line", async () => {
    const hub = startCliHub();
    const session = await login(hub);

    const signed = await signTyped(hub, session.token, buyerTyped());
    expect(signed.status).toBe(200);
    const typedBody = (await signed.json()) as { signature: string; address: string };
    remember(typedBody.signature);

    const messaged = await signMessage(hub, session.token, `countersign runner ${"ab".repeat(16)}`);
    expect(messaged.status).toBe(200);
    const messageBody = (await messaged.json()) as { signature: string; address: string };
    remember(messageBody.signature);

    const values = [
      session.deviceSecret,
      session.token,
      typedBody.signature,
      messageBody.signature,
    ];
    for (const line of captured) {
      for (const value of values) {
        expect(line.includes(value)).toBe(false);
      }
    }
  });
});
