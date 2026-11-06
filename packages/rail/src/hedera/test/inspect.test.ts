import { describe, expect, test } from "bun:test";
import { checkTransfer, decodeTransfer, InspectError, type ExpectedTransfer } from "../inspect.ts";
import { MEMO_PREFIX, offerHashFromMemo, offerMemo } from "../memo.ts";
import { hashscanTx, parseTxId, toMirrorTxId, toSdkTxId } from "../txid.ts";
import { FEE_PAYER, OFFER_HASH, PAYEE, PAYER, topicMessage, transfer } from "./fixtures.ts";

const want: ExpectedTransfer = {
  asset: "0.0.429274",
  amount: 10000n,
  payTo: PAYEE,
  feePayer: FEE_PAYER,
  offerHash: OFFER_HASH,
  maxTimeoutSeconds: 120,
};
const now = () => Math.floor(Date.now() / 1000);

async function reason(b: Parameters<typeof transfer>[0], w: Partial<ExpectedTransfer> = {}, at = now()) {
  const t = await transfer(b);
  const r = checkTransfer(decodeTransfer(t.base64), { ...want, ...w }, at);
  return r.ok ? "ok" : r.reason;
}

describe("memo", () => {
  test("binds a 32-byte offer hash in 68 bytes", () => {
    const m = offerMemo(OFFER_HASH);
    expect(m.startsWith(MEMO_PREFIX)).toBe(true);
    expect(m.length).toBe(68);
    expect(offerHashFromMemo(m)).toBe(OFFER_HASH);
  });
  test("normalises case and rejects anything that is not a 32-byte hash", () => {
    expect(offerMemo(OFFER_HASH.toUpperCase().replace("0X", "0x"))).toBe(offerMemo(OFFER_HASH));
    expect(() => offerMemo("0x1234")).toThrow();
    expect(() => offerMemo(OFFER_HASH.slice(2))).toThrow();
  });
  test("other memos carry no offer", () => {
    expect(offerHashFromMemo("")).toBeNull();
    expect(offerHashFromMemo("hello")).toBeNull();
    expect(offerHashFromMemo(offerMemo(OFFER_HASH) + "x")).toBeNull();
    expect(offerHashFromMemo(offerMemo(OFFER_HASH).toUpperCase())).toBeNull();
  });
});

describe("transaction ids", () => {
  test("convert between SDK and mirror forms", () => {
    expect(toMirrorTxId("0.0.9185802@1793957141.182486461")).toBe("0.0.9185802-1793957141-182486461");
    expect(toSdkTxId("0.0.9185802-1793957141-182486461")).toBe("0.0.9185802@1793957141.182486461");
    expect(parseTxId("0.0.5@1.7").nanos).toBe("000000007");
    expect(hashscanTx("0.0.9185802-1793957141-182486461")).toBe(
      "https://hashscan.io/testnet/transaction/0.0.9185802@1793957141.182486461",
    );
    expect(() => parseTxId("0xabc")).toThrow();
  });
});

describe("decodeTransfer", () => {
  test("reads a signed USDC transfer", async () => {
    const t = await transfer();
    const d = decodeTransfer(t.base64);
    expect(d.transactionId).toBe(t.id);
    expect(d.feePayer).toBe(FEE_PAYER);
    expect(d.memo).toBe(offerMemo(OFFER_HASH));
    expect(d.tokens["0.0.429274"]).toEqual([
      { account: PAYER, amount: -10000n },
      { account: PAYEE, amount: 10000n },
    ]);
    expect(d.hbar).toEqual([]);
    expect(d.signerCount).toBe(1);
  });
  test("refuses bytes that are not a transfer", async () => {
    expect(() => decodeTransfer(Buffer.from("garbage").toString("base64"))).toThrow(InspectError);
    const notATransfer = await topicMessage();
    expect(() => decodeTransfer(notATransfer)).toThrow(InspectError);
  });
});

describe("checkTransfer", () => {
  test("accepts the exact payment and names the payer", async () => {
    const t = await transfer();
    expect(checkTransfer(decodeTransfer(t.base64), want, now())).toEqual({ ok: true, payer: PAYER });
  });
  test("refuses a moved price in either direction", async () => {
    expect(await reason({ amount: 10001n })).toBe("amount_mismatch");
    expect(await reason({ amount: 9999n })).toBe("amount_mismatch");
    expect(await reason({}, { amount: 20000n })).toBe("amount_mismatch");
  });
  test("refuses a payment signed for another offer or with no countersign memo", async () => {
    expect(await reason({ memo: offerMemo("0x" + "11".repeat(32)) })).toBe("offer_mismatch");
    expect(await reason({ memo: "" })).toBe("offer_mismatch");
    expect(await reason({ memo: "thanks" })).toBe("offer_mismatch");
  });
  test("refuses the wrong fee payer, payee or token", async () => {
    expect(await reason({ feePayer: "0.0.7162784" })).toBe("wrong_fee_payer");
    expect(await reason({ to: "0.0.999" })).toBe("wrong_payee");
    expect(await reason({ asset: "0.0.1234" })).toBe("wrong_asset");
    expect(await reason({}, { asset: "0.0.0" })).toBe("wrong_asset");
  });
  test("refuses anything moved besides the price", async () => {
    expect(await reason({ hbar: [{ account: PAYER, tinybars: -1n }, { account: PAYEE, tinybars: 1n }] })).toBe(
      "extra_transfers",
    );
    // A split that still credits payTo short and someone else the rest.
    expect(
      await reason({ amount: 10000n, extraTokens: [{ account: PAYEE, amount: -1n }, { account: "0.0.777", amount: 1n }] }),
    ).not.toBe("ok");
    // A second token riding along.
    expect(
      await reason({ extraTokens: [{ account: PAYER, amount: -5n, token: "0.0.555" }, { account: PAYEE, amount: 5n, token: "0.0.555" }] }),
    ).toBe("wrong_asset");
  });
  test("refuses the fee payer as payer", async () => {
    expect(await reason({ from: FEE_PAYER })).toBe("extra_transfers");
  });
  test("refuses an unsigned payment", async () => {
    expect(await reason({ sign: false })).toBe("unsigned");
  });
  test("refuses a payment past its validity window", async () => {
    const t = await transfer();
    const d = decodeTransfer(t.base64);
    expect(checkTransfer(d, want, d.validStart + d.validDurationSeconds)).toMatchObject({ ok: false, reason: "expired" });
    expect(checkTransfer(d, want, d.validStart + d.validDurationSeconds - 1).ok).toBe(true);
  });
  test("refuses a payment that is not valid yet", async () => {
    const t = await transfer({ startOffset: 60 });
    const d = decodeTransfer(t.base64);
    expect(checkTransfer(d, want, d.validStart - 11)).toMatchObject({ ok: false, reason: "not_yet_valid" });
    expect(checkTransfer(d, want, d.validStart - 10).ok).toBe(true);
  });
  test("refuses a payment that stays valid longer than the offer allows", async () => {
    expect(await reason({}, { maxTimeoutSeconds: 119 })).toBe("validity_too_long");
    expect(await reason({}, { maxTimeoutSeconds: 120 })).toBe("ok");
  });
});
