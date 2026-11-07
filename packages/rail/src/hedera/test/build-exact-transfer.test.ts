import { describe, expect, test } from "bun:test";
import { proto } from "@hiero-ledger/proto";
import { USDC_TESTNET } from "../constants.ts";
import { decodeTransfer } from "../inspect.ts";
import { offerMemo } from "../memo.ts";
import { buildExactTransfer } from "../privy-signer.ts";

const FROM = "0.0.7001";
const PAY_TO = "0.0.7002";
const FEE_PAYER = "0.0.9185802";
const OFFER_HASH = `0x${"ab".repeat(32)}`;
const AMOUNT = 10_000n;

function built(node = "0.0.5"): string {
  return buildExactTransfer({
    from: FROM,
    payTo: PAY_TO,
    asset: USDC_TESTNET,
    amount: AMOUNT,
    feePayer: FEE_PAYER,
    offerHash: OFFER_HASH,
    validSeconds: 180,
    node,
  });
}

describe("buildExactTransfer", () => {
  test("builds exactly one token debit and one credit, and no HBAR", () => {
    const decoded = decodeTransfer(built());
    expect(Object.keys(decoded.tokens)).toEqual([USDC_TESTNET]);
    expect(decoded.tokens[USDC_TESTNET]).toEqual([
      { account: FROM, amount: -AMOUNT },
      { account: PAY_TO, amount: AMOUNT },
    ]);
    expect(decoded.hbar).toEqual([]);
    expect(decoded.nftCount).toBe(0);
    expect(decoded.signerCount).toBe(0);
  });

  test("carries the offer memo, 180 seconds and the facilitator's transaction id", () => {
    const decoded = decodeTransfer(built());
    expect(decoded.memo).toBe(offerMemo(OFFER_HASH));
    expect(decoded.validDurationSeconds).toBe(180);
    expect(decoded.feePayer).toBe(FEE_PAYER);
    expect(decoded.transactionId.startsWith(`${FEE_PAYER}@`)).toBe(true);
  });

  test("freezes exactly one node", () => {
    for (const node of ["0.0.3", "0.0.7"]) {
      const raw = Buffer.from(built(node), "base64");
      const list = proto.TransactionList.decode(raw).transactionList;
      expect(list).toHaveLength(1);
      const signed = proto.SignedTransaction.decode(list[0]!.signedTransactionBytes!);
      const body = proto.TransactionBody.decode(signed.bodyBytes!);
      expect(body.nodeAccountID?.accountNum?.toString()).toBe(node.split(".")[2]);
      expect(body.nodeAccountID?.shardNum?.toString() ?? "0").toBe("0");
      expect(body.nodeAccountID?.realmNum?.toString() ?? "0").toBe("0");
      expect(body.transactionValidDuration?.seconds?.toString()).toBe("180");
    }
  });
});
