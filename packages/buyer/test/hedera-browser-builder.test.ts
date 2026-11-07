import { describe, expect, test } from "bun:test";
import type { PaymentRequirements } from "@countersign/core";
import { AccountId, Timestamp, Transaction, TransactionId, TransferTransaction } from "@hiero-ledger/sdk";
import {
  buildHederaTransfer,
  bytesToBase64,
  type BuildTransferOptions,
} from "../src/hedera/build.ts";
import {
  hederaPayment,
  type RemoteHederaSigner,
} from "../src/hedera/signer.ts";

const PAYER = "0.0.11337064";
const PAY_TO = "0.0.11337065";
const FEE_PAYER = "0.0.9185802";
const NODE = "0.0.3";
const OFFER_HASH = `0x${"ab".repeat(32)}`;
const VALID_START = new Timestamp(1_793_957_000, 42);

const req: PaymentRequirements = {
  scheme: "exact",
  network: "hedera:testnet",
  amount: "30000",
  asset: "0.0.429274",
  payTo: PAY_TO,
  maxTimeoutSeconds: 180,
  extra: { feePayer: FEE_PAYER, offerHash: OFFER_HASH },
};

function fixedOptions(): BuildTransferOptions {
  return {
    nodeAccountIds: [NODE],
    transactionId: TransactionId.withValidStart(AccountId.fromString(FEE_PAYER), VALID_START),
  };
}

function capturedSigner(): { signer: RemoteHederaSigner; seen: string[] } {
  const seen: string[] = [];
  return {
    seen,
    signer: {
      remote: true,
      async signTransfer(transactionBytes: string): Promise<string> {
        seen.push(transactionBytes);
        return transactionBytes;
      },
    },
  };
}

describe("the browser builder and the agent build the same bytes", () => {
  test("fixed transaction id, one node, price 30000, fee payer 0.0.9185802", async () => {
    const browser = buildHederaTransfer(PAYER, req, fixedOptions());
    expect(bytesToBase64(browser.transaction.toBytes())).toBeTruthy();

    const { signer, seen } = capturedSigner();
    await hederaPayment({ accountId: PAYER, key: signer }, req, "https://hub.test/offers/x/call", {
      nodeAccountIds: [NODE],
      transactionId: fixedOptions().transactionId,
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(bytesToBase64(browser.transaction.toBytes()));
  });

  test("the shared builder still freezes the agent's transfer exactly", () => {
    const browser = buildHederaTransfer(PAYER, req, fixedOptions());

    const manual = new TransferTransaction()
      .addTokenTransfer(AccountId.fromString("0.0.429274"), AccountId.fromString(PAYER), -30000n)
      .addTokenTransfer(AccountId.fromString("0.0.429274"), AccountId.fromString(PAY_TO), 30000n)
      .setTransactionId(TransactionId.withValidStart(AccountId.fromString(FEE_PAYER), VALID_START))
      .setTransactionMemo(`cs1:${OFFER_HASH.slice(2)}`)
      .setTransactionValidDuration(180)
      .setNodeAccountIds([AccountId.fromString(NODE)]);
    manual.freeze();

    expect(bytesToBase64(browser.transaction.toBytes())).toBe(bytesToBase64(manual.toBytes()));

    const decoded = Transaction.fromBytes(browser.transaction.toBytes());
    expect(decoded).toBeInstanceOf(TransferTransaction);
    const transfer = decoded as TransferTransaction;
    expect(transfer.nodeAccountIds).toHaveLength(1);
    expect(transfer.nodeAccountIds?.[0]?.toString()).toBe(NODE);
    expect(transfer.transactionId?.toString()).toBe(
      TransactionId.withValidStart(AccountId.fromString(FEE_PAYER), VALID_START).toString(),
    );
    expect(transfer.transactionMemo).toBe(`cs1:${OFFER_HASH.slice(2)}`);
    expect(browser.transactionId).toBe(transfer.transactionId!.toString());
    expect(browser.validUntil).toBe(1_793_957_000 + 180);
  });
});
