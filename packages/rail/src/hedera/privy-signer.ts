// The hub-side Hedera signer for a Privy server wallet. It reads the client's frozen transfer
// itself, refuses anything that is not exactly the hub's own challenge, and only then signs every
// node body through a callback that receives body bytes, never a client-supplied hash.
import { proto } from "@hiero-ledger/proto";
import { PublicKey, Transaction, TransferTransaction } from "@hiero-ledger/sdk";
import { USDC_DECIMALS } from "./constants.ts";
import { offerMemo } from "./memo.ts";

const MAX_VALID_DURATION = 180;
const MAX_CLOCK_SKEW = 30;

/** What the hub's own 402 asks for on the live hedera rail, plus the buyer's account and cap. */
export interface PrivyTransferTerms {
  /** The buyer's Hedera account: the only account allowed to be debited. */
  accountId: string;
  asset: string;
  amount: bigint;
  payTo: string;
  feePayer: string;
  offerHash: string;
  /** The smaller of HARD_CAP and the buyer's envelope for this merchant. */
  cap: bigint;
}

export type PrivyTransferRefusal =
  | "malformed"
  | "not-transfer"
  | "body-mismatch"
  | "extra-fields"
  | "custom-fees"
  | "wrong-asset"
  | "extra-tokens"
  | "nft-transfers"
  | "hbar-transfers"
  | "approval"
  | "hook-call"
  | "decimals"
  | "wrong-transfer-entries"
  | "wrong-payer-account"
  | "wrong-payee"
  | "amount-mismatch"
  | "wrong-fee-payer"
  | "not-yet-valid"
  | "expired"
  | "validity-too-long"
  | "scheduled"
  | "nonce"
  | "wrong-memo"
  | "over-cap"
  | "signed";

export type PrivyTransferCheck =
  | { ok: true; tx: TransferTransaction }
  | { ok: false; reason: PrivyTransferRefusal };

const refuse = (reason: PrivyTransferRefusal): PrivyTransferCheck => ({ ok: false, reason });

const BODY_FIELDS = new Set([
  "transactionID",
  "nodeAccountID",
  "transactionFee",
  "transactionValidDuration",
  "memo",
  "cryptoTransfer",
  "maxCustomFees",
]);

function accountIdOf(id: proto.AccountID.$Properties | null | undefined): string | null {
  if (!id || id.accountNum === null || id.accountNum === undefined) return null;
  const shard = id.shardNum != null ? id.shardNum.toString() : "0";
  const realm = id.realmNum != null ? id.realmNum.toString() : "0";
  return `${shard}.${realm}.${id.accountNum.toString()}`;
}

function tokenIdOf(id: proto.TokenID.$Properties | null | undefined): string | null {
  if (!id) return null;
  const shard = id.shardNum != null ? id.shardNum.toString() : "0";
  const realm = id.realmNum != null ? id.realmNum.toString() : "0";
  const num = id.tokenNum != null ? id.tokenNum.toString() : "0";
  return `${shard}.${realm}.${num}`;
}

interface DecodedTransfer {
  bodies: Uint8Array[];
  /** True when the client supplied any signature at all; the hub signs unsigned bytes only. */
  signed: boolean;
}

/** One body per node, from the same two protobuf shapes the SDK accepts. */
function decodeBodies(raw: Uint8Array): DecodedTransfer | null {
  let entries: proto.Transaction[];
  try {
    const list = proto.TransactionList.decode(raw).transactionList as unknown as proto.Transaction[];
    entries = list.length > 0 ? list : [proto.Transaction.decode(raw)];
  } catch {
    return null;
  }
  const bodies: Uint8Array[] = [];
  let signed = false;
  for (const entry of entries) {
    let transaction: proto.SignedTransaction;
    try {
      if (entry.signedTransactionBytes && entry.signedTransactionBytes.length > 0) {
        transaction = proto.SignedTransaction.decode(entry.signedTransactionBytes);
      } else if (entry.bodyBytes && entry.bodyBytes.length > 0) {
        transaction = proto.SignedTransaction.decode(
          proto.SignedTransaction.encode({ bodyBytes: entry.bodyBytes, sigMap: entry.sigMap }).finish(),
        );
      } else {
        return null;
      }
    } catch {
      return null;
    }
    if (!transaction.bodyBytes || transaction.bodyBytes.length === 0) return null;
    if ((transaction.sigMap?.sigPair?.length ?? 0) > 0) signed = true;
    bodies.push(transaction.bodyBytes);
  }
  return bodies.length > 0 ? { bodies, signed } : null;
}

/** The body with the node removed, re-encoded, so two bodies can be compared apart from their node. */
function withoutNode(body: proto.TransactionBody): Uint8Array {
  body.nodeAccountID = null;
  return proto.TransactionBody.encode(body).finish();
}

/**
 * H1-H5: parse the frozen transfer, require every node body to agree with the first apart from
 * the node account, and require the common body to be exactly the hub's own challenge.
 */
export function validatePrivyTransfer(
  transactionBytes: string,
  expected: PrivyTransferTerms,
  nowSeconds: number,
): PrivyTransferCheck {
  const raw = Buffer.from(transactionBytes, "base64");
  const decoded = decodeBodies(raw);
  if (decoded === null) return refuse("malformed");
  if (decoded.signed) return refuse("signed");

  let first: proto.TransactionBody | null = null;
  let baseline: Buffer | null = null;
  for (const bodyBytes of decoded.bodies) {
    let body: proto.TransactionBody;
    try {
      body = proto.TransactionBody.decode(bodyBytes);
    } catch {
      return refuse("malformed");
    }
    if (!Buffer.from(proto.TransactionBody.encode(body).finish()).equals(Buffer.from(bodyBytes))) {
      return refuse("malformed");
    }
    const comparable = Buffer.from(withoutNode(body));
    if (baseline === null) {
      baseline = comparable;
      first = body;
    } else if (!comparable.equals(baseline)) {
      return refuse("body-mismatch");
    }
  }
  if (first === null) return refuse("malformed");

  let tx: Transaction;
  try {
    tx = Transaction.fromBytes(raw);
  } catch {
    return refuse("malformed");
  }
  if (!(tx instanceof TransferTransaction)) return refuse("not-transfer");

  for (const key of Object.keys(first)) {
    if (!BODY_FIELDS.has(key)) return refuse("extra-fields");
  }
  if ((first.maxCustomFees?.length ?? 0) > 0) return refuse("custom-fees");

  const transfer = first.cryptoTransfer;
  if (!transfer) return refuse("not-transfer");

  if ((transfer.transfers?.accountAmounts?.length ?? 0) > 0) return refuse("hbar-transfers");
  const lists = transfer.tokenTransfers ?? [];
  if (lists.length === 0) return refuse("wrong-asset");
  if (lists.length > 1) return refuse("extra-tokens");
  const list = lists[0]!;
  if ((list.nftTransfers?.length ?? 0) > 0) return refuse("nft-transfers");
  if (tokenIdOf(list.token) !== expected.asset) return refuse("wrong-asset");
  const decimals = list.expectedDecimals;
  if (decimals !== undefined && decimals !== null && decimals.value !== USDC_DECIMALS) {
    return refuse("decimals");
  }

  const entries = list.transfers ?? [];
  if (entries.length !== 2) return refuse("wrong-transfer-entries");
  for (const entry of entries) {
    if (entry.isApproval === true) return refuse("approval");
    if (entry.preTxAllowanceHook != null || entry.prePostTxAllowanceHook != null) {
      return refuse("hook-call");
    }
  }
  const credits = entries.filter((entry) => BigInt((entry.amount ?? 0).toString()) > 0n);
  const debits = entries.filter((entry) => BigInt((entry.amount ?? 0).toString()) < 0n);
  if (credits.length !== 1 || debits.length !== 1) return refuse("wrong-transfer-entries");
  const debit = debits[0]!;
  const credit = credits[0]!;
  if (accountIdOf(debit.accountID) !== expected.accountId) return refuse("wrong-payer-account");
  if (accountIdOf(credit.accountID) !== expected.payTo) return refuse("wrong-payee");
  const debitAmount = -BigInt((debit.amount ?? 0).toString());
  const creditAmount = BigInt((credit.amount ?? 0).toString());
  if (debitAmount !== expected.amount || creditAmount !== expected.amount) {
    return refuse("amount-mismatch");
  }

  const id = first.transactionID;
  if (!id || !id.accountID || !id.transactionValidStart) return refuse("malformed");
  if (accountIdOf(id.accountID) !== expected.feePayer) return refuse("wrong-fee-payer");
  if (id.scheduled === true) return refuse("scheduled");
  if (Number((id.nonce ?? 0).toString()) !== 0) return refuse("nonce");
  const validStart = Number((id.transactionValidStart.seconds ?? 0).toString());
  const duration = Number((first.transactionValidDuration?.seconds ?? 0).toString());
  if (duration > MAX_VALID_DURATION) return refuse("validity-too-long");
  if (validStart > nowSeconds + MAX_CLOCK_SKEW) return refuse("not-yet-valid");
  if (validStart < nowSeconds - MAX_CLOCK_SKEW) return refuse("expired");

  let memo: string;
  try {
    memo = offerMemo(expected.offerHash);
  } catch {
    return refuse("wrong-memo");
  }
  if ((first.memo ?? "") !== memo) return refuse("wrong-memo");
  if (expected.amount > expected.cap) return refuse("over-cap");

  return { ok: true, tx: tx as TransferTransaction };
}

export interface PrivyTransferSigner {
  /** The buyer's compressed secp256k1 public key, as stored on the hub's Hedera row. */
  publicKey: string;
  /** Receives each node body's bytes and returns the 64-byte r||s signature. */
  sign: (bodyBytes: Uint8Array) => Promise<Uint8Array>;
}

/** H6: sign every node body; the SDK hands the callback each body's bytes exactly once. */
export async function signPrivyTransfer(
  tx: TransferTransaction,
  signer: PrivyTransferSigner,
): Promise<TransferTransaction> {
  const key = PublicKey.fromString(signer.publicKey);
  await tx.signWith(key, async (bodyBytes) => {
    const signature = await signer.sign(bodyBytes);
    if (signature.length !== 64) throw new Error("the signer returned an unexpected signature length");
    return signature;
  });
  return tx;
}
