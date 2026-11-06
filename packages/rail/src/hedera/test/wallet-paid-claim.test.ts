import { describe, expect, test } from "bun:test";
import type { PaymentPayload, PaymentRequirements } from "@countersign/core";
import { TransferTransaction } from "@hiero-ledger/sdk";
import { HEDERA_TESTNET, USDC_TESTNET } from "../constants.ts";
import type { Facilitator } from "../facilitator.ts";
import { offerMemo } from "../memo.ts";
import type { MirrorTransaction } from "../mirror.ts";
import { createHederaRail, type HederaRailOptions } from "../rail.ts";
import { toMirrorTxId } from "../txid.ts";
import {
  buildWalletTransfer,
  newWalletSecret,
  WALLET_SECRET,
  walletCommitment,
  walletMemo,
  walletPaymentPayload,
  walletTransactionList,
} from "../wallet-paid.ts";
import { FEE_PAYER, OFFER_HASH, PAYEE, PAYER } from "./fixtures.ts";

const NOW = 1_793_957_000;
const TX = `${PAYER}@${NOW}.000000001`;
const SECRET = "5c".repeat(32);
const OTHER_SECRET = "a3".repeat(32);

function requirement(over: Partial<PaymentRequirements> = {}): PaymentRequirements {
  return {
    scheme: "exact",
    network: HEDERA_TESTNET,
    amount: "10000",
    asset: USDC_TESTNET,
    payTo: PAYEE,
    maxTimeoutSeconds: 120,
    extra: { offerHash: OFFER_HASH },
    ...over,
  };
}

function record(secret = SECRET, over: Partial<MirrorTransaction> = {}): MirrorTransaction {
  return {
    id: TX,
    result: "SUCCESS",
    name: "CRYPTOTRANSFER",
    consensusTimestamp: `${NOW - 1}.000000001`,
    memo: walletMemo(OFFER_HASH, secret),
    hbar: [],
    tokens: {
      [USDC_TESTNET]: [
        { account: PAYER, amount: -10000n },
        { account: PAYEE, amount: 10000n },
      ],
    },
    ...over,
  };
}

function rawTransaction(t: MirrorTransaction) {
  return {
    transaction_id: toMirrorTxId(t.id),
    result: t.result,
    name: t.name,
    consensus_timestamp: t.consensusTimestamp,
    memo_base64: t.memo ? Buffer.from(t.memo, "utf8").toString("base64") : null,
    transfers: t.hbar.map((h) => ({ account: h.account, amount: h.amount.toString() })),
    token_transfers: Object.entries(t.tokens).flatMap(([token_id, rows]) =>
      rows.map((r) => ({ token_id, account: r.account, amount: r.amount.toString() })),
    ),
  };
}

function fakeMirror(known: MirrorTransaction = record()) {
  return {
    base: "http://mirror.test",
    fetch: (async (url: string) => {
      if (url.endsWith(`/api/v1/transactions/${toMirrorTxId(known.id)}`)) {
        return new Response(JSON.stringify({ transactions: [rawTransaction(known)] }));
      }
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch,
  };
}

async function makeRail(over: Partial<HederaRailOptions> = {}, known: MirrorTransaction = record()) {
  const calls = { verify: 0, settle: 0 };
  const facilitator: Facilitator = {
    name: "recording",
    feePayer: async () => FEE_PAYER,
    async verify() {
      calls.verify++;
      return { isValid: true, payer: PAYER };
    },
    async settle() {
      calls.settle++;
      return { success: true, transaction: "", network: HEDERA_TESTNET, payer: PAYER };
    },
  };
  const rail = await createHederaRail({
    facilitators: [facilitator],
    refreshEveryMs: 0,
    verifyPayerSignature: async () => ({ ok: true }),
    now: () => NOW,
    mirror: fakeMirror(known),
    walletPollMs: 1,
    ...over,
  });
  return { rail, calls };
}

describe("wallet claim proof", () => {
  test("a claim with the right secret verifies and settles", async () => {
    const { rail, calls } = await makeRail();
    const req = requirement();
    const payment = walletPaymentPayload(req, TX, PAYER, SECRET);

    expect(await rail.verify(payment, req)).toEqual({ isValid: true, payer: PAYER });
    expect(await rail.settle(payment, req)).toEqual({
      success: true,
      payer: PAYER,
      transaction: TX,
      network: HEDERA_TESTNET,
    });
    expect(calls).toEqual({ verify: 0, settle: 0 });
  });

  test("the same transfer with another secret is claim_unproven on both paths", async () => {
    const { rail } = await makeRail();
    const req = requirement();
    const payment = walletPaymentPayload(req, TX, PAYER, OTHER_SECRET);

    expect(await rail.verify(payment, req)).toEqual({
      isValid: false,
      invalidReason: "claim_unproven",
      payer: PAYER,
    });
    expect(await rail.settle(payment, req)).toEqual({
      success: false,
      errorReason: "claim_unproven",
      payer: PAYER,
      transaction: "",
      network: HEDERA_TESTNET,
    });
    // A refused secret does not consume the buyer's claim.
    expect((await rail.settle(walletPaymentPayload(req, TX, PAYER, SECRET), req)).success).toBe(true);
  });

  test("a claim with no secret is malformed on both paths", async () => {
    const { rail } = await makeRail();
    const req = requirement();
    const payment: PaymentPayload = {
      x402Version: 2,
      accepted: req,
      payload: { walletTransactionId: TX, payer: PAYER },
    };

    expect(await rail.verify(payment, req)).toEqual({
      isValid: false,
      invalidReason: "malformed",
      payer: PAYER,
    });
    expect(await rail.settle(payment, req)).toEqual({
      success: false,
      errorReason: "malformed",
      payer: PAYER,
      transaction: "",
      network: HEDERA_TESTNET,
    });
  });

  test("a plain offer memo with no commitment is claim_unproven", async () => {
    const { rail } = await makeRail({}, record(SECRET, { memo: offerMemo(OFFER_HASH) }));
    const req = requirement();
    const payment = walletPaymentPayload(req, TX, PAYER, SECRET);

    expect(await rail.verify(payment, req)).toEqual({
      isValid: false,
      invalidReason: "claim_unproven",
      payer: PAYER,
    });
    expect(await rail.settle(payment, req)).toEqual({
      success: false,
      errorReason: "claim_unproven",
      payer: PAYER,
      transaction: "",
      network: HEDERA_TESTNET,
    });
  });

  test("walletMemo binds the offer and a 24-hex commitment under the memo limit", () => {
    const memo = walletMemo(OFFER_HASH, SECRET);
    expect(memo).toMatch(/^cs1:[0-9a-f]{64}\.[0-9a-f]{24}$/);
    expect(memo).toBe(`cs1:${OFFER_HASH.slice(2)}.${walletCommitment(SECRET)}`);
    expect(memo.length).toBeLessThanOrEqual(100);
  });

  test("newWalletSecret returns 64 hex characters and differs between calls", () => {
    const a = newWalletSecret();
    const b = newWalletSecret();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(WALLET_SECRET.test(a)).toBe(true);
    expect(a).not.toBe(b);
  });

  test("buildWalletTransfer carries walletMemo(hash, secret)", () => {
    const req = requirement();
    const tx = buildWalletTransfer(req, PAYER, { secret: SECRET, nodeAccountIds: ["0.0.3"] });
    const decoded = TransferTransaction.fromBytes(Buffer.from(walletTransactionList(tx), "base64"));
    expect(decoded).toBeInstanceOf(TransferTransaction);
    expect((decoded as TransferTransaction).transactionMemo).toBe(walletMemo(String(req.extra!.offerHash), SECRET));
  });
});
