import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createHub, type HubDeps } from "../src/app.ts";
import { CliAuthStore } from "../src/cli-auth/store.ts";
import type { ErrorBody } from "../src/deps.ts";
import { PRIVY_HEADER, PrivySessionError, type Person, type PrivyVerifier } from "../src/privy.ts";
import { Store } from "../src/store.ts";
import type { WalletApi } from "../src/wallets/privy-wallets.ts";
import { FakeRail } from "./fake-rail.ts";
import { NOW } from "./support.ts";

const WALLET_ONE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const WALLET_TWO_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
const WALLET_ONE = privateKeyToAccount(WALLET_ONE_KEY);
const WALLET_TWO = privateKeyToAccount(WALLET_TWO_KEY);
const WALLET_ONE_ADDRESS = WALLET_ONE.address.toLowerCase();
const WALLET_TWO_ADDRESS = WALLET_TWO.address.toLowerCase();

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
  raw: Array<{ walletId: string; hash: Hex }>;
}

type FakeWallet = WalletApi & { calls: WalletCalls };

function fakeWallet(): FakeWallet {
  const calls: WalletCalls = { created: [], found: [], raw: [] };
  const isHedera = (externalId: string): boolean => externalId.startsWith("csh_");
  return {
    calls,
    async createWallet(externalId) {
      calls.created.push(externalId);
      return isHedera(externalId)
        ? { id: "privy-wallet-hedera", address: WALLET_TWO_ADDRESS }
        : { id: "privy-wallet-1", address: WALLET_ONE_ADDRESS };
    },
    async findWallet(externalId) {
      calls.found.push(externalId);
      return isHedera(externalId)
        ? { id: "privy-wallet-hedera", address: WALLET_TWO_ADDRESS }
        : null;
    },
    async signTypedData() {
      throw new Error("not used");
    },
    async personalSign() {
      throw new Error("not used");
    },
    async rawSign(walletId, hash) {
      calls.raw.push({ walletId, hash });
      return WALLET_TWO.sign({ hash });
    },
  };
}

interface TestHub {
  url: string;
  store: Store;
  cliStore: CliAuthStore;
  wallets: FakeWallet;
  setNow: (at: number) => void;
  close: () => void;
}

let hubs: TestHub[] = [];

beforeEach(() => {
  hubs = [];
});

afterEach(() => {
  for (const hub of hubs) hub.close();
  hubs = [];
});

type Creator = (compressedPublicKey: string) => Promise<{ accountId: string }>;

function startHub(options: { hourlyCap?: number; createAccount?: Creator } = {}): TestHub {
  const store = new Store(":memory:");
  const wallets = fakeWallet();
  const cliStore = new CliAuthStore(":memory:");
  let now = NOW;
  const deps: HubDeps = {
    store,
    rails: [new FakeRail("escrow")],
    now: () => now,
    publicUrl: "http://hub.test",
    privy: verifier,
    cliAuth: {
      store: cliStore,
      wallets,
      consoleUrl: "https://console.test",
      hedera: {
        terms: () => null,
        hourlyCap: options.hourlyCap,
        createAccount: options.createAccount ?? (async () => ({ accountId: "0.0.7001" })),
      },
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

async function login(hub: TestHub, user = "alice"): Promise<string> {
  const started = (await (
    await postJson(hub, "/cli/login/start", {})
  ).json()) as { code: string; deviceSecret: string };
  await postJson(hub, "/cli/login/approve", { code: started.code }, { [PRIVY_HEADER]: user });
  const polled = (await (
    await postJson(hub, "/cli/login/poll", { deviceSecret: started.deviceSecret })
  ).json()) as { sessionToken: string };
  return polled.sessionToken;
}

function provision(hub: TestHub, token: string): Promise<Response> {
  return postJson(hub, "/cli/hedera/account", {}, { authorization: `Bearer ${token}` });
}

function compress(uncompressed: Hex): Hex {
  const bytes = Buffer.from(uncompressed.slice(2), "hex");
  const y = BigInt(`0x${bytes.subarray(33).toString("hex")}`);
  return `0x${y % 2n === 0n ? "02" : "03"}${bytes.subarray(1, 33).toString("hex")}` as Hex;
}

describe("POST /cli/hedera/account", () => {
  test("a second call returns the same account without creating anything again", async () => {
    let created = 0;
    const hub = startHub({
      createAccount: async () => {
        created += 1;
        return { accountId: "0.0.7001" };
      },
    });
    const token = await login(hub);

    const first = await provision(hub, token);
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { accountId: string; publicKey: string };
    expect(firstBody.accountId).toBe("0.0.7001");

    const second = await provision(hub, token);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(firstBody);
    expect(created).toBe(1);
    expect(hub.wallets.calls.created.filter((id) => id.startsWith("csh_"))).toHaveLength(0);
  });

  test("two concurrent first calls create one account", async () => {
    let created = 0;
    const hub = startHub({
      createAccount: async () => {
        created += 1;
        return { accountId: "0.0.7001" };
      },
    });
    const token = await login(hub);
    const [a, b] = await Promise.all([provision(hub, token), provision(hub, token)]);
    expect(created).toBe(1);
    const statuses = [a.status, b.status].sort();
    expect(statuses[0]).toBe(200);
    if (statuses[1] === 409) {
      const loser = a.status === 409 ? a : b;
      expect(((await loser.json()) as ErrorBody).code).toBe("provisioning");
    } else {
      expect(statuses).toEqual([200, 200]);
      expect(await a.json()).toEqual(await b.json());
    }
  });

  test("the hourly cap refuses a new user", async () => {
    const hub = startHub({ hourlyCap: 2 });
    for (const user of ["did:privy:one", "did:privy:two"]) {
      expect(hub.cliStore.claimHedera(user, NOW - 60)).toBe(true);
      hub.cliStore.readyHedera(user, {
        walletId: "w",
        evmAddress: WALLET_TWO_ADDRESS,
        publicKey: compress(WALLET_TWO.publicKey),
        accountId: "0.0.7009",
      });
    }
    const token = await login(hub);
    const response = await provision(hub, token);
    expect(response.status).toBe(429);
    expect(((await response.json()) as ErrorBody).code).toBe("provisioning-capped");
    expect(hub.wallets.calls.raw).toHaveLength(0);
  });

  test("a failed create marks the row failed, leaks nothing, and may be re-claimed after ten minutes", async () => {
    let attempt = 0;
    const hub = startHub({
      createAccount: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error("the secret operator key was rejected");
        return { accountId: "0.0.7001" };
      },
    });
    const token = await login(hub);
    const failed = await provision(hub, token);
    expect(failed.status).toBe(502);
    const failedText = await failed.text();
    expect(failedText).not.toContain("secret");
    expect(failedText).not.toContain("operator");
    expect((JSON.parse(failedText) as ErrorBody).code).toBe("hedera-provision-failed");
    expect(hub.cliStore.getHedera("did:privy:alice")?.state).toBe("failed");

    const tooSoon = await provision(hub, token);
    expect(tooSoon.status).toBe(502);
    expect(attempt).toBe(1);

    hub.setNow(NOW + 601);
    const retried = await provision(hub, token);
    expect(retried.status).toBe(200);
    expect(((await retried.json()) as { accountId: string }).accountId).toBe("0.0.7001");
    expect(attempt).toBe(2);
  });

  test("the second wallet's recovered key is stored as wallet #2's compressed public key", async () => {
    const hub = startHub();
    const token = await login(hub);
    const response = await provision(hub, token);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { publicKey: string };
    const publicKey = compress(WALLET_TWO.publicKey);
    expect(body.publicKey).toBe(publicKey);

    const row = hub.cliStore.getHedera("did:privy:alice");
    expect(row).not.toBeNull();
    expect(row!.state).toBe("ready");
    expect(row!.walletId).toBe("privy-wallet-hedera");
    expect(row!.evmAddress).toBe(WALLET_TWO_ADDRESS);
    expect(row!.publicKey).toBe(publicKey);
    expect(row!.accountId).toBe("0.0.7001");
  });

  test("the Hedera external id is distinct from wallet #1's", async () => {
    const hub = startHub();
    const token = await login(hub);
    const response = await provision(hub, token);
    expect(response.status).toBe(200);

    const walletOne = hub.wallets.calls.created[0]!;
    const walletTwo = hub.wallets.calls.found.find((id) => id.startsWith("csh_"));
    expect(walletOne).toMatch(/^cs_[0-9a-f]{40}$/);
    expect(walletTwo).toMatch(/^csh_[0-9a-f]{40}$/);
    expect(walletTwo).not.toBe(walletOne);
    expect(walletTwo).toBe(
      `csh_${createHash("sha256").update("did:privy:alice").digest("hex").slice(0, 40)}`,
    );
  });

  test("one user's account never answers for another's", async () => {
    const hub = startHub();
    const alice = await login(hub, "alice");
    expect((await provision(hub, alice)).status).toBe(200);
    const bob = await login(hub, "bob");
    const bobResponse = await provision(hub, bob);
    expect(bobResponse.status).toBe(200);
    expect(hub.cliStore.getHedera("did:privy:alice")?.state).toBe("ready");
    expect(hub.cliStore.getHedera("did:privy:bob")?.state).toBe("ready");
  });
});
