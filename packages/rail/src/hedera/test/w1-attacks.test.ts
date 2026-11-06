import { describe, expect, test } from "bun:test";
import type { PaymentPayload, PaymentRequirements } from "@countersign/core";
import type { Facilitator } from "../facilitator.ts";
import { decodeTransfer } from "../inspect.ts";
import { offerMemo } from "../memo.ts";
import { createHederaRail } from "../rail.ts";
import { toMirrorTxId } from "../txid.ts";
import { FEE_PAYER, offer, PAYEE, PAYER, transfer } from "./fixtures.ts";

// cs-w1 adversarial tests. A failing test here is a blocker.

const ctx = { resource: "http://hub.test/offers/x/call", now: 1793957000 };

function facilitator(mode: "ok" | "duplicate"): Facilitator {
  return {
    name: "fake",
    feePayer: async () => FEE_PAYER,
    verify: async () => ({ isValid: true, payer: PAYER }),
    settle: async (p) =>
      mode === "ok"
        ? { success: true, transaction: decodeTransfer(p.payload.transaction as string).transactionId, network: "hedera:testnet", payer: PAYER }
        : { success: false, errorReason: "duplicate_transaction", transaction: "", network: "hedera:testnet" },
  };
}

function mirrorKnowing(id: string, credit: bigint) {
  return {
    base: "http://mirror.test",
    fetch: (async (url: string) => {
      if (url.endsWith(`/api/v1/transactions/${toMirrorTxId(id)}`)) {
        return new Response(
          JSON.stringify({
            transactions: [
              {
                transaction_id: toMirrorTxId(id),
                result: "SUCCESS",
                name: "CRYPTOTRANSFER",
                consensus_timestamp: "1793957001.000000001",
                memo_base64: null,
                transfers: [],
                token_transfers: [
                  { token_id: "0.0.429274", account: PAYER, amount: Number(-credit) },
                  { token_id: "0.0.429274", account: PAYEE, amount: Number(credit) },
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

async function build(f: Facilitator, mirror?: ReturnType<typeof mirrorKnowing>) {
  return createHederaRail({
    facilitators: [f],
    refreshEveryMs: 0,
    verifyPayerSignature: async () => ({ ok: true }),
    confirmTimeoutMs: 50,
    ...(mirror ? { mirror } : {}),
  });
}

describe("W1 B5: a replayed payment is delivered a second time", () => {
  test("after the first settle, the same payment on a fresh rail instance is refused", async () => {
    const first = await build(facilitator("ok"));
    const req: PaymentRequirements = first.challenge(offer(), ctx);
    const t = await transfer({
      amount: BigInt(req.amount),
      to: req.payTo,
      feePayer: req.extra!.feePayer as string,
      memo: offerMemo(req.extra!.offerHash as string),
    });
    const payment: PaymentPayload = { x402Version: 2, accepted: req, payload: { transaction: t.base64 } };
    const id = decodeTransfer(t.base64).transactionId;

    const s1 = await first.settle(payment, req);
    expect(s1.success).toBe(true);

    // A restart, a second hub instance, or a parallel call that raced the in-memory set: the
    // facilitator refuses the duplicate, the mirror node shows the original landed, and the
    // chain tiebreaker turns the duplicate into a second success.
    const second = await build(facilitator("duplicate"), mirrorKnowing(id, BigInt(req.amount)));
    const s2 = await second.settle(payment, req);
    expect(s2.success).toBe(false);
  });
});
