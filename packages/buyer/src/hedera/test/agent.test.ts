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
  offerMemo,
  USDC_TESTNET,
  type Facilitator,
} from "@countersign/rail/hedera";
import { PrivateKey, TransferTransaction, type Client } from "@hiero-ledger/sdk";
import { createHederaAgent, spentFromLog, type HederaAgentOptions, type Listing } from "../agent.ts";
import { signHederaTransfer } from "../signer.ts";
import type { LoggedEntry, SpendEntry } from "../spendlog.ts";

const PAYER = "0.0.11337064";
const PAYEE = "0.0.11337065";
const FEE_PAYER = "0.0.9185802";
const SELLER = "0x00000000000000000000000000000000000000a1";
const TOPIC = "0.0.11337070";
const NODE_ACCOUNT_ID = "0.0.3";

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

function fakeFacilitator() {
  const calls = { feePayer: 0, verify: 0, settle: 0 };
  const f: Facilitator = {
    name: "fake",
    async feePayer() {
      calls.feePayer++;
      return FEE_PAYER;
    },
    async verify() {
      calls.verify++;
      return { isValid: true, payer: PAYER };
    },
    async settle(payment) {
      calls.settle++;
      const id = decodeTransfer(payment.payload.transaction as string).transactionId;
      return { success: true, transaction: id, network: HEDERA_TESTNET, payer: PAYER };
    },
  };
  return { f, calls };
}

interface HubOptions {
  listings: Listing[];
  challenge?: (req: PaymentRequirements) => PaymentRequirements;
  afterPayment?: (settlement: SettleResult) => { status?: number; body?: string; header?: string | null };
}

interface FakeHub {
  url: string;
  signed: string[];
  server: { fetch(request: Request | string): Promise<Response> };
}

let scheduleHub: FakeHub;

beforeAll(async () => {
  globalThis.fetch = (async () => {
    throw new Error("network used in a hermetic test");
  }) as unknown as typeof fetch;
  scheduleHub = await startHub({ listings: [] });
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

async function startHub(options: HubOptions): Promise<FakeHub> {
  const { f } = fakeFacilitator();
  const rail = await createHederaRail({
    facilitators: [f],
    refreshEveryMs: 0,
    verifyPayerSignature: async () => ({ ok: true }),
    confirmTimeoutMs: 50,
  });
  const signed: string[] = [];
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
    const base = rail.challenge(target.offer, ctx);
    const req = options.challenge ? options.challenge(base) : base;
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
  return { server, signed, url: "http://hub.test" };
}

function hubFetch(hub: FakeHub): typeof fetch {
  return ((input: string | URL | Request, init?: RequestInit) =>
    hub.server.fetch(new Request(input, init))) as unknown as typeof fetch;
}

async function withHub<T>(options: HubOptions, run: (hub: FakeHub) => Promise<T>): Promise<T> {
  return run(await startHub(options));
}

function mirrorShows(landed: boolean) {
  return {
    base: "http://mirror.test",
    fetch: (async (input: string | URL | Request) => {
      const url = String(input);
      if (!url.includes("/api/v1/transactions/")) return new Response("{}", { status: 404 });
      return Response.json({
        transactions: [
          {
            transaction_id: url.slice(url.lastIndexOf("/") + 1),
            result: landed ? "SUCCESS" : "FAILED",
            name: "CRYPTOTRANSFER",
            consensus_timestamp: "1793957001.000000001",
            memo_base64: null,
            transfers: [],
            token_transfers: landed
              ? [
                  { token_id: USDC_TESTNET, account: PAYER, amount: -10000 },
                  { token_id: USDC_TESTNET, account: PAYEE, amount: 10000 },
                ]
              : [],
          },
        ],
      });
    }) as unknown as typeof fetch,
  };
}

function agentFor(
  hub: FakeHub,
  env: Envelope,
  entries: SpendEntry[],
  mirror = mirrorShows(true),
  over: { trustedFeePayers?: string[] } = {},
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

function spend(over: Partial<SpendEntry> = {}): SpendEntry {
  return {
    v: 1,
    kind: "spend",
    rail: "hedera",
    network: HEDERA_TESTNET,
    offerHash: offerHash(offer()),
    seller: SELLER,
    payTo: PAYEE,
    asset: USDC_TESTNET,
    amount: "10000",
    tx: "0.0.9185802@1793957000.000000001",
    total: "10000",
    cap: "1000000",
    at: 1793957001,
    ...over,
  };
}

function logged(sequence: number, entry: SpendEntry): LoggedEntry {
  return { sequence, consensusAt: `17939570${sequence}.000000001`, entry };
}

function scheduleAgent(env: Envelope, entries: SpendEntry[], over: Partial<HederaAgentOptions> = {}) {
  return createHederaAgent({
    hub: scheduleHub.url,
    payer,
    envelope: env,
    topicId: TOPIC,
    appendLog: async (entry) => {
      entries.push(entry);
      return { sequence: entries.length };
    },
    fetch: hubFetch(scheduleHub),
    sign: { nodeAccountIds: [NODE_ACCOUNT_ID] },
    now: () => 1793957000,
    ...over,
  });
}

function scheduleMirror(record: () => object | null) {
  return {
    base: "http://mirror.test",
    fetch: (async () => {
      const r = record();
      return r ? Response.json(r) : new Response("{}", { status: 404 });
    }) as unknown as typeof globalThis.fetch,
  };
}

function scheduleRecord(over: Record<string, unknown> = {}) {
  return {
    schedule_id: "0.0.500",
    creator_account_id: PAYER,
    payer_account_id: PAYER,
    memo: "",
    executed_timestamp: null,
    expiration_time: "9999999999.000000000",
    deleted: false,
    wait_for_expiry: false,
    transaction_body: "",
    signatures: [],
    ...over,
  };
}

describe("hedera signer", () => {
  test("freezes the transfer against the node account ids it is given", async () => {
    const req: PaymentRequirements = {
      scheme: "exact",
      network: HEDERA_TESTNET,
      amount: "10000",
      asset: USDC_TESTNET,
      payTo: PAYEE,
      maxTimeoutSeconds: 180,
      extra: { feePayer: FEE_PAYER, offerHash: offerHash(offer()) },
    };

    const signed = await signHederaTransfer(payer, req, { nodeAccountIds: [NODE_ACCOUNT_ID] });
    const decoded = decodeTransfer(signed.transaction);
    const tx = TransferTransaction.fromBytes(Buffer.from(signed.transaction, "base64"));

    expect(tx.nodeAccountIds?.map(String)).toEqual([NODE_ACCOUNT_ID]);
    expect(decoded.transactionId).toBe(signed.transactionId);
    expect(decoded.feePayer).toBe(FEE_PAYER);
    expect(decoded.memo).toBe(offerMemo(offerHash(offer())));
    expect(decoded.tokens[USDC_TESTNET]).toEqual([
      { account: PAYER, amount: -10000n },
      { account: PAYEE, amount: 10000n },
    ]);
  });
});

describe("hedera agent", () => {
  test("discover keeps only listed, online hedera offers with a hedera payee", async () => {
    const good = listing(offer());
    const listings = [
      good,
      listing(offer({ title: "delisted" }), { status: "delisted" }),
      listing(offer({ title: "offline" }), { online: false }),
      listing(offer({ title: "other rail", rails: ["eip3009"], payTo: {} })),
      listing(offer({ title: "no hedera payee", payTo: {} })),
    ];
    await withHub({ listings }, async (hub) => {
      const agent = agentFor(hub, envelope(), []);
      expect(await agent.discover()).toEqual([good]);
    });
  });

  test("a paid call logs one spend with the signed transaction id and raises the total", async () => {
    const target = listing(offer());
    const entries: SpendEntry[] = [];
    await withHub({ listings: [target] }, async (hub) => {
      const agent = agentFor(hub, envelope(), entries);
      const outcome = await agent.buy(target, {});
      expect(outcome).toMatchObject({ kind: "paid" });
      if (outcome.kind !== "paid") return;
      expect(outcome.transactionId).toMatch(/^0\.0\.9185802@\d+\.\d{9}$/);
      expect(outcome.settlement.transaction).toBe(outcome.transactionId);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        kind: "spend",
        seller: SELLER,
        payTo: PAYEE,
        amount: "10000",
        tx: outcome.transactionId,
        total: "10000",
      });
      expect(outcome.logSequence).toBe(1);
      expect(agent.spent).toEqual({ total: "10000", bySeller: { [SELLER]: "10000" } });
      expect(hub.signed).toHaveLength(1);
      const signedPayment = fromBase64Json<PaymentPayload>(hub.signed[0]!);
      const signedId = decodeTransfer(signedPayment.payload.transaction as string).transactionId;
      expect(signedId).toBe(outcome.transactionId);
      expect(entries[0]!.tx).toBe(signedId);
    });
  });

  test("two parallel buys under a cap for one price pay once and refuse the other over-cap", async () => {
    const target = listing(offer());
    const entries: SpendEntry[] = [];
    await withHub({ listings: [target] }, async (hub) => {
      const agent = agentFor(hub, envelope({ cap: "10000", perMerchant: "10000" }), entries);
      const outcomes = await Promise.all([agent.buy(target, {}), agent.buy(target, {})]);
      const paid = outcomes.filter((o) => o.kind === "paid");
      expect(paid).toHaveLength(1);
      expect(paid[0]).toMatchObject({ kind: "paid" });
      const refused = outcomes.filter((o) => o.kind === "refused");
      expect(refused).toHaveLength(1);
      expect(refused[0]).toMatchObject({ kind: "refused", reason: "over-cap" });
      expect(hub.signed).toHaveLength(1);
      expect(agent.spent).toEqual({ total: "10000", bySeller: { [SELLER]: "10000" } });
      expect(entries.filter((entry) => entry.kind === "spend")).toHaveLength(1);
    });
  });

  test("a failed call whose transfer did not land releases its reservation for the next buy", async () => {
    const target = listing(offer());
    const entries: SpendEntry[] = [];
    let calls = 0;
    await withHub(
      {
        listings: [target],
        afterPayment: () => (++calls === 1 ? { status: 500, body: "hub fell over", header: null } : {}),
      },
      async (hub) => {
        const agent = agentFor(hub, envelope({ cap: "10000", perMerchant: "10000" }), entries, mirrorShows(false));
        const first = await agent.buy(target, {});
        expect(first).toMatchObject({ kind: "failed", status: 500, charged: false });
        expect(agent.spent.total).toBe("0");
        const second = await agent.buy(target, {});
        expect(second).toMatchObject({ kind: "paid" });
        expect(agent.spent).toEqual({ total: "10000", bySeller: { [SELLER]: "10000" } });
        expect(hub.signed).toHaveLength(2);
      },
    );
  });

  test("an untrusted fee payer is refused before the envelope, signing and logging nothing", async () => {
    const target = listing(offer());
    const entries: SpendEntry[] = [];
    await withHub(
      { listings: [target], challenge: (req) => ({ ...req, extra: { ...req.extra, feePayer: "0.0.999999" } }) },
      async (hub) => {
        const agent = agentFor(hub, envelope(), entries);
        const outcome = await agent.buy(target, {});
        expect(outcome).toMatchObject({
          kind: "refused",
          reason: "untrusted-fee-payer",
          message: "Refused. The hub named a fee payer this agent does not trust.",
        });
        expect(hub.signed).toHaveLength(0);
        expect(entries).toHaveLength(0);
        expect(agent.spent.total).toBe("0");
      },
    );
  });

  test("a trusted fee payer from the explicit list pays", async () => {
    const target = listing(offer());
    const entries: SpendEntry[] = [];
    await withHub({ listings: [target] }, async (hub) => {
      const agent = agentFor(hub, envelope(), entries, mirrorShows(true), { trustedFeePayers: [FEE_PAYER] });
      const outcome = await agent.buy(target, {});
      expect(outcome).toMatchObject({ kind: "paid" });
      expect(hub.signed).toHaveLength(1);
      expect(agent.spent.total).toBe("10000");
    });
  });

  test("an over-cap envelope refuses before signing and logs one refusal", async () => {
    const target = listing(offer());
    const entries: SpendEntry[] = [];
    await withHub({ listings: [target] }, async (hub) => {
      const agent = agentFor(hub, envelope({ cap: "5000" }), entries);
      const outcome = await agent.buy(target, {});
      expect(outcome).toMatchObject({ kind: "refused", reason: "over-cap" });
      expect(hub.signed).toHaveLength(0);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ kind: "refused", reason: "over-cap", total: "0" });
      expect(entries[0]!.tx).toBeUndefined();
      expect(agent.spent.total).toBe("0");
    });
  });

  test("an over-merchant-limit envelope refuses before signing and logs one refusal", async () => {
    const target = listing(offer());
    const entries: SpendEntry[] = [];
    await withHub({ listings: [target] }, async (hub) => {
      const agent = agentFor(hub, envelope({ perMerchant: "5000" }), entries);
      const outcome = await agent.buy(target, {});
      expect(outcome).toMatchObject({ kind: "refused", reason: "over-merchant-limit" });
      expect(hub.signed).toHaveLength(0);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ kind: "refused", reason: "over-merchant-limit" });
    });
  });

  test("needsHuman refuses because the agent never asks a person", async () => {
    const target = listing(offer());
    const entries: SpendEntry[] = [];
    await withHub({ listings: [target] }, async (hub) => {
      const agent = agentFor(hub, envelope({ askAbove: "5000" }), entries);
      const outcome = await agent.buy(target, {});
      expect(outcome).toMatchObject({ kind: "refused", reason: "needs-human" });
      expect(hub.signed).toHaveLength(0);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ kind: "refused", reason: "needs-human" });
    });
  });

  test("a challenge for a higher price than the listing is refused, signing nothing", async () => {
    const target = listing(offer());
    const entries: SpendEntry[] = [];
    await withHub(
      { listings: [target], challenge: (req) => ({ ...req, amount: "20000" }) },
      async (hub) => {
        const agent = agentFor(hub, envelope(), entries);
        const outcome = await agent.buy(target, {});
        expect(outcome).toMatchObject({ kind: "refused", reason: "challenge-mismatch" });
        expect(hub.signed).toHaveLength(0);
        expect(entries).toHaveLength(0);
        expect(agent.spent.total).toBe("0");
      },
    );
  });

  test("a challenge for a different payee than the listing is refused, signing nothing", async () => {
    const target = listing(offer());
    const entries: SpendEntry[] = [];
    await withHub(
      { listings: [target], challenge: (req) => ({ ...req, payTo: "0.0.999999" }) },
      async (hub) => {
        const agent = agentFor(hub, envelope(), entries);
        const outcome = await agent.buy(target, {});
        expect(outcome).toMatchObject({ kind: "refused", reason: "challenge-mismatch" });
        expect(hub.signed).toHaveLength(0);
        expect(entries).toHaveLength(0);
      },
    );
  });

  test("a 200 naming a different transaction in PAYMENT-RESPONSE throws", async () => {
    const target = listing(offer());
    const entries: SpendEntry[] = [];
    const foreign: SettleResult = {
      success: true,
      transaction: "0.0.9185802@1.000000001",
      network: HEDERA_TESTNET,
      payer: PAYER,
    };
    await withHub(
      { listings: [target], afterPayment: () => ({ header: toBase64Json(foreign) }) },
      async (hub) => {
        const agent = agentFor(hub, envelope(), entries);
        await expect(agent.buy(target, {})).rejects.toThrow(/hub reported settlement .* but this agent signed/);
        expect(entries).toHaveLength(0);
        expect(agent.spent.total).toBe("0");
      },
    );
  });

  test("a non-200 after paying logs a spend when the mirror shows the transfer landed", async () => {
    const target = listing(offer());
    const entries: SpendEntry[] = [];
    await withHub(
      { listings: [target], afterPayment: () => ({ status: 500, body: "hub fell over", header: null }) },
      async (hub) => {
        const agent = agentFor(hub, envelope(), entries, mirrorShows(true));
        const outcome = await agent.buy(target, {});
        expect(outcome).toMatchObject({ kind: "failed", status: 500, charged: true });
        if (outcome.kind !== "failed") return;
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ kind: "spend", tx: outcome.transactionId, amount: "10000" });
        expect(agent.spent.total).toBe("10000");
      },
    );
  });

  test("a non-200 after paying logs nothing when the mirror shows no landing", async () => {
    const target = listing(offer());
    const entries: SpendEntry[] = [];
    await withHub(
      { listings: [target], afterPayment: () => ({ status: 500, body: "hub fell over", header: null }) },
      async (hub) => {
        const agent = agentFor(hub, envelope(), entries, mirrorShows(false));
        const outcome = await agent.buy(target, {});
        expect(outcome).toMatchObject({ kind: "failed", status: 500, charged: false });
        expect(entries).toHaveLength(0);
        expect(agent.spent.total).toBe("0");
      },
    );
  });

  test("spentFromLog rebuilds totals per seller and ignores refusals", () => {
    const other = "0x00000000000000000000000000000000000000c3";
    const entries = [
      logged(1, spend({ seller: SELLER, amount: "10000", total: "10000" })),
      logged(2, spend({ seller: other, amount: "15000", total: "25000" })),
      logged(3, spend({ seller: SELLER, amount: "5000", total: "30000" })),
      logged(4, spend({ kind: "refused", reason: "over-cap", tx: undefined, amount: "40000", total: "30000" })),
    ];
    expect(spentFromLog(entries)).toEqual({
      total: "30000",
      bySeller: { [SELLER]: "15000", [other]: "15000" },
    });
  });

  test("spentFromLog counts a schedule at create", () => {
    const entries = [
      logged(
        1,
        spend({
          kind: "schedule",
          tx: "0.0.11337064@1793957000.000000001",
          schedule: "0.0.500",
          expiresAt: 1793957300,
          total: "10000",
        }),
      ),
    ];
    expect(spentFromLog(entries)).toEqual({ total: "10000", bySeller: { [SELLER]: "10000" } });
  });

  test("spentFromLog subtracts an expiry once and ignores the duplicate", () => {
    const createTx = "0.0.11337064@1793957000.000000001";
    const entries = [
      logged(1, spend({ kind: "schedule", tx: createTx, schedule: "0.0.500", expiresAt: 1793957300, total: "10000" })),
      logged(2, spend({ kind: "expired", tx: createTx, schedule: "0.0.500", total: "0" })),
      logged(3, spend({ kind: "expired", tx: createTx, schedule: "0.0.500", total: "0" })),
    ];
    expect(spentFromLog(entries)).toEqual({ total: "0", bySeller: { [SELLER]: "0" } });
  });

  test("spentFromLog still counts a legacy spend that carries a schedule id", () => {
    const entries = [logged(1, spend({ schedule: "0.0.500" }))];
    expect(spentFromLog(entries).total).toBe("10000");
  });

  test("spentFromLog does not double count a spend that follows its schedule entry", () => {
    const createTx = "0.0.11337064@1793957000.000000001";
    const entries = [
      logged(1, spend({ kind: "schedule", tx: createTx, schedule: "0.0.500", expiresAt: 1793957300, total: "10000" })),
      logged(2, spend({ kind: "spend", tx: "0.0.11337064@1793958000.000000001", schedule: "0.0.500", total: "10000" })),
    ];
    expect(spentFromLog(entries)).toEqual({ total: "10000", bySeller: { [SELLER]: "10000" } });
  });

  test("the second of two back-to-back schedules is refused when together they exceed the cap", async () => {
    const o = offer();
    const target = { offer: o, offerHash: offerHash(o) };
    const entries: SpendEntry[] = [];
    let created = 0;
    const agent = scheduleAgent(envelope({ cap: "10000", perMerchant: "10000" }), entries, {
      createSchedule: async () => {
        created++;
        return { scheduleId: `0.0.${500 + created}`, createTxId: `0.0.11337064@17939570${created}.000000001` };
      },
    });
    const first = await agent.schedule(target, { client: {} as Client, expiresInSeconds: 300 });
    expect(first).toMatchObject({ kind: "scheduled" });
    const second = await agent.schedule(target, { client: {} as Client, expiresInSeconds: 300 });
    expect(second).toMatchObject({ kind: "refused", reason: "over-cap" });
    expect(second.logSequence).toBe(2);
    expect(entries.map((e) => e.kind)).toEqual(["schedule", "refused"]);
    expect(agent.spent.total).toBe("10000");
  });

  test("a throwing create keeps the reservation held", async () => {
    const o = offer();
    const target = { offer: o, offerHash: offerHash(o) };
    const entries: SpendEntry[] = [];
    const agent = scheduleAgent(envelope({ cap: "10000", perMerchant: "10000" }), entries, {
      createSchedule: async () => {
        throw new Error("create failed");
      },
    });
    await expect(agent.schedule(target, { client: {} as Client, expiresInSeconds: 300 })).rejects.toThrow("create failed");
    expect(entries).toHaveLength(0);
    expect(agent.spent.total).toBe("0");
    const again = await agent.schedule(target, { client: {} as Client, expiresInSeconds: 300 });
    expect(again).toMatchObject({ kind: "refused", reason: "over-cap" });
  });

  test("a schedule success logs exactly one schedule entry with its ids and expiry", async () => {
    const o = offer();
    const target = { offer: o, offerHash: offerHash(o) };
    const entries: SpendEntry[] = [];
    const agent = scheduleAgent(envelope(), entries, {
      createSchedule: async (_client, _payer, req) => {
        expect(req.amount).toBe(10000n);
        expect(req.payTo).toBe(PAYEE);
        return { scheduleId: "0.0.500", createTxId: "0.0.11337064@1793957000.000000001" };
      },
    });
    const outcome = await agent.schedule(target, { client: {} as Client, expiresInSeconds: 120 });
    expect(outcome).toMatchObject({ kind: "scheduled" });
    if (outcome.kind !== "scheduled") return;
    expect(outcome.expiresAt).toBe(1793957120);
    expect(outcome.hold).toEqual({
      scheduleId: "0.0.500",
      createTxId: "0.0.11337064@1793957000.000000001",
      offerHash: offerHash(o),
      seller: SELLER,
      payTo: PAYEE,
      asset: USDC_TESTNET,
      amount: "10000",
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "schedule",
      tx: outcome.createTxId,
      schedule: outcome.scheduleId,
      expiresAt: 1793957120,
      offerHash: offerHash(o),
      seller: SELLER,
      payTo: PAYEE,
      asset: USDC_TESTNET,
      amount: "10000",
      total: "10000",
    });
    expect(agent.spent.total).toBe("10000");
  });

  test("releaseExpired leaves an executed schedule alone", async () => {
    const o = offer();
    const target = { offer: o, offerHash: offerHash(o) };
    const entries: SpendEntry[] = [];
    const agent = scheduleAgent(envelope(), entries, {
      createSchedule: async () => ({ scheduleId: "0.0.500", createTxId: "0.0.11337064@1793957000.000000001" }),
      mirror: scheduleMirror(() => scheduleRecord({ executed_timestamp: "1793957001.000000001" })),
    });
    const outcome = await agent.schedule(target, { client: {} as Client, expiresInSeconds: 300 });
    expect(outcome).toMatchObject({ kind: "scheduled" });
    if (outcome.kind !== "scheduled") return;
    expect(await agent.releaseExpired(outcome.hold)).toBe("executed");
    expect(entries.map((e) => e.kind)).toEqual(["schedule"]);
    expect(agent.spent.total).toBe("10000");
  });

  test("releaseExpired logs one expired entry and lowers spent once", async () => {
    const o = offer();
    const target = { offer: o, offerHash: offerHash(o) };
    const entries: SpendEntry[] = [];
    const agent = scheduleAgent(envelope(), entries, {
      createSchedule: async () => ({ scheduleId: "0.0.500", createTxId: "0.0.11337064@1793957000.000000001" }),
      mirror: scheduleMirror(() => scheduleRecord({ expiration_time: "1.000000000" })),
    });
    const outcome = await agent.schedule(target, { client: {} as Client, expiresInSeconds: 300 });
    expect(outcome).toMatchObject({ kind: "scheduled" });
    if (outcome.kind !== "scheduled") return;

    expect(await agent.releaseExpired(outcome.hold)).toBe("released");
    expect(entries.map((e) => e.kind)).toEqual(["schedule", "expired"]);
    expect(entries[1]).toMatchObject({
      kind: "expired",
      tx: outcome.createTxId,
      schedule: outcome.scheduleId,
      offerHash: offerHash(o),
      seller: SELLER,
      payTo: PAYEE,
      asset: USDC_TESTNET,
      amount: "10000",
      total: "0",
    });
    expect(agent.spent.total).toBe("0");

    expect(await agent.releaseExpired(outcome.hold)).toBe("released");
    expect(entries).toHaveLength(2);
  });
});
