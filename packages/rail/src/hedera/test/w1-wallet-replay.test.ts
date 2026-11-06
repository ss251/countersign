import { describe, expect, test } from "bun:test";
import type { PaymentPayload, PaymentRequirements } from "@countersign/core";
import { HEDERA_TESTNET, USDC_TESTNET } from "../constants.ts";
import type { Facilitator } from "../facilitator.ts";
import type { MirrorTransaction } from "../mirror.ts";
import { createHederaRail } from "../rail.ts";
import { toMirrorTxId } from "../txid.ts";
import { walletMemo } from "../wallet-paid.ts";
import { FEE_PAYER, OFFER_HASH, PAYEE, PAYER } from "./fixtures.ts";

// cs-w1 adversarial test (B26; runs on cs/hd-15 at 8aaf4cc and later). A failing test here is a blocker.
// One Hedera transaction has many spellings: "<payer>@<s>.000000001" and "<payer>@<s>.1" are the same
// transaction, and toMirrorTxId pads the nanos, so both find the same mirror record. The replay guard
// (seen) keys on the claimed string, and the hub's job id is keccak of settle.transaction, which is that
// same string. The slip publishes the payment as sent, secret included, and the buyer knows the secret
// anyway, so within the freshness window one payment can be claimed again under another spelling and
// served again.

const NOW = 1_793_957_000;
const SECRET = "5c".repeat(32);
const BUYERS_TX = `${PAYER}@${NOW - 5}.000000001`;
const SAME_TX = `${PAYER}@${NOW - 5}.1`;

const requirement: PaymentRequirements = {
  scheme: "exact",
  network: HEDERA_TESTNET,
  amount: "10000",
  asset: USDC_TESTNET,
  payTo: PAYEE,
  maxTimeoutSeconds: 120,
  extra: { offerHash: OFFER_HASH },
};

// The buyer's real transfer, with the commitment to its secret in the memo.
const onChain: MirrorTransaction = {
  id: BUYERS_TX,
  result: "SUCCESS",
  name: "CRYPTOTRANSFER",
  consensusTimestamp: `${NOW - 4}.000000001`,
  memo: walletMemo(OFFER_HASH, SECRET),
  hbar: [],
  tokens: {
    [USDC_TESTNET]: [
      { account: PAYER, amount: -10000n },
      { account: PAYEE, amount: 10000n },
    ],
  },
};

// The mirror answers only the canonical id, as the real one stores it.
const mirror = {
  base: "http://mirror.test",
  fetch: (async (url: string) => {
    if (url.endsWith(`/api/v1/transactions/${toMirrorTxId(onChain.id)}`)) {
      return new Response(
        JSON.stringify({
          transactions: [
            {
              transaction_id: toMirrorTxId(onChain.id),
              result: onChain.result,
              name: onChain.name,
              consensus_timestamp: onChain.consensusTimestamp,
              memo_base64: Buffer.from(onChain.memo, "utf8").toString("base64"),
              transfers: [],
              token_transfers: [
                { token_id: USDC_TESTNET, account: PAYER, amount: "-10000" },
                { token_id: USDC_TESTNET, account: PAYEE, amount: "10000" },
              ],
            },
          ],
        }),
      );
    }
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch,
};

const facilitator: Facilitator = {
  name: "unused",
  feePayer: async () => FEE_PAYER,
  async verify() {
    return { isValid: true, payer: PAYER };
  },
  async settle() {
    return { success: true, transaction: "", network: HEDERA_TESTNET, payer: PAYER };
  },
};

function claim(walletTransactionId: string): PaymentPayload {
  return { x402Version: 2, accepted: requirement, payload: { walletTransactionId, payer: PAYER, secret: SECRET } };
}

describe("W1 B26: one wallet payment settles once, however its transaction id is spelled", () => {
  test("the same transaction under another spelling is a replay", async () => {
    const rail = await createHederaRail({
      facilitators: [facilitator],
      refreshEveryMs: 0,
      verifyPayerSignature: async () => ({ ok: true }),
      now: () => NOW,
      mirror,
      walletPollMs: 1,
    });

    // The buyer's own claim settles once.
    const first = await rail.settle(claim(BUYERS_TX), requirement);
    expect(first.success).toBe(true);

    // The same payment, its id spelled with unpadded nanos.
    const verified = await rail.verify(claim(SAME_TX), requirement);
    const again = verified.isValid ? await rail.settle(claim(SAME_TX), requirement) : { success: false };
    expect(again.success).toBe(false);
  });
});
