import { describe, expect, test } from "bun:test";
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
import { decodeTransfer, HEDERA_TESTNET, USDC_TESTNET } from "@countersign/rail/hedera";
import { PrivateKey, type Client } from "@hiero-ledger/sdk";
import {
  createHederaAgent,
  RELEASE_MARGIN_SECONDS,
  type HederaAgentOptions,
  type Listing,
} from "../agent.ts";
import type { ScheduledPayment, ScheduledPaymentRequest } from "../schedule.ts";
import type { SpendEntry } from "../spendlog.ts";

const PAYER = "0.0.11337064";
const PAYEE = "0.0.11337065";
const HELD_PAYEE = "0.0.11338176";
const FEE_PAYER = "0.0.9185802";
const SELLER = "0x00000000000000000000000000000000000000a1";
const TOPIC = "0.0.11337070";
const NODE_ACCOUNT_ID = "0.0.3";
const SCHEDULE = "0.0.500";
const NOW = 1_793_957_000;
const CREATE_TX = `${PAYER}@${NOW}.000000000`;

const payerKey = PrivateKey.generateECDSA();
const payer = { accountId: PAYER, key: payerKey };

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
    rails: ["hedera-scheduled", "hedera"],
    payTo: { "hedera-scheduled": HELD_PAYEE, hedera: PAYEE },
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

function heldEntry(o: Offer): PaymentRequirements {
  return {
    scheme: "countersign",
    network: HEDERA_TESTNET,
    amount: o.price,
    asset: USDC_TESTNET,
    payTo: o.payTo?.["hedera-scheduled"] ?? "",
    maxTimeoutSeconds: o.deadline,
    extra: { name: "hedera-scheduled", offerHash: offerHash(o), holdSeconds: 300 },
  };
}

function exactEntry(o: Offer): PaymentRequirements {
  return {
    scheme: "exact",
    network: HEDERA_TESTNET,
    amount: o.price,
    asset: USDC_TESTNET,
    payTo: o.payTo?.hedera ?? "",
    maxTimeoutSeconds: 120,
    extra: { feePayer: FEE_PAYER, offerHash: offerHash(o) },
  };
}

function settlementTransaction(payment: PaymentPayload): string {
  if (payment.accepted.scheme === "countersign") return String(payment.payload.createTxId);
  return decodeTransfer(payment.payload.transaction as string).transactionId;
}

function settlementFor(payment: PaymentPayload): SettleResult {
  return { success: true, transaction: settlementTransaction(payment), network: HEDERA_TESTNET };
}

function callResult(payment: PaymentPayload): CallResult {
  return {
    output: { ok: true },
    slip: {
      body: {
        v: 1,
        rail: "hedera-scheduled",
        network: HEDERA_TESTNET,
        offerHash: offerHash(offer()),
        jobId: `0x${"11".repeat(32)}`,
        buyer: PAYER,
        seller: SELLER,
        payTo: HELD_PAYEE,
        asset: USDC_TESTNET,
        amount: "10000",
        inputHash: `0x${"22".repeat(32)}`,
        outputHash: `0x${"33".repeat(32)}`,
        deliveredAt: NOW,
        children: [],
      },
      hash: `0x${"44".repeat(32)}`,
      sellerSig: `0x${"55".repeat(32)}`,
      payment,
      settlement: { transaction: settlementTransaction(payment), network: HEDERA_TESTNET },
    },
  };
}

interface HubOptions {
  target: Listing;
  held?: (base: PaymentRequirements) => PaymentRequirements;
  answer?: (payment: PaymentPayload) => { status?: number; body?: string; header?: string | null };
}

function fakeHub(options: HubOptions) {
  const payments: PaymentPayload[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== `/offers/${options.target.offerHash}/call`) {
      return new Response("not found", { status: 404 });
    }
    const sig = request.headers.get(PAYMENT_SIGNATURE_HEADER);
    if (!sig) {
      const base = heldEntry(options.target.offer);
      const held = options.held ? options.held(base) : base;
      const required: PaymentRequired = {
        x402Version: 2,
        resource: { url: url.toString() },
        accepts: [held, exactEntry(options.target.offer)],
      };
      return new Response(JSON.stringify(required), {
        status: 402,
        headers: { "content-type": "application/json", [PAYMENT_REQUIRED_HEADER]: toBase64Json(required) },
      });
    }
    const payment = fromBase64Json<PaymentPayload>(sig);
    payments.push(payment);
    const answer = options.answer?.(payment) ?? { status: 200 };
    const status = answer.status ?? 200;
    if (status === 200) {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (answer.header !== null) {
        headers[PAYMENT_RESPONSE_HEADER] = answer.header ?? toBase64Json(settlementFor(payment));
      }
      return new Response(answer.body ?? JSON.stringify(callResult(payment)), { status, headers });
    }
    return new Response(answer.body ?? "hub fell over", { status });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, payments };
}

function scheduleMirror(record: () => Record<string, unknown> | null) {
  return {
    base: "http://mirror.test",
    fetch: (async () => {
      const r = record();
      return r ? Response.json(r) : new Response("{}", { status: 404 });
    }) as unknown as typeof globalThis.fetch,
  };
}

function scheduleRecord(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schedule_id: SCHEDULE,
    creator_account_id: PAYER,
    payer_account_id: PAYER,
    memo: "",
    executed_timestamp: null,
    expiration_time: `${NOW + 300}.000000000`,
    deleted: false,
    wait_for_expiry: false,
    transaction_body: "",
    signatures: [],
    ...over,
  };
}

function fakeCreate(
  requests: ScheduledPaymentRequest[],
  payment: ScheduledPayment = { scheduleId: SCHEDULE, createTxId: CREATE_TX },
): NonNullable<HederaAgentOptions["createSchedule"]> {
  return async (_client, _payer, req) => {
    requests.push(req);
    return payment;
  };
}

let clock = NOW;

function agentFor(
  hub: ReturnType<typeof fakeHub>,
  entries: SpendEntry[],
  over: Partial<HederaAgentOptions> = {},
) {
  return createHederaAgent({
    hub: "http://hub.test",
    payer,
    envelope: envelope(),
    topicId: TOPIC,
    logClient: {} as Client,
    appendLog: async (entry) => {
      entries.push(entry);
      return { sequence: entries.length };
    },
    trustedFeePayers: [FEE_PAYER],
    fetch: hub.fetch,
    sign: { nodeAccountIds: [NODE_ACCOUNT_ID] },
    now: () => clock,
    ...over,
  });
}

describe("the held path", () => {
  test("pays with a schedule, logs it once and settles its reservation", async () => {
    clock = NOW;
    const target = listing(offer());
    const entries: SpendEntry[] = [];
    const requests: ScheduledPaymentRequest[] = [];
    const hub = fakeHub({ target });
    const agent = agentFor(hub, entries, { createSchedule: fakeCreate(requests) });

    const outcome = await agent.buy(target, { input: "hello" });
    expect(outcome.kind).toBe("paid");
    if (outcome.kind !== "paid") return;

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      payTo: HELD_PAYEE,
      asset: USDC_TESTNET,
      amount: 10000n,
      offerHash: offerHash(target.offer),
      expiresInSeconds: 300,
    });
    expect(hub.payments).toHaveLength(1);
    expect(hub.payments[0]!.accepted.scheme).toBe("countersign");
    expect(hub.payments[0]!.payload).toEqual({ scheduleId: SCHEDULE, createTxId: CREATE_TX });
    expect(outcome.transactionId).toBe(CREATE_TX);
    expect(outcome.settlement.transaction).toBe(CREATE_TX);
    expect(outcome.hold).toMatchObject({
      scheduleId: SCHEDULE,
      createTxId: CREATE_TX,
      payTo: HELD_PAYEE,
      asset: USDC_TESTNET,
      amount: "10000",
      expiresAt: NOW + 300,
    });
    expect(entries.map((entry) => entry.kind)).toEqual(["schedule"]);
    expect(agent.spent).toEqual({ total: "10000", bySeller: { [SELLER]: "10000" } });
  });

  test("preferHeld false takes the exact path", async () => {
    clock = NOW;
    const target = listing(offer());
    const entries: SpendEntry[] = [];
    const requests: ScheduledPaymentRequest[] = [];
    const hub = fakeHub({ target });
    const agent = agentFor(hub, entries, {
      createSchedule: fakeCreate(requests),
      preferHeld: false,
    });

    const outcome = await agent.buy(target, { input: "hello" });
    expect(outcome.kind).toBe("paid");
    if (outcome.kind !== "paid") return;

    expect(requests).toHaveLength(0);
    expect(hub.payments[0]!.accepted.scheme).toBe("exact");
    expect(outcome.hold).toBeUndefined();
    expect(entries.map((entry) => entry.kind)).toEqual(["spend"]);
    expect(agent.spent.total).toBe("10000");
  });

  test("a held challenge for another payee is refused before creating anything", async () => {
    clock = NOW;
    const target = listing(offer());
    const entries: SpendEntry[] = [];
    const requests: ScheduledPaymentRequest[] = [];
    const hub = fakeHub({ target, held: (base) => ({ ...base, payTo: "0.0.999999" }) });
    const agent = agentFor(hub, entries, { createSchedule: fakeCreate(requests) });

    const outcome = await agent.buy(target, { input: "hello" });
    expect(outcome).toMatchObject({ kind: "refused", reason: "challenge-mismatch" });
    expect(requests).toHaveLength(0);
    expect(entries).toHaveLength(0);
  });

  test("a held challenge with too short a hold is refused before creating anything", async () => {
    clock = NOW;
    const target = listing(offer());
    const entries: SpendEntry[] = [];
    const requests: ScheduledPaymentRequest[] = [];
    const hub = fakeHub({
      target,
      held: (base) => ({ ...base, extra: { ...base.extra, holdSeconds: 10 } }),
    });
    const agent = agentFor(hub, entries, { createSchedule: fakeCreate(requests) });

    const outcome = await agent.buy(target, { input: "hello" });
    expect(outcome).toMatchObject({ kind: "refused", reason: "challenge-mismatch" });
    expect(requests).toHaveLength(0);
    expect(entries).toHaveLength(0);
  });

  test("an undelivered call holds the amount until the schedule expires and releases it", async () => {
    clock = NOW;
    const target = listing(offer());
    const entries: SpendEntry[] = [];
    const requests: ScheduledPaymentRequest[] = [];
    const hub = fakeHub({ target, answer: () => ({ status: 502, body: "Nothing was charged." }) });
    const mirror = scheduleMirror(() => scheduleRecord());
    const agent = agentFor(hub, entries, { createSchedule: fakeCreate(requests), mirror });

    const outcome = await agent.buy(target, { input: "hello" });
    expect(outcome).toMatchObject({ kind: "failed", status: 502, charged: false });
    if (outcome.kind !== "failed" || !outcome.hold) throw new Error("expected a held failure");

    expect(agent.spent.total).toBe("10000");
    expect(entries.map((entry) => entry.kind)).toEqual(["schedule"]);

    clock = NOW + 300 + RELEASE_MARGIN_SECONDS;
    expect(await agent.releaseExpired(outcome.hold)).toBe("released");
    expect(entries.map((entry) => entry.kind)).toEqual(["schedule", "expired"]);
    expect(agent.spent.total).toBe("0");
  });

  test("an executed schedule after a 502 is charged", async () => {
    clock = NOW;
    const target = listing(offer());
    const entries: SpendEntry[] = [];
    const requests: ScheduledPaymentRequest[] = [];
    const hub = fakeHub({ target, answer: () => ({ status: 502, body: "Nothing was charged." }) });
    const mirror = scheduleMirror(() => scheduleRecord({ executed_timestamp: `${NOW + 5}.000000001` }));
    const agent = agentFor(hub, entries, { createSchedule: fakeCreate(requests), mirror });

    const outcome = await agent.buy(target, { input: "hello" });
    expect(outcome).toMatchObject({ kind: "failed", status: 502, charged: true });
    expect(agent.spent.total).toBe("10000");
  });

  test("a settlement that is not this schedule's create makes buy reject", async () => {
    clock = NOW;
    const target = listing(offer());
    const entries: SpendEntry[] = [];
    const requests: ScheduledPaymentRequest[] = [];
    const foreign: SettleResult = {
      success: true,
      transaction: `${PAYER}@1.000000001`,
      network: HEDERA_TESTNET,
    };
    const hub = fakeHub({ target, answer: () => ({ header: toBase64Json(foreign) }) });
    const agent = agentFor(hub, entries, { createSchedule: fakeCreate(requests) });

    await expect(agent.buy(target, { input: "hello" })).rejects.toThrow(
      /hub reported settlement .* but this agent's schedule was created by/,
    );
  });
});
