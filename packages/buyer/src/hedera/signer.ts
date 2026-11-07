// The buyer's countersignature on the hedera rail: one ECDSA signature over a USDC transfer whose
// amount and payee come from the requirements and whose memo names the offer. The facilitator's
// fee-payer signature is still missing when this returns; only the facilitator can complete it.
import type { PaymentPayload, PaymentRequirements } from "@countersign/core";
import { AccountId, Client, PrivateKey, TokenId, Transaction, TransactionId, TransferTransaction } from "@hiero-ledger/sdk";
import { HEDERA_TESTNET, offerMemo, USDC_TESTNET } from "@countersign/rail/hedera";

const ACCOUNT_ID = /^0\.0\.\d+$/;

/**
 * A key that lives in the hub, not on this machine: the hub adds the user's signature and
 * returns the same frozen transfer, signed.
 */
export interface RemoteHederaSigner {
  remote: true;
  signTransfer(transactionBytes: string, offerHash: string): Promise<string>;
}

export interface HederaPayer {
  /** The agent's Hedera account, e.g. "0.0.11337064". */
  accountId: string;
  key: PrivateKey | RemoteHederaSigner;
}

export class HederaSignError extends Error {
  override name = "HederaSignError";
}

export function isRemoteHederaSigner(key: PrivateKey | RemoteHederaSigner): key is RemoteHederaSigner {
  return (key as { remote?: unknown }).remote === true;
}

export interface SignOptions {
  /** Tokens the agent will pay in. Defaults to testnet USDC only. */
  assets?: string[];
  /** Refuse anything above this atomic amount, whatever the envelope says. */
  maxAmount?: bigint;
  /** Node account ids to freeze with. Omitted, the transfer resolves testnet nodes. */
  nodeAccountIds?: string[];
}

function refuse(msg: string): never {
  throw new HederaSignError(msg);
}

/** Check requirements before signing anything. Returns the parsed amount. */
export function assertSignable(payer: HederaPayer, req: PaymentRequirements, opts: SignOptions = {}): bigint {
  if (req.scheme !== "exact" || req.network !== HEDERA_TESTNET) refuse("not an exact hedera:testnet requirement");
  if (!(opts.assets ?? [USDC_TESTNET]).includes(req.asset)) refuse(`will not pay in ${req.asset}`);
  if (!/^[1-9][0-9]*$/.test(req.amount)) refuse(`bad amount ${JSON.stringify(req.amount)}`);
  const amount = BigInt(req.amount);
  if (opts.maxAmount !== undefined && amount > opts.maxAmount) refuse("amount above the agent's per-payment ceiling");
  if (!ACCOUNT_ID.test(req.payTo)) refuse(`payee ${JSON.stringify(req.payTo)} is not an account id`);
  const feePayer = req.extra?.feePayer;
  if (typeof feePayer !== "string" || !ACCOUNT_ID.test(feePayer)) refuse("no facilitator fee payer in requirements");
  if (feePayer === payer.accountId || req.payTo === payer.accountId) refuse("payer cannot be the fee payer or the payee");
  if (typeof req.extra?.offerHash !== "string") refuse("no offer hash in requirements");
  return amount;
}

/** One node, picked the way a local freeze would: the caller's first, else random from the testnet set. */
function nodeAccountIdFor(nodeAccountIds: string[] | undefined): string {
  const first = nodeAccountIds?.[0];
  if (first !== undefined) return first;
  const bytes = crypto.getRandomValues(new Uint8Array(1));
  return `0.0.${3 + ((bytes[0] ?? 0) % 5)}`;
}

/** The token and hbar legs of a transfer, in a stable order, as text. */
function transferLegs(tx: TransferTransaction): string {
  const legs: string[] = [];
  for (const [tokenId, accounts] of tx.tokenTransfers) {
    for (const [accountId, amount] of accounts) {
      legs.push(`t:${tokenId.toString()}:${accountId.toString()}:${amount.toString()}`);
    }
  }
  for (const [accountId, amount] of tx.hbarTransfers) {
    legs.push(`h:${accountId.toString()}:${amount.toTinybars().toString()}`);
  }
  legs.sort();
  return legs.join("|");
}

function transferOf(encoded: string): TransferTransaction {
  let decoded: Transaction | undefined;
  try {
    decoded = Transaction.fromBytes(Buffer.from(encoded, "base64"));
  } catch {
    decoded = undefined;
  }
  if (!(decoded instanceof TransferTransaction)) refuse("The hub returned a different transfer.");
  return decoded;
}

/** The parts of the body the user's signature commits to, as the buyer built them. */
function sameBody(a: TransferTransaction, b: TransferTransaction): boolean {
  return (
    a.transactionId?.toString() === b.transactionId?.toString() &&
    a.transactionMemo === b.transactionMemo &&
    a.transactionValidDuration === b.transactionValidDuration &&
    transferLegs(a) === transferLegs(b)
  );
}

/**
 * Build and sign the transfer. Returns the base64 transaction, its id, which is fixed from here
 * on: whoever settles it, the payment lands under this id or not at all, and the unix second
 * after which the network no longer accepts it.
 */
export async function signHederaTransfer(
  payer: HederaPayer,
  req: PaymentRequirements,
  opts: SignOptions = {},
): Promise<{ transaction: string; transactionId: string; validUntil: number }> {
  const amount = assertSignable(payer, req, opts);
  const key = payer.key;
  const remote = isRemoteHederaSigner(key);
  const token = TokenId.fromString(req.asset);
  const tx = new TransferTransaction()
    .addTokenTransfer(token, AccountId.fromString(payer.accountId), -amount)
    .addTokenTransfer(token, AccountId.fromString(req.payTo), amount)
    .setTransactionId(TransactionId.generate(AccountId.fromString(req.extra!.feePayer as string)))
    .setTransactionMemo(offerMemo(req.extra!.offerHash as string))
    .setTransactionValidDuration(Math.min(req.maxTimeoutSeconds, 180));
  const nodeAccountIds = opts.nodeAccountIds;
  if (remote) {
    tx.setNodeAccountIds([AccountId.fromString(nodeAccountIdFor(nodeAccountIds))]);
    tx.freeze();
  } else {
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
  }
  const id = tx.transactionId!.toString();
  const validUntil = Number(tx.transactionId!.validStart!.seconds.toString()) + tx.transactionValidDuration;
  if (remote) {
    const frozen = Buffer.from(tx.toBytes()).toString("base64");
    const signed = await key.signTransfer(frozen, req.extra!.offerHash as string);
    if (!sameBody(transferOf(frozen), transferOf(signed))) refuse("The hub returned a different transfer.");
    return { transaction: signed, transactionId: id, validUntil };
  }
  await tx.sign(key);
  return { transaction: Buffer.from(tx.toBytes()).toString("base64"), transactionId: id, validUntil };
}

/** The x402 v2 payment the buyer sends back in PAYMENT-SIGNATURE. */
export async function hederaPayment(
  payer: HederaPayer,
  req: PaymentRequirements,
  resourceUrl?: string,
  opts: SignOptions = {},
): Promise<{ payment: PaymentPayload; transactionId: string; validUntil: number }> {
  const { transaction, transactionId, validUntil } = await signHederaTransfer(payer, req, opts);
  const payment: PaymentPayload = {
    x402Version: 2,
    accepted: req,
    payload: { transaction },
    ...(resourceUrl ? { resource: { url: resourceUrl } } : {}),
  };
  return { payment, transactionId, validUntil };
}
