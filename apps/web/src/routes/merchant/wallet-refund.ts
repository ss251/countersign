/**
 * A refund the merchant signs in their own browser wallet. The signature goes to the Whitechain
 * relay, which submits it and pays the gas; the merchant's key never leaves the wallet.
 *
 * The signing and the relay call are the relay package's own `refundOrder`, the same path the
 * merchant service uses, so the two cannot drift. This module decides only whether the connected
 * wallet can refund an order, and what the merchant reads before the wallet opens (STEER-2225 Fix 3).
 */

import { isAddress, type Address, type LocalAccount } from "viem";
import { refundOrder, walletAccount, type RefundOrderView } from "@countersign/relay/browser";
import {
  assetOf,
  formatUsdt,
  isEscrowOpen,
  isWhitechain,
  itemLabel,
  normalizeRefundReply,
  shortAddress,
  type Order,
  type RefundReason,
  type RelayStatus,
} from "./model.ts";

/** Whitechain testnet: the only chain these refunds are signed for. */
export const WHITECHAIN_CHAIN_ID = 1874;

/**
 * Statuses a wallet refund can settle: a held escrow is cancelled whole; a paid order is refunded,
 * in part or whole. Not in_review: the escrow's cancel reverts unless the job is still Funded, in
 * v1 and in v2 alike, so a delivered job's cancel signature could never settle.
 */
const REFUNDABLE = new Set(["held", "paid", "partially_refunded"]);

function same(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Null when the connected wallet can refund this order through the relay; otherwise the one
 * sentence that says why not. The wallet never opens for a refund the relay would refuse.
 */
export function walletRefusal(order: Order, wallet: string | undefined, status: RelayStatus | null): string | null {
  if (!wallet) return "Connect the merchant's wallet to refund from this page.";
  if (!isWhitechain(order)) return "Wallet refunds go through the Whitechain relayer, and this order is on another chain.";
  if (!same(wallet, order.merchant)) {
    return `The connected wallet ${shortAddress(wallet)} is not this order's merchant, ${shortAddress(order.merchant)}.`;
  }
  const payees = status?.policy?.allowedPayees ?? [];
  if (payees.length > 0 && !payees.some((payee) => same(payee, wallet))) {
    return "The relayer pays gas only for the merchants on its allowlist, and this wallet is not on it.";
  }
  if (order.kind === "escrow" && order.status === "in_review") {
    return "This job is delivered and in its review window, and the escrow cancels only a job that is not yet delivered.";
  }
  if (!REFUNDABLE.has(order.status)) return "This order has nothing left to refund.";
  return null;
}

/** A held escrow can only be cancelled whole; a paid order can be refunded in part. */
export function walletRefundIsCancel(order: Order): boolean {
  return order.kind === "escrow" && isEscrowOpen(order.status);
}

/** The order as the relay's refund client takes it. */
export function refundView(order: Order): RefundOrderView {
  return {
    id: order.id,
    kind: order.kind,
    status: order.status,
    customer: order.customer,
    merchant: order.merchant,
    amount: order.amount,
    refunded: order.refunded,
  };
}

export interface RefundTerms {
  /** Label and value pairs, in the order the merchant reads them. */
  rows: Array<{ label: string; value: string; mono?: boolean; money?: boolean }>;
  /** What the wallet is about to sign, in plain words. */
  signs: string;
  /** What happens once it is signed. */
  happens: string;
}

/** Everything the merchant reads before the wallet opens: who gets what, on which chain, for which job. */
export function refundTerms(order: Order, amount: bigint, hubTitle?: string | null): RefundTerms {
  const cancel = walletRefundIsCancel(order);
  const asset = assetOf(order);
  return {
    rows: [
      { label: "Order", value: itemLabel(order, hubTitle) },
      { label: "To", value: order.customer, mono: true },
      { label: "Amount", value: `${formatUsdt(amount.toString())} ${asset}`, money: true },
      { label: "Chain", value: "Whitechain testnet (1874)" },
      { label: cancel ? "Job" : "Payment", value: order.id, mono: true },
    ],
    signs: cancel
      ? "Your wallet signs a cancel for this one job, under the escrow's own terms. The signature moves nothing by itself."
      : `Your wallet signs one ${asset} transfer of exactly this amount, from you to this customer. It is valid for five minutes and can be used once.`,
    happens: cancel
      ? `The relayer submits the cancel and pays the gas. The escrow returns the whole ${asset} payment to the customer.`
      : `The relayer submits it and pays the gas. The ${asset} moves from your wallet to the customer on chain.`,
  };
}

/**
 * How a wallet refund ended. "declined" and "unsigned" mean nothing left the browser; "unknown"
 * means a signature went to the relay and its answer was lost, so the merchant reloads first.
 */
export type WalletSendOutcome =
  | { kind: "declined" }
  | { kind: "unsigned" }
  | { kind: "done"; txHash: string; refunded?: string }
  | { kind: "refused"; reason: string }
  | { kind: "unknown"; reason: string };

export interface WalletSendInput {
  order: Order;
  amount: bigint;
  reason?: RefundReason;
  relayUrl: string;
  /** The escrow the relayer calls (its /status): a cancel is signed for that contract only. */
  escrow?: string;
  address: Address;
  signTypedData: LocalAccount["signTypedData"];
  /** Called once the wallet has signed, before the relay is asked. */
  onSigned?: () => void;
  fetch?: typeof fetch;
}

/**
 * Sign in the wallet, then hand the signature to the relay, through the relay package's own
 * refundOrder (the merchant service's path too, so the two cannot drift).
 */
export async function sendWalletRefund(input: WalletSendInput): Promise<WalletSendOutcome> {
  let signed = false;
  let walletError: unknown;
  const merchant = walletAccount(input.address, async (typedData) => {
    try {
      const signature = await input.signTypedData(typedData);
      signed = true;
      input.onSigned?.();
      return signature;
    } catch (error) {
      walletError = error ?? new Error("The wallet did not sign.");
      throw error;
    }
  });

  let reply: Awaited<ReturnType<typeof refundOrder>> | undefined;
  try {
    reply = await refundOrder({
      relayUrl: input.relayUrl,
      merchant,
      order: refundView(input.order),
      amount: input.amount,
      ...(input.escrow && isAddress(input.escrow, { strict: false }) ? { escrow: input.escrow } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.fetch ? { fetch: input.fetch } : {}),
    });
  } catch {
    reply = undefined;
  }

  // The relay client turns a failed direct-refund signature into a refusal of its own, so the
  // wallet's answer is read first: with no signature, nothing left the browser.
  if (walletError !== undefined) return declinedInWallet(walletError) ? { kind: "declined" } : { kind: "unsigned" };
  if (reply === undefined) return signed ? { kind: "unknown", reason: "The relay did not answer." } : { kind: "unsigned" };
  // The desk's row adds "Reload to see whether it settled", so these reasons stop at one sentence.
  if (reply.ok === "unknown") return { kind: "unknown", reason: "The refund may have been sent." };
  const settled = normalizeRefundReply(reply, 400);
  if (settled === null) return { kind: "unknown", reason: "The relay answered without a transaction." };
  if (settled.ok === "unknown") return { kind: "unknown", reason: settled.reason };
  if (settled.ok === false) return { kind: "refused", reason: settled.reason };
  return settled.refunded
    ? { kind: "done", txHash: settled.txHash, refunded: settled.refunded }
    : { kind: "done", txHash: settled.txHash };
}

/** The wallet's refusal, told apart from a real failure: declining is the merchant's choice, not an error. */
export function declinedInWallet(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String((error as { name: unknown }).name) : "";
  const code = "code" in error ? (error as { code: unknown }).code : undefined;
  const message = error instanceof Error ? error.message : "";
  return name === "UserRejectedRequestError" || code === 4001 || /user (rejected|denied)/i.test(message);
}
