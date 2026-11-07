// The buyer's side of the scheduled checkout: one ScheduleCreate wrapping a USDC transfer, with
// the agent's signature already on the create. The transfer cannot run until the seller adds the
// second key, and it expires without moving anything if that key never comes.
import {
  AccountId,
  type Client,
  ScheduleCreateTransaction,
  Timestamp,
  TokenId,
  TransferTransaction,
} from "@hiero-ledger/sdk";
import { offerMemo } from "@countersign/rail/hedera";
import { isRemoteHederaSigner, type HederaPayer } from "./signer.ts";

const ACCOUNT_ID = /^0\.0\.\d+$/;

export interface ScheduledPaymentRequest {
  payTo: string;
  asset: string;
  /** Atomic units of `asset`. */
  amount: bigint;
  offerHash: string;
  /** Seconds from now until the schedule expires. */
  expiresInSeconds: number;
}

export interface ScheduledPayment {
  scheduleId: string;
  createTxId: string;
}

/**
 * Build and submit the schedule. Call the envelope before this; it moves no money on its own, but
 * the agent's signature on the create counts toward the transfer the schedule will run.
 */
export async function createScheduledPayment(
  agentClient: Client,
  payer: HederaPayer,
  req: ScheduledPaymentRequest,
): Promise<ScheduledPayment> {
  if (!ACCOUNT_ID.test(req.payTo)) throw new Error(`payee ${JSON.stringify(req.payTo)} is not an account id`);
  if (req.amount <= 0n) throw new Error(`scheduled amount must be positive, got ${req.amount}`);
  if (!Number.isSafeInteger(req.expiresInSeconds) || req.expiresInSeconds <= 0) {
    throw new Error(`expiresInSeconds must be a positive integer, got ${req.expiresInSeconds}`);
  }
  const memo = offerMemo(req.offerHash);
  const token = TokenId.fromString(req.asset);
  const transfer = new TransferTransaction()
    .addTokenTransfer(token, AccountId.fromString(payer.accountId), -req.amount)
    .addTokenTransfer(token, AccountId.fromString(req.payTo), req.amount)
    .setTransactionMemo(memo);
  const create = new ScheduleCreateTransaction()
    .setScheduledTransaction(transfer)
    .setScheduleMemo(memo)
    .setPayerAccountId(AccountId.fromString(payer.accountId))
    .setExpirationTime(Timestamp.fromDate(new Date(Date.now() + req.expiresInSeconds * 1000)))
    .setWaitForExpiry(false);

  if (isRemoteHederaSigner(payer.key)) {
    throw new Error("The scheduled hedera rail signs with a local key only.");
  }
  await create.freezeWith(agentClient);
  await create.sign(payer.key);
  const response = await create.execute(agentClient);
  const receipt = await response.getReceipt(agentClient);
  if (!receipt.scheduleId) throw new Error("schedule create returned no schedule id");
  return { scheduleId: receipt.scheduleId.toString(), createTxId: response.transactionId.toString() };
}
