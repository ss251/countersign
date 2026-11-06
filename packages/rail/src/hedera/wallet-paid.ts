// Wallet-paid hedera payments: the buyer's own wallet (HashPack or Kabila) signs and executes the
// USDC transfer, and the hub checks the executed transaction on the mirror before the seller runs.
// This module is browser-safe: the web connector and the headless test wallet share the builder.
import type { PaymentPayload, PaymentRequirements } from "@countersign/core";
import { AccountId, Client, TokenId, TransactionId, TransferTransaction } from "@hiero-ledger/sdk";
import { sha256, type Hex } from "viem";
import { HEDERA_TESTNET } from "./constants.ts";
import { offerMemo } from "./memo.ts";
import type { MirrorTransaction } from "./mirror.ts";

export const WALLET_TX_ID = /^0\.0\.\d+@\d+\.\d+$/;
export const ACCOUNT = /^0\.0\.\d+$/;
export const WALLET_SECRET = /^[0-9a-f]{64}$/;

export interface WalletPayload {
  walletTransactionId: string;
  payer: string;
  secret: string;
}

/** The wallet payload when the payment names one, or null for the facilitator-signed exact path. */
export function walletPayloadOf(payload: unknown): WalletPayload | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as { walletTransactionId?: unknown; payer?: unknown; secret?: unknown };
  if (typeof p.walletTransactionId !== "string") return null;
  return { walletTransactionId: p.walletTransactionId, payer: p.payer as string, secret: p.secret as string };
}

/** The 24 hex characters a wallet memo commits to without revealing the secret. */
export function walletCommitment(secret: string): string {
  return sha256(`0x${secret}` as Hex).slice(2, 26);
}

/** The transfer memo: the offer binding plus the buyer's commitment. */
export function walletMemo(offerHash: string, secret: string): string {
  return `${offerMemo(offerHash)}.${walletCommitment(secret)}`;
}

/** A fresh 32-byte secret, lowercase hex. */
export function newWalletSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Check an executed transfer against the offer and secret it claims to pay. Pure: no clock, no network. */
export function checkWalletPayment(
  record: MirrorTransaction,
  req: PaymentRequirements,
  payer: string,
  secret: string,
  nowSeconds: number,
): { ok: true } | { ok: false; reason: string } {
  if (record.result !== "SUCCESS" || record.name !== "CRYPTOTRANSFER") {
    return { ok: false, reason: "payment_failed" };
  }
  if (record.memo.toLowerCase() !== walletMemo(String(req.extra?.offerHash), secret)) {
    return { ok: false, reason: "claim_unproven" };
  }
  const amount = BigInt(req.amount);
  const nets = new Map<string, bigint>();
  for (const t of record.tokens[req.asset] ?? []) {
    nets.set(t.account, (nets.get(t.account) ?? 0n) + t.amount);
  }
  if (nets.get(req.payTo) !== amount || nets.get(payer) !== -amount) {
    return { ok: false, reason: "amount_mismatch" };
  }
  for (const [account, net] of nets) {
    if (account !== req.payTo && account !== payer && net !== 0n) {
      return { ok: false, reason: "amount_mismatch" };
    }
  }
  if (Number(record.consensusTimestamp.split(".")[0]) < nowSeconds - (req.maxTimeoutSeconds + 300)) {
    return { ok: false, reason: "stale_payment" };
  }
  return { ok: true };
}

/** The hedera `exact` entry from a 402's accepts list, or null. */
export function findHederaExact(accepts: PaymentRequirements[]): PaymentRequirements | null {
  return accepts.find((a) => a.network === HEDERA_TESTNET && a.scheme === "exact") ?? null;
}

/** Build the unsigned transfer the wallet signs and executes. Only bytes cross the wire. */
export function buildWalletTransfer(
  req: PaymentRequirements,
  payer: string,
  opts: { secret: string; nodeAccountIds?: string[] },
): TransferTransaction {
  const amount = BigInt(req.amount);
  const token = TokenId.fromString(req.asset);
  const tx = new TransferTransaction()
    .addTokenTransfer(token, AccountId.fromString(payer), -amount)
    .addTokenTransfer(token, AccountId.fromString(req.payTo), amount)
    .setTransactionMemo(walletMemo(String(req.extra?.offerHash), opts.secret))
    .setTransactionId(TransactionId.generate(AccountId.fromString(payer)))
    .setTransactionValidDuration(120);
  const nodeAccountIds = opts.nodeAccountIds;
  const client = nodeAccountIds?.length ? undefined : Client.forTestnet();
  try {
    if (nodeAccountIds?.length) {
      tx.setNodeAccountIds(nodeAccountIds.map((id) => AccountId.fromString(id)));
      tx.freeze();
    } else {
      tx.freezeWith(client!);
    }
  } finally {
    client?.close();
  }
  return tx;
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** What `hedera_signAndExecuteTransaction` takes: the frozen transfer, base64. */
export function walletTransactionList(tx: TransferTransaction): string {
  return base64(tx.toBytes());
}

export function signAndExecuteParams(
  payer: string,
  tx: TransferTransaction,
): { signerAccountId: string; transactionList: string } {
  return { signerAccountId: `${HEDERA_TESTNET}:${payer}`, transactionList: walletTransactionList(tx) };
}

/** The x402 v2 payment the wallet client sends back in PAYMENT-SIGNATURE. */
export function walletPaymentPayload(
  req: PaymentRequirements,
  transactionId: string,
  payer: string,
  secret: string,
): PaymentPayload {
  return { x402Version: 2, accepted: req, payload: { walletTransactionId: transactionId, payer, secret } };
}
