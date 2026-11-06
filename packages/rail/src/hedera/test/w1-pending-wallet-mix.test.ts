import { describe, expect, test } from "bun:test";
import type { PaymentPayload, PaymentRequirements } from "@countersign/core";
import type { Facilitator } from "../facilitator.ts";
import { decodeTransfer } from "../inspect.ts";
import { offerMemo } from "../memo.ts";
import { createHederaRail } from "../rail.ts";
import { walletPaymentPayload } from "../wallet-paid.ts";
import { FEE_PAYER, offer, PAYER, transfer } from "./fixtures.ts";

// cs-w1 (B31c, PR #321 hd-30 86a25f5): verify() and settle() take the wallet-paid route whenever the payload has a
// walletTransactionId, but pending() looks only at payload.transaction. A wallet-paid claim that also carries any
// decodable transfer is therefore verified and settled as a wallet payment while the hub claims the job under the
// unrelated transfer's id. The wallet payment's own replay guard is the rail's in-memory `seen` store (the hub builds
// the rail without a persistent one), so after a hub restart the same wallet payment serves the output again.

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

async function signedTransfer(req: PaymentRequirements): Promise<string> {
  const t = await transfer({
    amount: BigInt(req.amount),
    to: req.payTo,
    feePayer: req.extra!.feePayer as string,
    memo: offerMemo(req.extra!.offerHash as string),
  });
  return t.base64;
}

describe("W1 B31c: a wallet-paid claim is never pending", () => {
  test("a wallet-paid claim that also carries a signed transfer settles first, as wallet-paid claims do", async () => {
    const rail = await createHederaRail({
      facilitators: [fakeFacilitator()],
      refreshEveryMs: 0,
      verifyPayerSignature: async () => ({ ok: true }),
      confirmTimeoutMs: 50,
    });
    const req = rail.challenge(offer(), ctx);
    const wallet = walletPaymentPayload(req, `${PAYER}@1793957000.000000001`, PAYER, SECRET);
    const mixed: PaymentPayload = { ...wallet, payload: { ...wallet.payload, transaction: await signedTransfer(req) } };

    expect(rail.pending?.(mixed)).toBeNull();
  });
});
