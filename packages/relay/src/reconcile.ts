import type { Hash } from "viem";
import { readNow } from "./exact.ts";
import type { ExactClock } from "./exact.ts";
import type { Ledger } from "./ledger.ts";
import type { ChainReader, Receipt } from "./ports.ts";

export type ReconcileContext = {
  reader: ChainReader;
  ledger: Ledger;
  now: ExactClock;
};

async function receiptFor(reader: ChainReader, hash: string): Promise<Receipt | null> {
  try {
    return await reader.getTransactionReceipt({ hash: hash as Hash });
  } catch {
    return null;
  }
}

export async function reconcilePendingRefunds(
  paymentId: string,
  ctx: ReconcileContext,
): Promise<void> {
  const pending = ctx.ledger.listPendingRefunds(paymentId);
  if (pending.length === 0) return;
  const now = readNow(ctx.now);
  for (const refund of pending) {
    const receipt = await receiptFor(ctx.reader, refund.txHash);
    if (receipt) {
      if (receipt.status === "success") {
        ctx.ledger.confirmRefund(paymentId, refund.nonce, receipt.blockNumber);
      } else {
        ctx.ledger.deleteRefund(paymentId, refund.nonce);
      }
      continue;
    }
    if (now > refund.validBefore + 60) {
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
  const receipt = await receiptFor(ctx.reader, payment.txHash);
  if (!receipt || receipt.status !== "success") return false;
  ctx.ledger.promotePending(paymentId, {
    blockNumber: receipt.blockNumber,
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
  const receipt = await receiptFor(ctx.reader, job.fundTx);
  if (!receipt || receipt.status !== "success") return false;
  return ctx.ledger.promoteJob(jobId, receipt.blockNumber);
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
