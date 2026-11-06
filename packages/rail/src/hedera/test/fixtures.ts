// Offline fixtures: real Hedera transactions, frozen against one fixed node and signed locally.
import { offerHash, type Offer } from "@countersign/core";
import {
  AccountId,
  Hbar,
  PrivateKey,
  Timestamp,
  TokenId,
  TopicMessageSubmitTransaction,
  TransactionId,
  TransferTransaction,
} from "@hiero-ledger/sdk";
import { USDC_TESTNET } from "../constants.ts";
import { offerMemo } from "../memo.ts";

export const PAYER = "0.0.11337064";
export const PAYEE = "0.0.11337065";
export const FEE_PAYER = "0.0.9185802";
export const FALLBACK_FEE_PAYER = "0.0.7162784";
export const NODE = AccountId.fromString("0.0.3");
export const payerKey = PrivateKey.generateECDSA();

export function offer(over: Partial<Offer> = {}): Offer {
  return {
    v: 1,
    seller: "0x00000000000000000000000000000000000000a1",
    title: "Hedera transfer builder",
    summary: "Builds an unsigned HBAR transfer for the caller to sign.",
    adapter: "mcp",
    input: { type: "object" },
    output: { type: "object" },
    price: "10000",
    deadline: 60,
    bond: "0",
    rails: ["hedera"],
    payTo: { hedera: PAYEE },
    issuedAt: 1793957000,
    ...over,
  };
}

export const OFFER_HASH = offerHash(offer());

export interface Build {
  from?: string;
  to?: string;
  amount?: bigint;
  asset?: string;
  feePayer?: string;
  memo?: string;
  /** Extra token entries appended as-is. */
  extraTokens?: { account: string; amount: bigint; token?: string }[];
  hbar?: { account: string; tinybars: bigint }[];
  sign?: boolean;
  key?: PrivateKey;
  /** Seconds offset from now for the transaction id's valid start. */
  startOffset?: number;
}

export async function transfer(b: Build = {}): Promise<{ base64: string; id: string; validStart: number }> {
  const asset = TokenId.fromString(b.asset ?? USDC_TESTNET);
  const amount = b.amount ?? 10000n;
  const tx = new TransferTransaction()
    .addTokenTransfer(asset, AccountId.fromString(b.from ?? PAYER), -amount)
    .addTokenTransfer(asset, AccountId.fromString(b.to ?? PAYEE), amount);
  for (const e of b.extraTokens ?? []) {
    tx.addTokenTransfer(TokenId.fromString(e.token ?? USDC_TESTNET), AccountId.fromString(e.account), e.amount);
  }
  for (const h of b.hbar ?? []) tx.addHbarTransfer(AccountId.fromString(h.account), Hbar.fromTinybars(h.tinybars.toString()));
  const start = new Date(Date.now() + (b.startOffset ?? 0) * 1000);
  tx.setTransactionId(TransactionId.withValidStart(AccountId.fromString(b.feePayer ?? FEE_PAYER), timestamp(start)))
    .setTransactionMemo(b.memo ?? offerMemo(OFFER_HASH))
    .setNodeAccountIds([NODE])
    .freeze();
  if (b.sign ?? true) await tx.sign(b.key ?? payerKey);
  return {
    base64: Buffer.from(tx.toBytes()).toString("base64"),
    id: tx.transactionId!.toString(),
    validStart: Math.floor(start.getTime() / 1000),
  };
}

export async function topicMessage(): Promise<string> {
  const tx = new TopicMessageSubmitTransaction()
    .setTopicId("0.0.11337070")
    .setMessage("not a payment")
    .setTransactionId(TransactionId.generate(FEE_PAYER))
    .setNodeAccountIds([NODE])
    .freeze();
  await tx.sign(payerKey);
  return Buffer.from(tx.toBytes()).toString("base64");
}

function timestamp(d: Date): Timestamp {
  return Timestamp.fromDate(d);
}
