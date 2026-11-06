import { describe, expect, test } from "bun:test";
import { offerHash, type PaymentPayload, type PaymentRequirements } from "@countersign/core";
import type { Facilitator } from "../facilitator.ts";
import { createHederaRail, type HederaRailOptions } from "../rail.ts";
import { toMirrorTxId } from "../txid.ts";
import { FALLBACK_FEE_PAYER, FEE_PAYER, offer, PAYEE, PAYER, transfer } from "./fixtures.ts";
import { offerMemo } from "../memo.ts";

const ctx = { resource: "http://hub.test/offers/x/call", now: 1793957000 };

interface FakeOpts {
  name?: string;
  feePayer?: string | null;
  verify?: "ok" | "refuse" | "throw";
  settle?: "ok" | "refuse" | "throw";
}

function fakeFacilitator(o: FakeOpts = {}) {
  const calls = { verify: 0, settle: 0 };
  const f: Facilitator = {
    name: o.name ?? "fake",
    feePayer: async () => (o.feePayer === undefined ? FEE_PAYER : o.feePayer),
    async verify() {
      calls.verify++;
      if (o.verify === "throw") throw new Error("down");
      return o.verify === "refuse" ? { isValid: false, invalidReason: "insufficient_funds" } : { isValid: true, payer: PAYER };
    },
    async settle(p) {
      calls.settle++;
      if (o.settle === "throw") throw new Error("down");
      if (o.settle === "refuse") return { success: false, errorReason: "transaction_failed", transaction: "", network: "hedera:testnet" };
      const { decodeTransfer } = await import("../inspect.ts");
      const id = decodeTransfer(p.payload.transaction as string).transactionId;
      return { success: true, transaction: id, network: "hedera:testnet", payer: PAYER };
    },
  };
  return { f, calls };
}

/** A mirror node that knows exactly one transaction, or none. */
function fakeMirror(tx?: { id: string; result: string; credit: bigint }) {
  return {
    base: "http://mirror.test",
    fetch: (async (url: string) => {
      if (tx && url.endsWith(`/api/v1/transactions/${toMirrorTxId(tx.id)}`)) {
        return new Response(
          JSON.stringify({
            transactions: [
              {
                transaction_id: toMirrorTxId(tx.id),
                result: tx.result,
                name: "CRYPTOTRANSFER",
                consensus_timestamp: "1793957001.000000001",
                memo_base64: null,
                transfers: [],
                token_transfers: [
                  { token_id: "0.0.429274", account: PAYER, amount: Number(-tx.credit) },
                  { token_id: "0.0.429274", account: PAYEE, amount: Number(tx.credit) },
                ],
              },
            ],
          }),
        );
      }
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch,
  };
}

async function rail(facilitators: Facilitator[], over: Partial<HederaRailOptions> = {}) {
  return createHederaRail({
    facilitators,
    refreshEveryMs: 0,
    verifyPayerSignature: async () => ({ ok: true }),
    confirmTimeoutMs: 50,
    ...over,
  });
}

/** What the buyer sends: the transfer it signed for these requirements. */
async function pay(req: PaymentRequirements, over: Parameters<typeof transfer>[0] = {}): Promise<PaymentPayload> {
  const t = await transfer({
    amount: BigInt(req.amount),
    to: req.payTo,
    feePayer: req.extra!.feePayer as string,
    memo: offerMemo(req.extra!.offerHash as string),
    ...over,
  });
  return { x402Version: 2, accepted: req, payload: { transaction: t.base64 } };
}

describe("hedera rail", () => {
  test("declares a direct USDC rail paid by the facilitator", async () => {
    const r = await rail([fakeFacilitator().f]);
    expect(r.declaration).toMatchObject({ id: "hedera", network: "hedera:testnet", kind: "direct", gasPaidBy: "facilitator" });
    expect(r.declaration.asset).toEqual({ network: "hedera:testnet", address: "0.0.429274", symbol: "USDC", decimals: 6 });
  });

  test("challenge names the seller's Hedera account, the price, the live fee payer and the offer", async () => {
    const r = await rail([fakeFacilitator().f]);
    const req = r.challenge(offer(), ctx);
    expect(req).toEqual({
      scheme: "exact",
      network: "hedera:testnet",
      amount: "10000",
      asset: "0.0.429274",
      payTo: PAYEE,
      maxTimeoutSeconds: 120,
      extra: { feePayer: FEE_PAYER, offerHash: offerHash(offer()) },
    });
    expect(() => r.challenge(offer({ payTo: {} }), ctx)).toThrow();
    expect(() => r.challenge(offer({ payTo: { hedera: "0xabc" } }), ctx)).toThrow();
  });

  test("falls over to the next facilitator when the first does not list hedera:testnet", async () => {
    const down = fakeFacilitator({ feePayer: null });
    const up = fakeFacilitator({ name: "blocky402", feePayer: FALLBACK_FEE_PAYER });
    const r = await rail([down.f, up.f]);
    expect(r.active).toEqual({ name: "blocky402", feePayer: FALLBACK_FEE_PAYER });
    expect(r.challenge(offer(), ctx).extra!.feePayer).toBe(FALLBACK_FEE_PAYER);
    const none = await rail([down.f]);
    expect(() => none.challenge(offer(), ctx)).toThrow();
  });

  test("verify, settle, then the same payment is refused as a replay", async () => {
    const { f, calls } = fakeFacilitator();
    const r = await rail([f]);
    const req = r.challenge(offer(), ctx);
    const payment = await pay(req);
    expect(await r.verify(payment, req)).toEqual({ isValid: true, payer: PAYER });
    const s = await r.settle(payment, req);
    expect(s.success).toBe(true);
    expect(s.payer).toBe(PAYER);
    expect(s.transaction).toMatch(/^0\.0\.9185802@\d+\.\d{9}$/);
    expect(calls).toEqual({ verify: 1, settle: 1 });
    expect(await r.verify(payment, req)).toMatchObject({ isValid: false, invalidReason: "replay" });
    expect((await r.settle(payment, req)).success).toBe(false);
    expect(calls.settle).toBe(1);
  });

  test("a price that moved after signing is refused before the facilitator is asked", async () => {
    const { f, calls } = fakeFacilitator();
    const r = await rail([f]);
    const signedFor = r.challenge(offer(), ctx);
    const payment = await pay(signedFor);
    const now = r.challenge(offer({ price: "20000" }), ctx);
    expect(await r.verify(payment, now)).toMatchObject({ isValid: false, invalidReason: "requirements_mismatch" });
    // Rewriting `accepted` to the new terms does not help: the signed transfer still says the old offer and price.
    const rewritten = { ...payment, accepted: now };
    expect(await r.verify(rewritten, now)).toMatchObject({ isValid: false, invalidReason: "offer_mismatch" });
    expect((await r.settle(rewritten, now)).success).toBe(false);
    expect(calls).toEqual({ verify: 0, settle: 0 });
  });

  test("a payment through the other known facilitator still verifies after the active one changes", async () => {
    const a = fakeFacilitator({ name: "a", feePayer: FEE_PAYER });
    const b = fakeFacilitator({ name: "b", feePayer: FALLBACK_FEE_PAYER });
    const r = await rail([a.f, b.f]);
    const issued = { ...r.challenge(offer(), ctx), extra: { feePayer: FALLBACK_FEE_PAYER, offerHash: offerHash(offer()) } };
    const payment = await pay(issued);
    const current = r.challenge(offer(), ctx);
    expect(current.extra!.feePayer).toBe(FEE_PAYER);
    expect(await r.verify(payment, current)).toEqual({ isValid: true, payer: PAYER });
    expect(b.calls.verify).toBe(1);
    expect(a.calls.verify).toBe(0);
  });

  test("an unknown fee payer, a bad signature and a facilitator refusal are all refusals", async () => {
    const { f } = fakeFacilitator();
    const r = await rail([f]);
    const req = r.challenge(offer(), ctx);
    const stranger = { ...req, extra: { ...req.extra, feePayer: "0.0.4242" } };
    expect(await r.verify(await pay(stranger), req)).toMatchObject({ isValid: false, invalidReason: "unknown_fee_payer" });

    const badSig = await rail([f], { verifyPayerSignature: async () => ({ ok: false }) });
    const req2 = badSig.challenge(offer(), ctx);
    expect(await badSig.verify(await pay(req2), req2)).toMatchObject({ isValid: false, invalidReason: "signature_invalid" });

    const refusing = await rail([fakeFacilitator({ verify: "refuse" }).f]);
    const req3 = refusing.challenge(offer(), ctx);
    expect(await refusing.verify(await pay(req3), req3)).toMatchObject({ isValid: false, invalidReason: "insufficient_funds" });
  });

  test("tampered payloads never reach the facilitator", async () => {
    const { f, calls } = fakeFacilitator();
    const r = await rail([f]);
    const req = r.challenge(offer(), ctx);
    const cases: PaymentPayload[] = [
      await pay(req, { amount: 9999n }),
      await pay(req, { to: "0.0.31337" }),
      await pay(req, { memo: "" }),
      await pay(req, { sign: false }),
      { x402Version: 2, accepted: req, payload: { transaction: "not base64 of anything" } },
      { x402Version: 2, accepted: req, payload: {} },
      { ...(await pay(req)), x402Version: 1 as 2 },
    ];
    for (const p of cases) expect((await r.verify(p, req)).isValid).toBe(false);
    expect(calls.verify).toBe(0);
  });

  test("when the facilitator goes silent on settle, the chain decides", async () => {
    const { f } = fakeFacilitator({ settle: "throw" });
    const r0 = await rail([f]);
    const req = r0.challenge(offer(), ctx);
    const payment = await pay(req);
    const { decodeTransfer } = await import("../inspect.ts");
    const id = decodeTransfer(payment.payload.transaction as string).transactionId;

    const landed = await rail([f], { mirror: fakeMirror({ id, result: "SUCCESS", credit: 10000n }) });
    expect(await landed.settle(payment, req)).toMatchObject({ success: true, transaction: id, payer: PAYER });

    const missing = await rail([f], { mirror: fakeMirror() });
    expect(await missing.settle(payment, req)).toMatchObject({ success: false, errorReason: "facilitator_unavailable" });

    const short = await rail([f], { mirror: fakeMirror({ id, result: "SUCCESS", credit: 9999n }) });
    expect((await short.settle(payment, req)).success).toBe(false);
  });

  test("a facilitator that reports failure is believed only if the chain agrees", async () => {
    const { f } = fakeFacilitator({ settle: "refuse" });
    const r = await rail([f], { mirror: fakeMirror() });
    const req = r.challenge(offer(), ctx);
    expect(await r.settle(await pay(req), req)).toMatchObject({ success: false, errorReason: "transaction_failed" });
  });
});
