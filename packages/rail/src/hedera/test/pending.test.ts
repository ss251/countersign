import { describe, expect, test } from "bun:test";
import type { PaymentPayload, PaymentRequirements } from "@countersign/core";
import type { Facilitator } from "../facilitator.ts";
import { decodeTransfer } from "../inspect.ts";
import { offerMemo } from "../memo.ts";
import { createHederaRail } from "../rail.ts";
import { walletPaymentPayload } from "../wallet-paid.ts";
import { FEE_PAYER, offer, PAYER, transfer } from "./fixtures.ts";

const ctx = { resource: "http://hub.test/offers/x/call", now: 1793957000 };
const SECRET = "5c".repeat(32);

function fakeFacilitator(): Facilitator {
  return {
    name: "fake",
    feePayer: async () => FEE_PAYER,
    async verify() {
      return { isValid: true, payer: PAYER };
    },
    async settle(p) {
      const id = decodeTransfer(p.payload.transaction as string).transactionId;
      return { success: true, transaction: id, network: "hedera:testnet", payer: PAYER };
    },
  };
}

async function makeRail() {
  return createHederaRail({
    facilitators: [fakeFacilitator()],
    refreshEveryMs: 0,
    verifyPayerSignature: async () => ({ ok: true }),
    confirmTimeoutMs: 50,
  });
}

async function pay(req: PaymentRequirements): Promise<PaymentPayload> {
  const t = await transfer({
    amount: BigInt(req.amount),
    to: req.payTo,
    feePayer: req.extra!.feePayer as string,
    memo: offerMemo(req.extra!.offerHash as string),
  });
  return { x402Version: 2, accepted: req, payload: { transaction: t.base64 } };
}

describe("hedera exact pending", () => {
  test("declares that it settles after delivery", async () => {
    const rail = await makeRail();
    expect(rail.settlesAfterDelivery).toBe(true);
  });

  test("reads the transaction id settle will report and the expiry from the signed transfer", async () => {
    const rail = await makeRail();
    const req = rail.challenge(offer(), ctx);
    const payment = await pay(req);
    const inspected = decodeTransfer(payment.payload.transaction as string);

    const pending = rail.pending?.(payment);
    expect(pending).toEqual({
      transaction: inspected.transactionId,
      validUntil: inspected.validStart + inspected.validDurationSeconds,
    });
    if (!pending) throw new Error("missing pending settlement");

    const settled = await rail.settle(payment, req);
    expect(settled.success).toBe(true);
    expect(settled.transaction).toBe(pending.transaction);
  });

  test("returns null for a wallet-paid claim, for garbage and for a missing transaction", async () => {
    const rail = await makeRail();
    const req = rail.challenge(offer(), ctx);

    const wallet = walletPaymentPayload(req, `${PAYER}@1793957000.000000001`, PAYER, SECRET);
    expect(rail.pending?.(wallet)).toBeNull();
    expect(rail.pending?.({ x402Version: 2, accepted: req, payload: { transaction: "not a transaction" } })).toBeNull();
    expect(rail.pending?.({ x402Version: 2, accepted: req, payload: {} })).toBeNull();
  });
});
