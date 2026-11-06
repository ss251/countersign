import type { Hash } from "viem";
import { USDT } from "./chain.ts";
import { tokenAbi } from "./eip3009.ts";
import { readNow } from "./exact.ts";
import type { ExactClock } from "./exact.ts";
import type { Ledger } from "./ledger.ts";
import type { ChainReader, Receipt } from "./ports.ts";

export type ReconcileContext = {
  reader: ChainReader;
  ledger: Ledger;
  now: ExactClock;
};

type ReceiptLookup =
  | { kind: "receipt"; receipt: Receipt }
  | { kind: "missing" }
  | { kind: "error" };

function errorName(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("name" in error)) return null;
  return typeof (error as { name: unknown }).name === "string"
    ? (error as { name: string }).name
    : null;
}

async function receiptFor(reader: ChainReader, hash: string): Promise<ReceiptLookup> {
  try {
    const receipt = await reader.getTransactionReceipt({ hash: hash as Hash });
    return receipt ? { kind: "receipt", receipt } : { kind: "missing" };
  } catch (error) {
    if (errorName(error) === "TransactionReceiptNotFoundError") return { kind: "missing" };
    return { kind: "error" };
  }
}

/** The merchant that signed the refund authorisation. */
function refundFrom(paymentId: string, ctx: ReconcileContext): string | null {
  const payment = ctx.ledger.getPayment(paymentId);
  if (payment) return payment.payTo;
  const job = ctx.ledger.getJob(paymentId);
  return job ? job.payee : null;
}

export async function reconcilePendingRefunds(
  paymentId: string,
  ctx: ReconcileContext,
): Promise<void> {
  const pending = ctx.ledger.listPendingRefunds(paymentId);
  if (pending.length === 0) return;
  const now = readNow(ctx.now);
  for (const refund of pending) {
    const lookup = await receiptFor(ctx.reader, refund.txHash);
    if (lookup.kind === "error") continue;
    if (lookup.kind === "receipt") {
      if (lookup.receipt.status === "success") {
        ctx.ledger.confirmRefund(paymentId, refund.nonce, lookup.receipt.blockNumber);
      } else {
        ctx.ledger.deleteRefund(paymentId, refund.nonce);
      }
      continue;
    }

    const from = refundFrom(paymentId, ctx);
    if (!from) continue;
    let used: boolean;
    try {
      used = (await ctx.reader.readContract({
        address: USDT.address,
        abi: tokenAbi,
        functionName: "authorizationState",
        args: [from, refund.nonce],
      })) as boolean;
    } catch {
      continue;
    }
    if (used === true) {
      ctx.ledger.confirmRefund(paymentId, refund.nonce, 0n);
      continue;
    }
    if (used === false && now > refund.validBefore + 60) {
      ctx.ledger.deleteRefund(paymentId, refund.nonce);
    }
  }
}

export async function reconcilePendingPayment(
  paymentId: string,
  ctx: ReconcileContext,
): Promise<boolean> {
  const payment = ctx.ledger.getPayment(paymentId);
  if (!payment || payment.status !== "pending") return false;
  const lookup = await receiptFor(ctx.reader, payment.txHash);
  if (lookup.kind !== "receipt" || lookup.receipt.status !== "success") return false;
  ctx.ledger.promotePending(paymentId, {
    blockNumber: lookup.receipt.blockNumber,
    settledAt: readNow(ctx.now) * 1000,
  });
  return true;
}

export async function reconcilePendingJob(
  jobId: string,
  ctx: ReconcileContext,
): Promise<boolean> {
  const job = ctx.ledger.getJob(jobId);
  if (!job || job.status !== "pending") return false;
  const lookup = await receiptFor(ctx.reader, job.fundTx);
  if (lookup.kind !== "receipt" || lookup.receipt.status !== "success") return false;
  return ctx.ledger.promoteJob(jobId, lookup.receipt.blockNumber);
}

export async function reconcileOrder(
  orderId: string,
  ctx: ReconcileContext,
): Promise<void> {
  const order = ctx.ledger.getOrder(orderId);
  if (!order || order.status !== "pending") return;
  if (order.kind === "escrow") {
    await reconcilePendingJob(orderId, ctx);
  } else {
    await reconcilePendingPayment(orderId, ctx);
  }
}
