// The buyer's countersignature on the hedera rail: one ECDSA signature over a USDC transfer whose
// amount and payee come from the requirements and whose memo names the offer. The facilitator's
// fee-payer signature is still missing when this returns; only the facilitator can complete it.
import type { PaymentPayload, PaymentRequirements } from "@countersign/core";
import { AccountId, Client, PrivateKey, TokenId, TransactionId, TransferTransaction } from "@hiero-ledger/sdk";
import { HEDERA_TESTNET, offerMemo, USDC_TESTNET } from "@countersign/rail/hedera";

const ACCOUNT_ID = /^0\.0\.\d+$/;

export interface HederaPayer {
  /** The agent's Hedera account, e.g. "0.0.11337064". */
  accountId: string;
  key: PrivateKey;
}

export class HederaSignError extends Error {
  override name = "HederaSignError";
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
  const token = TokenId.fromString(req.asset);
  const tx = new TransferTransaction()
    .addTokenTransfer(token, AccountId.fromString(payer.accountId), -amount)
    .addTokenTransfer(token, AccountId.fromString(req.payTo), amount)
    .setTransactionId(TransactionId.generate(AccountId.fromString(req.extra!.feePayer as string)))
    .setTransactionMemo(offerMemo(req.extra!.offerHash as string))
    .setTransactionValidDuration(Math.min(req.maxTimeoutSeconds, 180));
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
  await tx.sign(payer.key);
  const id = tx.transactionId!.toString();
  const validUntil = Number(tx.transactionId!.validStart!.seconds.toString()) + tx.transactionValidDuration;
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
