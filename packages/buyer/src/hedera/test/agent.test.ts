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
import { createHederaRail, decodeTransfer, HEDERA_TESTNET, USDC_TESTNET, type Facilitator } from "@countersign/rail/hedera";
import { PrivateKey } from "@hiero-ledger/sdk";
import { createHederaAgent, spentFromLog, type Listing } from "../agent.ts";
import type { LoggedEntry, SpendEntry } from "../spendlog.ts";

const PAYER = "0.0.11337064";
const PAYEE = "0.0.11337065";
const FEE_PAYER = "0.0.9185802";
const SELLER = "0x00000000000000000000000000000000000000a1";
const TOPIC = "0.0.11337070";

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

async function startHub(options: HubOptions) {
  const { f } = fakeFacilitator();
  const rail = await createHederaRail({
    facilitators: [f],
    refreshEveryMs: 0,
    verifyPayerSignature: async () => ({ ok: true }),
    confirmTimeoutMs: 50,
  });
  const signed: string[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
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
    },
  });
  return { server, signed, url: `http://127.0.0.1:${server.port}` };
}

async function withHub<T>(options: HubOptions, run: (hub: Awaited<ReturnType<typeof startHub>>) => Promise<T>): Promise<T> {
  const hub = await startHub(options);
  try {
    return await run(hub);
  } finally {
    hub.server.stop(true);
  }
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

function agentFor(hub: string, env: Envelope, entries: SpendEntry[], mirror = mirrorShows(true)) {
  return createHederaAgent({
    hub,
    payer,
    envelope: env,
    topicId: TOPIC,
    appendLog: async (entry) => {
      entries.push(entry);
      return { sequence: entries.length };
    },
    mirror,
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
      const agent = agentFor(hub.url, envelope(), []);
      expect(await agent.discover()).toEqual([good]);
    });
  });

  test("a paid call logs one spend with the signed transaction id and raises the total", async () => {
    const target = listing(offer());
    const entries: SpendEntry[] = [];
    await withHub({ listings: [target] }, async (hub) => {
      const agent = agentFor(hub.url, envelope(), entries);
      const outcome = await agent.buy(target, {});
      expect(outcome.kind).toBe("paid");
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

  test("an over-cap envelope refuses before signing and logs one refusal", async () => {
    const target = listing(offer());
    const entries: SpendEntry[] = [];
    await withHub({ listings: [target] }, async (hub) => {
      const agent = agentFor(hub.url, envelope({ cap: "5000" }), entries);
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
      const agent = agentFor(hub.url, envelope({ perMerchant: "5000" }), entries);
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
      const agent = agentFor(hub.url, envelope({ askAbove: "5000" }), entries);
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
        const agent = agentFor(hub.url, envelope(), entries);
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
        const agent = agentFor(hub.url, envelope(), entries);
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
        const agent = agentFor(hub.url, envelope(), entries);
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
        const agent = agentFor(hub.url, envelope(), entries, mirrorShows(true));
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
        const agent = agentFor(hub.url, envelope(), entries, mirrorShows(false));
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
});
