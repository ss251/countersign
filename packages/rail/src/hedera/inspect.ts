// Decode a buyer's partially signed Hedera transfer and check it against the requirements it claims
// to pay. This runs before any facilitator sees the payment, so a bad payment is refused with a
// countersign reason, and the facilitator's own checks become a second line rather than the only one.
import { Transaction, TransferTransaction } from "@hiero-ledger/sdk";
import { HBAR } from "./constants.ts";
import { offerHashFromMemo } from "./memo.ts";

export interface InspectedTransfer {
  transactionId: string;
  /** Account named in the transaction id: the account that pays the network fee. */
  feePayer: string;
  /** Unix seconds of the transaction id's valid start. */
  validStart: number;
  validDurationSeconds: number;
  memo: string;
  hbar: { account: string; amount: bigint }[];
  tokens: Record<string, { account: string; amount: bigint }[]>;
  nftCount: number;
  /** Distinct public keys with a signature attached. Validity is checked against the payer's on-chain key later. */
  signerCount: number;
}

export class InspectError extends Error {
  override name = "InspectError";
}

export function decodeTransfer(transactionBase64: string): InspectedTransfer {
  let tx: Transaction;
  try {
    tx = Transaction.fromBytes(Buffer.from(transactionBase64, "base64"));
  } catch {
    throw new InspectError("payment is not a serialized Hedera transaction");
  }
  if (!(tx instanceof TransferTransaction)) throw new InspectError("payment is not a TransferTransaction");
  const id = tx.transactionId;
  if (!id?.accountId || !id.validStart) throw new InspectError("payment has no transaction id");

  const hbar = [...tx.hbarTransfers].map(([account, amount]) => ({
    account: account.toString(),
    amount: BigInt(amount.toTinybars().toString()),
  }));
  const tokens: InspectedTransfer["tokens"] = {};
  for (const [token, byAccount] of tx.tokenTransfers) {
    tokens[token.toString()] = [...byAccount].map(([account, amount]) => ({
      account: account.toString(),
      amount: BigInt(amount.toString()),
    }));
  }
  let nftCount = 0;
  for (const list of tx.nftTransfers.values()) nftCount += list.length;

  const signers = new Set<string>();
  for (const pairs of tx.getSignatures().getFlatSignatureList()) {
    for (const k of pairs.keys()) signers.add(k.toStringRaw());
  }

  return {
    transactionId: id.toString(),
    feePayer: id.accountId.toString(),
    validStart: Number(id.validStart.seconds.toString()),
    validDurationSeconds: Number(tx.transactionValidDuration),
    memo: tx.transactionMemo,
    hbar,
    tokens,
    nftCount,
    signerCount: signers.size,
  };
}

/** What the hub expects one countersigned Hedera payment to be. */
export interface ExpectedTransfer {
  asset: string;
  amount: bigint;
  payTo: string;
  feePayer: string;
  offerHash: string;
}

export type TransferRefusal =
  | "wrong_fee_payer"
  | "offer_mismatch"
  | "amount_mismatch"
  | "wrong_payee"
  | "wrong_asset"
  | "extra_transfers"
  | "expired"
  | "unsigned";

export type TransferCheck =
  | { ok: true; payer: string }
  | { ok: false; reason: TransferRefusal; message: string };

const refuse = (reason: TransferRefusal, message: string): TransferCheck => ({ ok: false, reason, message });

/**
 * The strict shape countersign accepts: exactly two entries on one token, the payer debited
 * `amount` and `payTo` credited `amount`, no HBAR moved, no NFTs, fee paid by the facilitator,
 * memo naming this offer, signed, and still inside its validity window.
 */
export function checkTransfer(t: InspectedTransfer, want: ExpectedTransfer, nowSeconds: number): TransferCheck {
  if (t.feePayer !== want.feePayer) {
    return refuse("wrong_fee_payer", `Refused. The payment names fee payer ${t.feePayer}, not ${want.feePayer}.`);
  }
  const memoHash = offerHashFromMemo(t.memo);
  if (!memoHash || memoHash !== want.offerHash.toLowerCase()) {
    return refuse("offer_mismatch", "Refused. The payment was signed for a different offer.");
  }
  if (want.asset === HBAR) {
    return refuse("wrong_asset", "Refused. This rail settles in an HTS token, not HBAR.");
  }
  const tokenIds = Object.keys(t.tokens);
  if (tokenIds.length !== 1 || tokenIds[0] !== want.asset) {
    return refuse("wrong_asset", `Refused. The payment must move only ${want.asset}.`);
  }
  if (t.hbar.length > 0 || t.nftCount > 0) {
    return refuse("extra_transfers", "Refused. The payment moves more than the price.");
  }
  const entries = t.tokens[want.asset]!;
  const credits = entries.filter((e) => e.amount > 0n);
  const debits = entries.filter((e) => e.amount < 0n);
  if (entries.length !== 2 || credits.length !== 1 || debits.length !== 1) {
    return refuse("extra_transfers", "Refused. The payment must be one debit and one credit.");
  }
  const credit = credits[0]!;
  const debit = debits[0]!;
  if (credit.account !== want.payTo) {
    return refuse("wrong_payee", `Refused. The payment pays ${credit.account}, not the seller ${want.payTo}.`);
  }
  if (credit.amount !== want.amount || -debit.amount !== want.amount) {
    return refuse("amount_mismatch", "Refused. The price moved after you signed.");
  }
  if (debit.account === want.feePayer || debit.account === want.payTo) {
    return refuse("extra_transfers", "Refused. The fee payer or the seller cannot be the payer.");
  }
  if (t.signerCount === 0) return refuse("unsigned", "Refused. The payment carries no signature.");
  if (nowSeconds >= t.validStart + t.validDurationSeconds) {
    return refuse("expired", "Refused. The signed payment expired before it was settled.");
  }
  return { ok: true, payer: debit.account };
}
