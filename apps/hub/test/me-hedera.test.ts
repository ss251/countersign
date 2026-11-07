import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { proto } from "@hiero-ledger/proto";
import { PublicKey, Transaction } from "@hiero-ledger/sdk";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  decodeTransfer,
  offerMemo,
  USDC_TESTNET,
} from "@countersign/rail/hedera";
import { createHub, type HubDeps } from "../src/app.ts";
import { CliAuthStore } from "../src/cli-auth/store.ts";
import {
  offerHash,
  publishMessage,
  RUNNER_PATH,
  type ErrorBody,
  type JobOrder,
  type Offer,
  type PaymentPayload,
  type PaymentRequirements,
  type Rail,
  type RailDeclaration,
  type SettleResult,
  type VerifyResult,
} from "../src/deps.ts";
import type { MeHederaMirror } from "../src/me-hedera.ts";
import { PRIVY_HEADER, PrivySessionError, type Person, type PrivyVerifier } from "../src/privy.ts";
import { Store } from "../src/store.ts";
import type { TypedDataInput, WalletApi } from "../src/wallets/privy-wallets.ts";
import { startRunner, type JobAnswer } from "./runner-client.ts";
import { makeOffer, NOW as BASE_NOW } from "./support.ts";

const WALLET_ONE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const WALLET_TWO_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
const WALLET_ONE = privateKeyToAccount(WALLET_ONE_KEY);
const WALLET_TWO = privateKeyToAccount(WALLET_TWO_KEY);
const WALLET_ONE_ADDRESS = WALLET_ONE.address.toLowerCase();
const WALLET_TWO_ADDRESS = WALLET_TWO.address.toLowerCase();

const BUYER = "0.0.7001";
const PAYEE = "0.0.7002";
const FEE_PAYER = "0.0.9185802";
const PRICE = "1000";
const OFFER_HASH = `0x${"ab".repeat(32)}` as Hex;
const SETTLE_TX = "0.0.9185802@1794006014.352007822";
const CONSENSUS = "1794006016.123456789";
const SELLER_KEY = "0x0000000000000000000000000000000000000000000000000000000000000001";
const SELLER = privateKeyToAccount(SELLER_KEY);

const verifier: PrivyVerifier = {
  async verify(token: string): Promise<Person> {
    if (token === "alice") return { userId: "did:privy:alice", wallets: [] };
    if (token === "bob") return { userId: "did:privy:bob", wallets: [] };
    throw new PrivySessionError("nope");
  },
};

interface RawCall {
  walletId: string;
  hash: Hex;
  signature: Hex;
}

interface WalletCalls {
  created: string[];
  found: string[];
  typed: Array<{ walletId: string; typed: TypedDataInput }>;
  messages: Array<{ walletId: string; message: string }>;
  raw: RawCall[];
}

type FakeWallet = WalletApi & { calls: WalletCalls };

function fakeWallet(): FakeWallet {
  const calls: WalletCalls = { created: [], found: [], typed: [], messages: [], raw: [] };
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
    async signTypedData(walletId, typed) {
      calls.typed.push({ walletId, typed });
      return WALLET_ONE.signTypedData({
        domain: typed.domain,
        types: typed.types,
        primaryType: typed.primaryType,
        message: typed.message,
      } as never);
    },
    async personalSign(walletId, message) {
      calls.messages.push({ walletId, message });
      return WALLET_ONE.signMessage({ message });
    },
    async rawSign(walletId, hash) {
      const signature = await WALLET_TWO.sign({ hash });
      calls.raw.push({ walletId, hash, signature });
      return signature;
    },
  };
}

interface RailVerifyCall {
  payment: PaymentPayload;
  requirements: PaymentRequirements;
}

class TestHederaRail implements Rail {
  readonly declaration: RailDeclaration = {
    id: "hedera",
    network: "hedera:testnet",
    scheme: "exact",
    asset: { network: "hedera:testnet", address: USDC_TESTNET, symbol: "USDC", decimals: 6 },
    kind: "direct",
    gasPaidBy: "facilitator",
    finality: "Final at Hedera consensus, a few seconds after the facilitator submits.",
    explorerTx: "https://hashscan.io/testnet/transaction/{tx}",
    finalitySeconds: 5,
    cost: { tollBps: 0, fixed: "0" },
  };
  readonly settlesAfterDelivery = true;
  readonly verifyCalls: RailVerifyCall[] = [];
  readonly settleCalls: RailVerifyCall[] = [];
  settleTx = SETTLE_TX;

  challenge(offer: Offer): PaymentRequirements {
    return {
      scheme: "exact",
      network: "hedera:testnet",
      amount: offer.price,
      asset: USDC_TESTNET,
      payTo: offer.payTo?.hedera ?? PAYEE,
      maxTimeoutSeconds: 180,
      extra: { feePayer: FEE_PAYER, offerHash: offerHash(offer) },
    };
  }

  async verify(payment: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResult> {
    this.verifyCalls.push({ payment, requirements });
    return { isValid: true, payer: BUYER };
  }

  async settle(payment: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResult> {
    this.settleCalls.push({ payment, requirements });
    return { success: true, payer: BUYER, transaction: this.settleTx, network: "hedera:testnet" };
  }

  pending(payment: PaymentPayload): { transaction: string; validUntil: number } | null {
    const transaction = payment.payload?.transaction;
    if (typeof transaction !== "string") return null;
    try {
      const inspected = decodeTransfer(transaction);
      return {
        transaction: inspected.transactionId,
        validUntil: inspected.validStart + inspected.validDurationSeconds,
      };
    } catch {
      return null;
    }
  }
}

class FakeMirror implements MeHederaMirror {
  balanceValue: bigint | null = 19_000_000n;
  failBalance = false;
  consensus: string | null = CONSENSUS;
  failConsensus = false;

  async balance(): Promise<bigint | null> {
    if (this.failBalance) throw new Error("mirror offline");
    return this.balanceValue;
  }

  async consensusTime(): Promise<string | null> {
    if (this.failConsensus) throw new Error("mirror offline");
    return this.consensus;
  }
}

interface TestHub {
  url: string;
  store: Store;
  cliStore: CliAuthStore;
  wallets: FakeWallet;
  mirror: FakeMirror;
  rail: TestHederaRail;
  createAccountCalls: string[];
  now: () => number;
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

function startHub(options: { hedera?: boolean } = {}): TestHub {
  const store = new Store(":memory:");
  const wallets = fakeWallet();
  const cliStore = new CliAuthStore(":memory:");
  const mirror = new FakeMirror();
  const rail = new TestHederaRail();
  const createAccountCalls: string[] = [];
  let now = Math.floor(Date.now() / 1000);

  const terms = (hash: string) => {
    const stored = store.getOffer(hash);
    if (stored === null || stored.delistedAt !== null) return null;
    const offer = stored.offer;
    if (!Array.isArray(offer.rails) || !offer.rails.includes("hedera")) return null;
    return {
      offerHash: hash,
      asset: USDC_TESTNET,
      amount: BigInt(offer.price),
      payTo: offer.payTo?.hedera ?? PAYEE,
      feePayer: FEE_PAYER,
    };
  };

  const deps: HubDeps = {
    store,
    rails: [rail],
    now: () => now,
    publicUrl: "http://hub.test",
    jobTimeoutMs: 2_000,
    privy: verifier,
    cliAuth: {
      store: cliStore,
      wallets,
      consoleUrl: "https://console.test",
      ...(options.hedera === false
        ? {}
        : {
            hedera: {
              terms,
              hourlyCap: 20,
              createAccount: async (compressedPublicKey: string) => {
                createAccountCalls.push(compressedPublicKey);
                return { accountId: BUYER };
              },
            },
          }),
    },
    meHedera: { mirror, sleep: async () => undefined },
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
    mirror,
    rail,
    createAccountCalls,
    now: () => now,
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

function me(hub: TestHub, token = "alice", headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${hub.url}/me/hedera`, { headers: { [PRIVY_HEADER]: token, ...headers } });
}

function buy(
  hub: TestHub,
  body: unknown,
  token = "alice",
  headers: Record<string, string> = {},
): Promise<Response> {
  return postJson(hub, "/me/hedera/buy", body, { [PRIVY_HEADER]: token, ...headers });
}

async function cliLogin(hub: TestHub, user = "alice"): Promise<string> {
  const started = (await (
    await postJson(hub, "/cli/login/start", {})
  ).json()) as { code: string; deviceSecret: string };
  await postJson(hub, "/cli/login/approve", { code: started.code }, { [PRIVY_HEADER]: user });
  const polled = (await (
    await postJson(hub, "/cli/login/poll", { deviceSecret: started.deviceSecret })
  ).json()) as { sessionToken: string };
  return polled.sessionToken;
}

function makeHederaOffer(overrides: Partial<Offer> = {}): Offer {
  return makeOffer({
    adapter: "mcp",
    input: {
      type: "object",
      properties: { q: { type: "string" } },
      required: ["q"],
      additionalProperties: false,
    },
    output: {
      type: "object",
      properties: { q: { type: "string" } },
      required: ["q"],
      additionalProperties: false,
    },
    price: PRICE,
    deadline: 60,
    rails: ["hedera"],
    payTo: { hedera: PAYEE },
    issuedAt: BASE_NOW,
    ...overrides,
  });
}

async function publishOffer(hub: TestHub, offer: Offer = makeHederaOffer()): Promise<Hex> {
  const hash = offerHash(offer);
  const sig = await SELLER.signMessage({ message: publishMessage(hash) });
  const response = await fetch(`${hub.url}/offers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ offer, sig }),
  });
  if (response.status !== 201) throw new Error(`publish failed with ${response.status}`);
  return hash;
}

interface RunnerHandle {
  close(): void;
}

async function connect(
  hub: TestHub,
  hash: Hex,
  respond: (order: JobOrder) => Promise<JobAnswer> = async () => ({ output: { q: "hello" } }),
): Promise<RunnerHandle> {
  const runner = startRunner({
    url: `${hub.url.replace(/^http/, "ws")}${RUNNER_PATH}`,
    account: SELLER,
    offers: [hash],
    now: hub.now,
    respond,
  });
  await runner.ready;
  const handle = { close: () => runner.close() };
  runnerClosers.push(handle);
  return handle;
}

const runnerClosers: RunnerHandle[] = [];

afterEach(() => {
  while (runnerClosers.length > 0) runnerClosers.pop()?.close();
});

function iso(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

function compressed(publicKey: Hex): string {
  const bytes = Buffer.from(publicKey.slice(2), "hex");
  const y = BigInt(`0x${bytes.subarray(33).toString("hex")}`);
  return `0x${y % 2n === 0n ? "02" : "03"}${bytes.subarray(1, 33).toString("hex")}`;
}

describe("GET /me/hedera", () => {
  test("with the flag off both routes give 404", async () => {
    const hub = startHub({ hedera: false });
    expect((await me(hub)).status).toBe(404);
    expect((await buy(hub, { offerHash: OFFER_HASH, input: {} })).status).toBe(404);
  });

  test("without a token the answer is 401 bad-session", async () => {
    const hub = startHub();
    const response = await fetch(`${hub.url}/me/hedera`);
    expect(response.status).toBe(401);
    expect(((await response.json()) as ErrorBody).code).toBe("bad-session");
  });

  test("provisions once, then returns the same account with no new creation", async () => {
    const hub = startHub();
    const first = await me(hub);
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { accountId: string; usdc: string };
    expect(firstBody.accountId).toBe(BUYER);
    expect(firstBody.usdc).toBe("19.00");

    const second = await me(hub);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(firstBody);
    expect(hub.createAccountCalls).toHaveLength(1);
    expect(hub.wallets.calls.created.filter((id) => id.startsWith("csh_"))).toHaveLength(0);
  });

  test("a failed balance read answers 0.00", async () => {
    const hub = startHub();
    hub.mirror.failBalance = true;
    const response = await me(hub);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { usdc: string }).usdc).toBe("0.00");
  });

  test("a CLI login and the console share one Hedera row", async () => {
    const hub = startHub();
    const token = await cliLogin(hub);
    const cli = await postJson(hub, "/cli/hedera/account", {}, { authorization: `Bearer ${token}` });
    expect(cli.status).toBe(200);
    const cliAccount = ((await cli.json()) as { accountId: string }).accountId;

    const consoleAccount = await me(hub);
    expect(consoleAccount.status).toBe(200);
    expect(((await consoleAccount.json()) as { accountId: string }).accountId).toBe(cliAccount);
    expect(hub.createAccountCalls).toHaveLength(1);
  });
});

describe("POST /me/hedera/buy", () => {
  test("refuses a bad origin with 403", async () => {
    const hub = startHub();
    const response = await buy(
      hub,
      { offerHash: OFFER_HASH, input: { q: "hello" } },
      "alice",
      { origin: "https://evil.test" },
    );
    expect(response.status).toBe(403);
    expect(((await response.json()) as ErrorBody).code).toBe("bad-origin");
  });

  test("refuses an origin that only resembles an allowed one", async () => {
    const hub = startHub();
    for (const origin of [
      "https://counter-sign.up.railway.app.evil.example",
      "https://evil.example",
      "http://counter-sign.up.railway.app",
    ]) {
      const response = await buy(
        hub,
        { offerHash: OFFER_HASH, input: { q: "hello" } },
        "alice",
        { origin },
      );
      expect(response.status).toBe(403);
      expect(((await response.json()) as ErrorBody).code).toBe("bad-origin");
    }
  });

  test("accepts the new and old console origins", async () => {
    const hub = startHub();
    const hash = await publishOffer(hub);
    await me(hub);
    await connect(hub, hash);

    for (const origin of [
      "https://counter-sign.up.railway.app",
      "https://web-production-a58de.up.railway.app",
      "https://console.test",
    ]) {
      const response = await buy(
        hub,
        { offerHash: hash, input: { q: "hello" } },
        "alice",
        { origin },
      );
      expect(response.status).toBe(200);
    }
  });

  test("CONSOLE_ORIGINS extends the allowlist with https origins only", async () => {
    const previous = process.env.CONSOLE_ORIGINS;
    process.env.CONSOLE_ORIGINS = "https://extra.test, http://plain.test, not-a-url";
    try {
      const hub = startHub();
      const hash = await publishOffer(hub);
      await me(hub);
      await connect(hub, hash);

      const accepted = await buy(
        hub,
        { offerHash: hash, input: { q: "hello" } },
        "alice",
        { origin: "https://extra.test" },
      );
      expect(accepted.status).toBe(200);

      for (const origin of ["http://plain.test", "not-a-url"]) {
        const refused = await buy(
          hub,
          { offerHash: hash, input: { q: "hello" } },
          "alice",
          { origin },
        );
        expect(refused.status).toBe(403);
        expect(((await refused.json()) as ErrorBody).code).toBe("bad-origin");
      }
    } finally {
      if (previous === undefined) delete process.env.CONSOLE_ORIGINS;
      else process.env.CONSOLE_ORIGINS = previous;
    }
  });

  test("builds, validates, signs, delivers and settles the purchase", async () => {
    const hub = startHub();
    const hash = await publishOffer(hub);
    await me(hub);
    await connect(hub, hash);

    const response = await buy(hub, { offerHash: hash, input: { q: "hello" } }, "alice", {
      origin: "https://console.test",
    });
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      steps: Array<{ label: string; at: string; url?: string }>;
      slipHash: Hex;
      hashscanUrl: string;
      output: unknown;
    };
    const slip = hub.store.getSlip(body.slipHash);
    expect(slip).not.toBeNull();
    const url = slip!.settlement.url!;
    expect(body.hashscanUrl).toBe(url);
    expect(body.output).toEqual({ q: "hello" });
    expect(body.steps).toEqual([
      { label: "Payment signed by your Hedera wallet", at: iso(hub.now()) },
      { label: "Seller delivered", at: iso(slip!.body.deliveredAt) },
      {
        label: "Output checked before any money moved",
        at: iso(slip!.body.deliveredAt),
      },
      { label: "Settled on Hedera", at: iso(Number(CONSENSUS.split(".")[0])), url },
      { label: "Slip minted", at: iso(hub.now()), url: `/verify?slip=${body.slipHash}` },
    ]);
    expect(body.steps.map((step) => step.label)).toEqual([
      "Payment signed by your Hedera wallet",
      "Seller delivered",
      "Output checked before any money moved",
      "Settled on Hedera",
      "Slip minted",
    ]);
    for (const step of body.steps) expect("title" in step).toBe(false);

    expect(hub.rail.settleCalls).toHaveLength(1);
    const payment = hub.rail.settleCalls[0]!.payment;
    const transaction = payment.payload.transaction as string;
    const inspected = decodeTransfer(transaction);
    expect(inspected.tokens[USDC_TESTNET]).toEqual([
      { account: BUYER, amount: -1000n },
      { account: PAYEE, amount: 1000n },
    ]);
    expect(inspected.hbar).toEqual([]);
    expect(inspected.memo).toBe(offerMemo(hash));
    expect(inspected.feePayer).toBe(FEE_PAYER);

    const list = proto.TransactionList.decode(Buffer.from(transaction, "base64")).transactionList;
    expect(list).toHaveLength(1);
    const signed = proto.SignedTransaction.decode(list[0]!.signedTransactionBytes!);
    const pairs = signed.sigMap?.sigPair ?? [];
    expect(pairs).toHaveLength(1);
    const storedKey = hub.cliStore.getHedera("did:privy:alice")!.publicKey!;
    expect(storedKey).toBe(compressed(WALLET_TWO.publicKey));
    expect(PublicKey.fromString(storedKey).verify(signed.bodyBytes!, pairs[0]!.ECDSASecp256k1!)).toBe(
      true,
    );
  });

  test("refuses an amount over HARD_CAP before signing anything", async () => {
    const hub = startHub();
    const hash = await publishOffer(hub, makeHederaOffer({ price: "1000001" }));
    await me(hub);
    const rawCallsBefore = hub.wallets.calls.raw.length;

    const response = await buy(hub, { offerHash: hash, input: { q: "hello" } });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { reason: string }).reason).toBe("over-cap");
    expect(hub.wallets.calls.raw).toHaveLength(rawCallsBefore);
    expect(hub.rail.settleCalls).toHaveLength(0);
  });

  test("refuses an offer without the hedera rail", async () => {
    const hub = startHub();
    const hash = await publishOffer(
      hub,
      makeHederaOffer({ rails: ["escrow"], payTo: { escrow: WALLET_ONE_ADDRESS } }),
    );
    await me(hub);
    const response = await buy(hub, { offerHash: hash, input: { q: "hello" } });
    expect(response.status).toBe(403);
    expect(((await response.json()) as ErrorBody).code).toBe("hedera-not-offered");
  });

  test("a second concurrent buy is refused with 409", async () => {
    const hub = startHub();
    const hash = await publishOffer(hub);
    await me(hub);

    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reached: () => void = () => undefined;
    const dispatched = new Promise<void>((resolve) => {
      reached = resolve;
    });
    await connect(hub, hash, async () => {
      reached();
      await gate;
      return { output: { q: "hello" } };
    });

    const first = buy(hub, { offerHash: hash, input: { q: "hello" } });
    await dispatched;
    const second = await buy(hub, { offerHash: hash, input: { q: "hello" } });
    expect(second.status).toBe(409);
    expect(((await second.json()) as ErrorBody).message).toBe("A purchase is already running.");

    release();
    expect((await first).status).toBe(200);
  });

  test("a user with no Hedera account is refused with 409", async () => {
    const hub = startHub();
    const hash = await publishOffer(hub);
    const response = await buy(hub, { offerHash: hash, input: { q: "hello" } }, "bob");
    expect(response.status).toBe(409);
    const body = (await response.json()) as ErrorBody;
    expect(body.code).toBe("no-hedera-account");
    expect(body.message).toBe("Open the Sign in menu to create your Hedera account first.");
  });

  test("an extra body key is refused with 400", async () => {
    const hub = startHub();
    await me(hub);
    const response = await buy(hub, {
      offerHash: OFFER_HASH,
      input: { q: "hello" },
      extra: true,
    });
    expect(response.status).toBe(400);
  });

  test("a failed delivery passes the 502 through and never settles", async () => {
    const hub = startHub();
    const hash = await publishOffer(hub);
    await me(hub);
    await connect(hub, hash, async () => ({ fail: "cannot serve" }));

    const response = await buy(hub, { offerHash: hash, input: { q: "hello" } });
    expect(response.status).toBe(502);
    const body = (await response.json()) as ErrorBody;
    expect(body.code).toBe("failed-delivery");
    expect(body.message).toBe(
      "Not delivered. Nothing was charged: this hub settles a Hedera payment only after delivery, so your signed transfer was never submitted and expires unused.",
    );
    expect(hub.rail.settleCalls).toHaveLength(0);
  });
});
