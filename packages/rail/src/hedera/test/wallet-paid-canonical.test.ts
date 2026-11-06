import { describe, expect, test } from "bun:test";
import type { PaymentPayload, PaymentRequirements } from "@countersign/core";
import { HEDERA_TESTNET, USDC_TESTNET } from "../constants.ts";
import type { Facilitator } from "../facilitator.ts";
import type { MirrorTransaction } from "../mirror.ts";
import { createHederaRail, type HederaRailOptions } from "../rail.ts";
import { parseTxId, toMirrorTxId } from "../txid.ts";
import { walletMemo } from "../wallet-paid.ts";
import { FEE_PAYER, OFFER_HASH, PAYEE, PAYER } from "./fixtures.ts";

// B26: one wallet payment settles once, whatever spelling of its transaction id is claimed. The key is
// the mirror record's own id, not the string the buyer sent.

const NOW = 1_793_957_000;
const SECRET = "5c".repeat(32);
const TX = `${PAYER}@${NOW}.000000001`;
const SHORT_TX = `${PAYER}@${NOW}.1`;
const ZERO_PADDED_SECONDS_TX = `${PAYER}@0${NOW}.000000001`;
const OTHER_PAYER = "0.0.11337066";

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

function claim(walletTransactionId: string, payer = PAYER): PaymentPayload {
  return { x402Version: 2, accepted: requirement(), payload: { walletTransactionId, payer, secret: SECRET } };
}

/** The record as the mirror stores it: the id is in mirror form, whatever spelling asked for it. */
function record(over: Partial<MirrorTransaction> = {}): MirrorTransaction {
  return {
    id: toMirrorTxId(TX),
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

/** The same valid start, whatever the payer or the spelling: the fake mirror answers by timestamp. */
function sameTimestamp(a: string, b: string): boolean {
  const x = parseTxId(a);
  const y = parseTxId(b);
  return BigInt(x.seconds) === BigInt(y.seconds) && BigInt(x.nanos) === BigInt(y.nanos);
}

function fakeMirror(known: MirrorTransaction = record()) {
  return {
    base: "http://mirror.test",
    fetch: (async (url: string) => {
      const prefix = "/api/v1/transactions/";
      const path = new URL(url).pathname;
      const asked = path.startsWith(prefix) ? path.slice(prefix.length) : "";
      let matches = false;
      try {
        matches = asked !== "" && sameTimestamp(asked, known.id);
      } catch {
        matches = false;
      }
      if (matches) return new Response(JSON.stringify({ transactions: [rawTransaction(known)] }));
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch,
  };
}

async function makeRail(over: Partial<HederaRailOptions> = {}, known: MirrorTransaction = record()) {
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
  return createHederaRail({
    facilitators: [facilitator],
    refreshEveryMs: 0,
    verifyPayerSignature: async () => ({ ok: true }),
    now: () => NOW,
    mirror: fakeMirror(known),
    walletPollMs: 1,
    ...over,
  });
}

describe("wallet payment canonical id", () => {
  test("a claim with unpadded nanos settles under the mirror record's canonical id", async () => {
    const rail = await makeRail();
    const settled = await rail.settle(claim(SHORT_TX), requirement());

    expect(settled).toEqual({
      success: true,
      payer: PAYER,
      transaction: `${PAYER}@${NOW}.000000001`,
      network: HEDERA_TESTNET,
    });
  });

  test("after one settle, every spelling of the same id is a replay in verify and settle", async () => {
    const rail = await makeRail();
    const req = requirement();
    expect((await rail.settle(claim(TX), req)).success).toBe(true);

    for (const spelling of [TX, SHORT_TX, ZERO_PADDED_SECONDS_TX]) {
      expect(await rail.verify(claim(spelling), req)).toEqual({
        isValid: false,
        invalidReason: "replay",
        payer: PAYER,
      });
      expect(await rail.settle(claim(spelling), req)).toEqual({
        success: false,
        errorReason: "replay",
        payer: PAYER,
        transaction: "",
        network: HEDERA_TESTNET,
      });
    }
  });

  test("the first claim also holds when it spells the id with unpadded nanos", async () => {
    const rail = await makeRail();
    const req = requirement();
    expect((await rail.settle(claim(SHORT_TX), req)).success).toBe(true);

    expect(await rail.verify(claim(TX), req)).toEqual({
      isValid: false,
      invalidReason: "replay",
      payer: PAYER,
    });
    expect(await rail.verify(claim(ZERO_PADDED_SECONDS_TX), req)).toEqual({
      isValid: false,
      invalidReason: "replay",
      payer: PAYER,
    });
  });

  test("a mirror record whose payer differs from the claimed payer is claim_unproven", async () => {
    const other = record({
      id: toMirrorTxId(`${OTHER_PAYER}@${NOW}.000000001`),
      tokens: {
        [USDC_TESTNET]: [
          { account: OTHER_PAYER, amount: -10000n },
          { account: PAYEE, amount: 10000n },
        ],
      },
    });
    const rail = await makeRail({}, other);
    const req = requirement();

    expect(await rail.verify(claim(TX), req)).toEqual({
      isValid: false,
      invalidReason: "claim_unproven",
      payer: PAYER,
    });
    expect(await rail.settle(claim(TX), req)).toEqual({
      success: false,
      errorReason: "claim_unproven",
      payer: PAYER,
      transaction: "",
      network: HEDERA_TESTNET,
    });
  });
});
