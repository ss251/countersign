import { describe, expect, test } from "bun:test";
import type { PaymentPayload, PaymentRequirements } from "@countersign/core";
import { HEDERA_TESTNET, USDC_TESTNET } from "../constants.ts";
import type { Facilitator } from "../facilitator.ts";
import { offerMemo } from "../memo.ts";
import type { MirrorTransaction } from "../mirror.ts";
import { createHederaRail } from "../rail.ts";
import { toMirrorTxId } from "../txid.ts";
import { FEE_PAYER, OFFER_HASH, PAYEE, PAYER } from "./fixtures.ts";

// cs-w1 adversarial test. A failing test here is a blocker.
// A wallet-paid claim is { walletTransactionId, payer }. Both are public on the mirror node the moment
// the buyer's transfer lands (the tx id even embeds the payer), and the memo binds only the offer. So a
// stranger watching the mirror can present the buyer's payment with an input of its own, within the
// maxTimeout + 300 s freshness window, and receive the delivery the buyer paid for; the buyer's own
// claim is then refused as a replay. Nothing in the claim proves the claimant is the payer.

const NOW = 1_793_957_000;
const BUYERS_TX = `${PAYER}@${NOW - 5}.000000001`;

const requirement: PaymentRequirements = {
  scheme: "exact",
  network: HEDERA_TESTNET,
  amount: "10000",
  asset: USDC_TESTNET,
  payTo: PAYEE,
  maxTimeoutSeconds: 120,
  extra: { offerHash: OFFER_HASH },
};

// The buyer's real transfer, exactly as anyone reads it from the public mirror.
const onChain: MirrorTransaction = {
  id: BUYERS_TX,
  result: "SUCCESS",
  name: "CRYPTOTRANSFER",
  consensusTimestamp: `${NOW - 4}.000000001`,
  memo: offerMemo(OFFER_HASH),
  hbar: [],
  tokens: {
    [USDC_TESTNET]: [
      { account: PAYER, amount: -10000n },
      { account: PAYEE, amount: 10000n },
    ],
  },
};

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

describe("W1 B23: anyone who reads the mirror can claim a buyer's wallet payment", () => {
  test("a claim built only from the public mirror record does not settle", async () => {
    const rail = await createHederaRail({
      facilitators: [facilitator],
      refreshEveryMs: 0,
      verifyPayerSignature: async () => ({ ok: true }),
      now: () => NOW,
      mirror,
      walletPollMs: 1,
    });

    // A stranger who never paid builds the claim from public data alone.
    const strangers: PaymentPayload = {
      x402Version: 2,
      accepted: requirement,
      payload: { walletTransactionId: BUYERS_TX, payer: PAYER },
    };
    const verified = await rail.verify(strangers, requirement);
    const settled = verified.isValid ? await rail.settle(strangers, requirement) : { success: false };
    expect(settled.success).toBe(false);
  });
});
