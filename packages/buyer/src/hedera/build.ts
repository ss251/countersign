// The browser-safe half of the hedera buyer: one USDC transfer, frozen exactly as the agent freezes
// it, with only constants and the memo helper imported from the rail. No Buffer and no rail index,
// so the console can bundle the same builder the agent runs.
import type { PaymentRequirements } from "@countersign/core";
import { AccountId, Client, TokenId, TransactionId, TransferTransaction } from "@hiero-ledger/sdk";
import { offerMemo } from "../../../rail/src/hedera/memo.ts";

export { HEDERA_TESTNET, USDC_TESTNET } from "../../../rail/src/hedera/constants.ts";
export { offerMemo } from "../../../rail/src/hedera/memo.ts";

export interface BuildTransferOptions {
  /** Node account ids to freeze with. Omitted, the transfer resolves testnet nodes like the agent. */
  nodeAccountIds?: string[];
  /** Test seam: freeze under a fixed transaction id so two builders can be compared. */
  transactionId?: TransactionId;
}

/** One node, picked the way a local freeze would: the caller's first, else random from the testnet set. */
export function nodeAccountIdFor(nodeAccountIds: string[] | undefined): string {
  const first = nodeAccountIds?.[0];
  if (first !== undefined) return first;
  const bytes = crypto.getRandomValues(new Uint8Array(1));
  return `0.0.${3 + ((bytes[0] ?? 0) % 5)}`;
}

/** Base64 for browsers and Bun alike: no Buffer, so the console bundle needs no Node shim. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Build and freeze the transfer from requirements the caller has already checked. The amount, payee,
 * transaction id account, memo and valid duration are the agent's; the returned transaction is frozen,
 * so its bytes are final and the card's HashPack signature commits to exactly those bytes.
 */
export function buildHederaTransfer(
  payerAccountId: string,
  req: PaymentRequirements,
  opts: BuildTransferOptions = {},
): { transaction: TransferTransaction; transactionId: string; validUntil: number } {
  const amount = BigInt(req.amount);
  const token = TokenId.fromString(req.asset);
  const transactionId =
    opts.transactionId ?? TransactionId.generate(AccountId.fromString(req.extra!.feePayer as string));
  const tx = new TransferTransaction()
    .addTokenTransfer(token, AccountId.fromString(payerAccountId), -amount)
    .addTokenTransfer(token, AccountId.fromString(req.payTo), amount)
    .setTransactionId(transactionId)
    .setTransactionMemo(offerMemo(req.extra!.offerHash as string))
    .setTransactionValidDuration(Math.min(req.maxTimeoutSeconds, 180));
  const nodeAccountIds = opts.nodeAccountIds;
  if (nodeAccountIds?.length) {
    tx.setNodeAccountIds(nodeAccountIds.map((id) => AccountId.fromString(id)));
    tx.freeze();
  } else {
    const client = Client.forTestnet();
    try {
      tx.freezeWith(client);
    } finally {
      client.close();
    }
  }
  const id = tx.transactionId!.toString();
  const validUntil = Number(tx.transactionId!.validStart!.seconds.toString()) + tx.transactionValidDuration;
  return { transaction: tx, transactionId: id, validUntil };
}
