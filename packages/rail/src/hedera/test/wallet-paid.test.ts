import { describe, expect, test } from "bun:test";
import type { PaymentPayload, PaymentRequirements } from "@countersign/core";
import { TransferTransaction } from "@hiero-ledger/sdk";
import { HEDERA_TESTNET, USDC_TESTNET } from "../constants.ts";
import type { Facilitator } from "../facilitator.ts";
import type { MirrorTransaction } from "../mirror.ts";
import { createHederaRail, type HederaRailOptions } from "../rail.ts";
import { toMirrorTxId } from "../txid.ts";
import {
  ACCOUNT,
  buildWalletTransfer,
  checkWalletPayment,
  findHederaExact,
  signAndExecuteParams,
  WALLET_TX_ID,
  walletMemo,
  walletPaymentPayload,
  walletPayloadOf,
  walletTransactionList,
} from "../wallet-paid.ts";
import { FEE_PAYER, OFFER_HASH, PAYEE, PAYER } from "./fixtures.ts";

const NOW = 1_793_957_000;
const TX = `${PAYER}@${NOW}.000000001`;
const SECRET = "5c".repeat(32);

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

function record(over: Partial<MirrorTransaction> = {}): MirrorTransaction {
  return {
    id: TX,
    result: "SUCCESS",
    name: "CRYPTOTRANSFER",
    consensusTimestamp: `${NOW - 1}.000000001`,
    memo: walletMemo(OFFER_HASH, SECRET),
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

/** A mirror node that knows exactly one transaction, or none. */
function fakeMirror(known: MirrorTransaction | null = record()) {
  return {
    base: "http://mirror.test",
    fetch: (async (url: string) => {
      if (known && url.endsWith(`/api/v1/transactions/${toMirrorTxId(known.id)}`)) {
        return new Response(JSON.stringify({ transactions: [rawTransaction(known)] }));
      }
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch,
  };
}

async function makeRail(over: Partial<HederaRailOptions> = {}, known: MirrorTransaction | null = record()) {
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

describe("wallet payload and checks", () => {
  test("walletPayloadOf takes a string id and leaves every other payload to the exact path", () => {
    expect(walletPayloadOf({ walletTransactionId: TX, payer: PAYER, secret: SECRET })).toEqual({
      walletTransactionId: TX,
      payer: PAYER,
      secret: SECRET,
    });
    expect(walletPayloadOf({ transaction: "base64" })).toBeNull();
    expect(walletPayloadOf({ walletTransactionId: 7, payer: PAYER })).toBeNull();
    expect(walletPayloadOf(null)).toBeNull();
    expect(walletPayloadOf("x")).toBeNull();
  });

  test("checkWalletPayment accepts the exact transfer, memo and time", () => {
    const req = requirement();
    expect(WALLET_TX_ID.test(TX)).toBe(true);
    expect(ACCOUNT.test(PAYER)).toBe(true);
    expect(checkWalletPayment(record(), req, PAYER, SECRET, NOW)).toEqual({ ok: true });
    // The freshness floor is inclusive: maxTimeoutSeconds + 300 seconds old still passes.
    expect(checkWalletPayment(record({ consensusTimestamp: `${NOW - 420}.000000001` }), req, PAYER, SECRET, NOW)).toEqual({
      ok: true,
    });
  });

  test("checkWalletPayment names each refusal", () => {
    const req = requirement();
    const tokens = (rows: { account: string; amount: bigint }[]) => ({ [USDC_TESTNET]: rows });

    expect(checkWalletPayment(record({ result: "FAILED" }), req, PAYER, SECRET, NOW)).toEqual({
      ok: false,
      reason: "payment_failed",
    });
    expect(checkWalletPayment(record({ name: "TOKENASSOCIATE" }), req, PAYER, SECRET, NOW)).toEqual({
      ok: false,
      reason: "payment_failed",
    });
    expect(checkWalletPayment(record({ memo: "cs1:" + "0".repeat(64) }), req, PAYER, SECRET, NOW)).toEqual({
      ok: false,
      reason: "claim_unproven",
    });
    expect(checkWalletPayment(record({ memo: "not a countersign memo" }), req, PAYER, SECRET, NOW)).toEqual({
      ok: false,
      reason: "claim_unproven",
    });
    expect(
      checkWalletPayment(
        record({
          tokens: tokens([
            { account: PAYER, amount: -29999n },
            { account: PAYEE, amount: 29999n },
          ]),
        }),
        req,
        PAYER,
        SECRET,
        NOW,
      ),
    ).toEqual({ ok: false, reason: "amount_mismatch" });
    expect(
      checkWalletPayment(
        record({
          tokens: tokens([
            { account: PAYER, amount: -10000n },
            { account: "0.0.31337", amount: 10000n },
          ]),
        }),
        req,
        PAYER,
        SECRET,
        NOW,
      ),
    ).toEqual({ ok: false, reason: "amount_mismatch" });
    expect(
      checkWalletPayment(
        record({
          tokens: tokens([
            { account: PAYER, amount: -10000n },
            { account: PAYEE, amount: 10000n },
            { account: "0.0.4242", amount: 1n },
          ]),
        }),
        req,
        PAYER,
        SECRET,
        NOW,
      ),
    ).toEqual({ ok: false, reason: "amount_mismatch" });
    expect(checkWalletPayment(record({ consensusTimestamp: `${NOW - 421}.000000001` }), req, PAYER, SECRET, NOW)).toEqual({
      ok: false,
      reason: "stale_payment",
    });
  });

  test("findHederaExact picks the hedera exact entry out of a mixed list", () => {
    const hedera = requirement();
    const accepts: PaymentRequirements[] = [
      { ...hedera, network: "eip155:84532" },
      { ...hedera, scheme: "countersign" },
      { ...hedera, network: "hedera:mainnet" },
      hedera,
    ];
    expect(findHederaExact(accepts)).toBe(hedera);
    expect(findHederaExact([])).toBeNull();
  });
});

describe("buildWalletTransfer", () => {
  test("freezes the payer's debit, the seller's credit, the memo and a 120 s window", () => {
    const req = requirement();
    const tx = buildWalletTransfer(req, PAYER, { secret: SECRET, nodeAccountIds: ["0.0.3"] });
    const list = walletTransactionList(tx);

    const decoded = TransferTransaction.fromBytes(Buffer.from(list, "base64"));
    expect(decoded).toBeInstanceOf(TransferTransaction);
    const t = decoded as TransferTransaction;
    expect(t.transactionMemo).toBe(walletMemo(String(req.extra!.offerHash), SECRET));
    expect(t.transactionMemo.startsWith("cs1:")).toBe(true);
    expect(t.transactionId!.accountId!.toString()).toBe(PAYER);
    expect(t.transactionValidDuration).toBe(120);

    const transfers = [...t.tokenTransfers].flatMap(([token, byAccount]) =>
      [...byAccount].map(([account, amount]) => ({
        token: token.toString(),
        account: account.toString(),
        amount: BigInt(amount.toString()),
      })),
    );
    expect(transfers).toHaveLength(2);
    expect(transfers).toEqual(
      expect.arrayContaining([
        { token: USDC_TESTNET, account: PAYER, amount: -10000n },
        { token: USDC_TESTNET, account: PAYEE, amount: 10000n },
      ]),
    );

    const params = signAndExecuteParams(PAYER, tx);
    expect(params.signerAccountId).toBe(`hedera:testnet:${PAYER}`);
    expect(params.transactionList).toBe(list);
  });
});

describe("hedera rail wallet branch", () => {
  test("a wallet payment verifies on the mirror and settles without a facilitator", async () => {
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

  test("a settled wallet payment is a replay on both paths", async () => {
    const { rail, calls } = await makeRail();
    const req = requirement();
    const payment = walletPaymentPayload(req, TX, PAYER, SECRET);

    expect((await rail.settle(payment, req)).success).toBe(true);
    expect(await rail.verify(payment, req)).toEqual({ isValid: false, invalidReason: "replay", payer: PAYER });
    expect(await rail.settle(payment, req)).toEqual({
      success: false,
      errorReason: "replay",
      payer: PAYER,
      transaction: "",
      network: HEDERA_TESTNET,
    });
    expect(calls).toEqual({ verify: 0, settle: 0 });
  });

  test("three malformed shapes are refused before the mirror is read", async () => {
    const { rail, calls } = await makeRail({}, null);
    const req = requirement();
    const cases: { payment: PaymentPayload; payer: string }[] = [
      { payment: walletPaymentPayload(req, "0.0.1", PAYER, SECRET), payer: PAYER },
      { payment: walletPaymentPayload(req, TX, "0.0", SECRET), payer: "0.0" },
      { payment: walletPaymentPayload(req, `${PAYEE}@${NOW}.000000001`, PAYER, SECRET), payer: PAYER },
    ];
    for (const c of cases) {
      expect(await rail.verify(c.payment, req)).toEqual({
        isValid: false,
        invalidReason: "malformed",
        payer: c.payer,
      });
      expect(await rail.settle(c.payment, req)).toEqual({
        success: false,
        errorReason: "malformed",
        payer: c.payer,
        transaction: "",
        network: HEDERA_TESTNET,
      });
    }
    expect(calls).toEqual({ verify: 0, settle: 0 });
  });

  test("an unseen wallet payment is payment_not_found once the wait is over", async () => {
    const { rail } = await makeRail({ walletWaitMs: 0 }, null);
    const req = requirement();
    expect(await rail.verify(walletPaymentPayload(req, TX, PAYER, SECRET), req)).toEqual({
      isValid: false,
      invalidReason: "payment_not_found",
      payer: PAYER,
    });
  });

  test("a failed record, another memo, another price, another payee, a third party and a stale time are refused", async () => {
    const req = requirement();
    const tokens = (rows: { account: string; amount: bigint }[]) => ({ [USDC_TESTNET]: rows });
    const cases: { why: string; known: MirrorTransaction; reason: string }[] = [
      { why: "failed", known: record({ result: "FAILED" }), reason: "payment_failed" },
      { why: "another memo", known: record({ memo: "cs1:" + "1".repeat(64) }), reason: "claim_unproven" },
      {
        why: "29999",
        known: record({
          tokens: tokens([
            { account: PAYER, amount: -29999n },
            { account: PAYEE, amount: 29999n },
          ]),
        }),
        reason: "amount_mismatch",
      },
      {
        why: "another payee",
        known: record({
          tokens: tokens([
            { account: PAYER, amount: -10000n },
            { account: "0.0.31337", amount: 10000n },
          ]),
        }),
        reason: "amount_mismatch",
      },
      {
        why: "a third party moving USDC",
        known: record({
          tokens: tokens([
            { account: PAYER, amount: -10000n },
            { account: PAYEE, amount: 10000n },
            { account: "0.0.4242", amount: 1n },
          ]),
        }),
        reason: "amount_mismatch",
      },
      {
        why: "stale",
        known: record({ consensusTimestamp: `${NOW - 421}.000000001` }),
        reason: "stale_payment",
      },
    ];
    for (const c of cases) {
      const { rail } = await makeRail({}, c.known);
      expect({ why: c.why, result: await rail.verify(walletPaymentPayload(req, TX, PAYER, SECRET), req) }).toEqual({
        why: c.why,
        result: { isValid: false, invalidReason: c.reason, payer: PAYER },
      });
    }
  });
});
