import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  fromBase64Json,
  offerHash,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  toBase64Json,
  type CallResult,
  type Envelope,
  type Offer,
  type PaymentPayload,
  type PaymentRequired,
  type PaymentRequirements,
  type SettleResult,
} from "@countersign/core";
import {
  createHederaRail,
  decodeTransfer,
  HEDERA_TESTNET,
  USDC_TESTNET,
  type Facilitator,
  type MirrorOptions,
} from "@countersign/rail/hedera";
import { PrivateKey, TransferTransaction } from "@hiero-ledger/sdk";
import { CHARGE_MARGIN_SECONDS, createHederaAgent, type HederaAgentOptions, type Listing } from "../agent.ts";
import { signHederaTransfer } from "../signer.ts";
import type { SpendEntry } from "../spendlog.ts";

const PAYER = "0.0.11337064";
const PAYEE = "0.0.11337065";
const FEE_PAYER = "0.0.9185802";
const SELLER = "0x00000000000000000000000000000000000000a1";
const TOPIC = "0.0.11337070";
const NODE_ACCOUNT_ID = "0.0.3";
const MIRROR = "http://mirror.test";

const payerKey = PrivateKey.generateECDSA();
const payer = { accountId: PAYER, key: payerKey };
const realFetch = globalThis.fetch;

function offer(over: Partial<Offer> = {}): Offer {
  return {
    v: 1,
    seller: SELLER,
    title: "Hedera transfer builder",
    summary: "Builds an unsigned HBAR transfer for the caller to sign.",
    adapter: "mcp",
    input: { type: "object" },
    output: { type: "object" },
    price: "10000",
    deadline: 60,
    bond: "0",
    rails: ["hedera"],
    payTo: { hedera: PAYEE },
    issuedAt: 1793957000,
    ...over,
  };
}

function listing(o: Offer, over: Partial<Listing> = {}): Listing {
  return { offerHash: offerHash(o), offer: o, online: true, status: "listed", ...over };
}

function envelope(over: Partial<Envelope> = {}): Envelope {
  return {
    v: 1,
    agent: "0x00000000000000000000000000000000000000b2",
    cap: "1000000",
    perMerchant: "500000",
    allowlist: [],
    revoked: false,
    ...over,
  };
}

function requirements(over: Partial<PaymentRequirements> = {}): PaymentRequirements {
  return {
    scheme: "exact",
    network: HEDERA_TESTNET,
    amount: "10000",
    asset: USDC_TESTNET,
    payTo: PAYEE,
    maxTimeoutSeconds: 120,
    extra: { feePayer: FEE_PAYER, offerHash: offerHash(offer()) },
    ...over,
  };
}

function fakeFacilitator(): Facilitator {
  return {
    name: "fake",
    async feePayer() {
      return FEE_PAYER;
    },
    async verify() {
      return { isValid: true, payer: PAYER };
    },
    async settle(payment) {
      const id = decodeTransfer(payment.payload.transaction as string).transactionId;
      return { success: true, transaction: id, network: HEDERA_TESTNET, payer: PAYER };
    },
  };
}

interface HubOptions {
  listings: Listing[];
  afterPayment?: (settlement: SettleResult) => { status?: number; body?: string; header?: string | null };
}

interface FakeHub {
  url: string;
  signed: string[];
  issued: () => PaymentRequirements | undefined;
  server: { fetch(request: Request | string): Promise<Response> };
}

async function startHub(options: HubOptions): Promise<FakeHub> {
  const rail = await createHederaRail({
    facilitators: [fakeFacilitator()],
    refreshEveryMs: 0,
    verifyPayerSignature: async () => ({ ok: true }),
    confirmTimeoutMs: 50,
  });
  const signed: string[] = [];
  let issued: PaymentRequirements | undefined;
  const handler = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/offers") {
      return Response.json({ offers: options.listings });
    }
    const match = url.pathname.match(/^\/offers\/([^/]+)\/call$/);
    if (request.method !== "POST" || !match) return new Response("not found", { status: 404 });
    const target = options.listings.find((l) => l.offerHash === decodeURIComponent(match[1]!));
    if (!target) return new Response("unknown offer", { status: 404 });
    const ctx = { resource: url.toString(), now: Math.floor(Date.now() / 1000) };
    const req = rail.challenge(target.offer, ctx);
    issued = req;
    const sig = request.headers.get(PAYMENT_SIGNATURE_HEADER);
    if (!sig) {
      const required: PaymentRequired = { x402Version: 2, resource: { url: url.toString() }, accepts: [req] };
      return new Response(JSON.stringify(required), {
        status: 402,
        headers: { "content-type": "application/json", [PAYMENT_REQUIRED_HEADER]: toBase64Json(required) },
      });
    }
    signed.push(sig);
    const payment = fromBase64Json<PaymentPayload>(sig);
    const verified = await rail.verify(payment, req);
    if (!verified.isValid) {
      return Response.json({ code: "payment_invalid", message: verified.invalidReason ?? "invalid" }, { status: 402 });
    }
    const settlement = await rail.settle(payment, req);
    if (!settlement.success) {
      return Response.json({ code: "settle_failed", message: settlement.errorReason ?? "failed" }, { status: 402 });
    }
    const result = {
      output: { ok: true },
      slip: {
        settlement: {
          transaction: settlement.transaction,
          network: settlement.network,
          url: `https://hashscan.io/testnet/transaction/${settlement.transaction}`,
        },
      },
    } as unknown as CallResult;
    const custom = options.afterPayment?.(settlement);
    const header = custom?.header === null ? null : (custom?.header ?? toBase64Json(settlement));
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (header) headers[PAYMENT_RESPONSE_HEADER] = header;
    return new Response(custom?.body ?? JSON.stringify(result), { status: custom?.status ?? 200, headers });
  };
  const server = {
    fetch(request: Request | string): Promise<Response> {
      return handler(typeof request === "string" ? new Request(request) : request);
    },
  };
  return { server, signed, issued: () => issued, url: "http://hub.test" };
}

function hubFetch(hub: FakeHub): typeof fetch {
  return ((input: string | URL | Request, init?: RequestInit) =>
    hub.server.fetch(new Request(input, init))) as unknown as typeof fetch;
}

async function withHub<T>(options: HubOptions, run: (hub: FakeHub) => Promise<T>): Promise<T> {
  return run(await startHub(options));
}

function clock() {
  let t = Math.floor(Date.now() / 1000);
  let sleeps = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += Math.ceil(ms / 1000);
      sleeps++;
    },
    time: () => t,
    sleeps: () => sleeps,
  };
}

function txIdFrom(url: string): string {
  return url.slice(url.lastIndexOf("/") + 1);
}

function mirrorRecord(id: string, result: "SUCCESS" | "FAILED") {
  return {
    transaction_id: id,
    result,
    name: "CRYPTOTRANSFER",
    consensus_timestamp: "1793957001.000000001",
    memo_base64: null,
    transfers: [],
    token_transfers:
      result === "SUCCESS"
        ? [
            { token_id: USDC_TESTNET, account: PAYER, amount: -10000 },
            { token_id: USDC_TESTNET, account: PAYEE, amount: 10000 },
          ]
        : [],
  };
}

function mirrorValidUntil(hub: FakeHub, url: string): number {
  const req = hub.issued();
  if (!req) throw new Error("the hub issued no requirements");
  const id = txIdFrom(url);
  const match = id.match(/^\d+\.\d+\.\d+-(\d+)-\d+$/);
  if (!match) throw new Error(`not a mirror transaction id: ${id}`);
  return Number(match[1]) + Math.min(req.maxTimeoutSeconds, 180);
}

function staticMirror(make: (url: string) => Response, over: Partial<MirrorOptions> = {}): MirrorOptions {
  return {
    base: MIRROR,
    fetch: (async (input: string | URL | Request) => make(String(input))) as unknown as typeof fetch,
    ...over,
  };
}

function lateLandingMirror(hub: FakeHub, at: () => number): MirrorOptions {
  return staticMirror((url) => {
    if (!url.includes("/api/v1/transactions/")) return new Response("{}", { status: 404 });
    const id = txIdFrom(url);
    if (at() >= mirrorValidUntil(hub, url) - 10) {
      return Response.json({ transactions: [mirrorRecord(id, "SUCCESS")] });
    }
    return new Response("{}", { status: 404 });
  });
}

function agentFor(
  hub: FakeHub,
  env: Envelope,
  entries: SpendEntry[],
  mirror: MirrorOptions,
  over: Partial<HederaAgentOptions> = {},
) {
  return createHederaAgent({
    hub: hub.url,
    payer,
    envelope: env,
    topicId: TOPIC,
    trustedFeePayers: [FEE_PAYER],
    appendLog: async (entry) => {
      entries.push(entry);
      return { sequence: entries.length };
    },
    mirror,
    fetch: hubFetch(hub),
    sign: { nodeAccountIds: [NODE_ACCOUNT_ID] },
    ...over,
  });
}

beforeAll(() => {
  globalThis.fetch = (async () => {
    throw new Error("network used in a hermetic test");
  }) as unknown as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

describe("the signer's validUntil", () => {
  test("120 seconds of validity reaches validStart + 120", async () => {
    const signed = await signHederaTransfer(payer, requirements({ maxTimeoutSeconds: 120 }), {
      nodeAccountIds: [NODE_ACCOUNT_ID],
    });
    const tx = TransferTransaction.fromBytes(Buffer.from(signed.transaction, "base64"));
    const validStart = Number(tx.transactionId!.validStart!.seconds.toString());
    expect(signed.validUntil).toBe(validStart + tx.transactionValidDuration);
    expect(signed.validUntil).toBe(validStart + 120);
  });

  test("300 seconds of validity is capped at 180", async () => {
    const signed = await signHederaTransfer(payer, requirements({ maxTimeoutSeconds: 300 }), {
      nodeAccountIds: [NODE_ACCOUNT_ID],
    });
    const tx = TransferTransaction.fromBytes(Buffer.from(signed.transaction, "base64"));
    const validStart = Number(tx.transactionId!.validStart!.seconds.toString());
    expect(signed.validUntil).toBe(validStart + tx.transactionValidDuration);
    expect(signed.validUntil).toBe(validStart + 180);
  });
});

describe("the agent answers 'was I charged?' only when the chain can", () => {
  test("a transfer that lands just before its window closes is counted", async () => {
    const target = listing(offer());
    const entries: SpendEntry[] = [];
    const c = clock();
    await withHub(
      { listings: [target], afterPayment: () => ({ status: 500, body: "hub fell over", header: null }) },
      async (hub) => {
        const agent = agentFor(hub, envelope(), entries, lateLandingMirror(hub, c.time), c);
        const outcome = await agent.buy(target, {});
        expect(outcome).toMatchObject({ kind: "failed", status: 500, charged: true });
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ kind: "spend", amount: "10000" });
        if (outcome.kind === "failed") expect(entries[0]!.tx).toBe(outcome.transactionId);
        expect(agent.spent.total).toBe("10000");
      },
    );
  });

  test("a transfer that never lands is released once the window has closed", async () => {
    const target = listing(offer());
    const entries: SpendEntry[] = [];
    const c = clock();
    let calls = 0;
    await withHub(
      {
        listings: [target],
        afterPayment: () => (++calls === 1 ? { status: 500, body: "hub fell over", header: null } : {}),
      },
      async (hub) => {
        const agent = agentFor(
          hub,
          envelope({ cap: "10000", perMerchant: "10000" }),
          entries,
          staticMirror(() => new Response("{}", { status: 404 })),
          c,
        );
        const first = await agent.buy(target, {});
        expect(first).toMatchObject({ kind: "failed", status: 500, charged: false });
        if (first.kind !== "failed" || !first.transactionId) throw new Error("expected a failed buy with its id");
        const req = hub.issued();
        if (!req) throw new Error("the hub issued no requirements");
        const validStart = Number(first.transactionId.split("@")[1]!.split(".")[0]);
        const validUntil = validStart + Math.min(req.maxTimeoutSeconds, 180);
        expect(c.time()).toBeGreaterThanOrEqual(validUntil + CHARGE_MARGIN_SECONDS);
        expect(agent.spent.total).toBe("0");
        const second = await agent.buy(target, {});
        expect(second).toMatchObject({ kind: "paid" });
        expect(agent.spent).toEqual({ total: "10000", bySeller: { [SELLER]: "10000" } });
      },
    );
  });

  test("a mirror that never answers holds the reservation", async () => {
    const target = listing(offer());
    const entries: SpendEntry[] = [];
    const c = clock();
    await withHub(
      { listings: [target], afterPayment: () => ({ status: 500, body: "hub fell over", header: null }) },
      async (hub) => {
        const agent = agentFor(
          hub,
          envelope({ cap: "10000", perMerchant: "10000" }),
          entries,
          staticMirror(() => new Response(null, { status: 500 }), { retryDelaysMs: [] }),
          c,
        );
        await expect(agent.buy(target, {})).rejects.toThrow(/Unknown whether/);
        expect(agent.spent.total).toBe("0");
        const second = await agent.buy(target, {});
        expect(second).toMatchObject({ kind: "refused", reason: "over-cap" });
      },
    );
  });

  test("a FAILED record answers not charged on the first read", async () => {
    const target = listing(offer());
    const entries: SpendEntry[] = [];
    const c = clock();
    await withHub(
      { listings: [target], afterPayment: () => ({ status: 500, body: "hub fell over", header: null }) },
      async (hub) => {
        const mirror = staticMirror((url) => Response.json({ transactions: [mirrorRecord(txIdFrom(url), "FAILED")] }));
        const agent = agentFor(hub, envelope(), entries, mirror, c);
        const outcome = await agent.buy(target, {});
        expect(outcome).toMatchObject({ kind: "failed", status: 500, charged: false });
        expect(c.sleeps()).toBe(0);
        expect(agent.spent.total).toBe("0");
      },
    );
  });
});
