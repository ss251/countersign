/**
 * The seller bond at the delivery gate. When the hub's own checks say the delivered output is
 * not the offer's, the escrow's arbiter fails the job: the buyer is made whole from the payment
 * and the seller's locked bond. A runner error or a timeout is not a gate failure; those keep
 * the ordinary deadline refund, which returns the bond to the seller.
 */

import type { SettleResult } from "./deps.ts";
import type { Rail } from "./deps.ts";
import type { Store } from "./store.ts";
import type { Hex } from "viem";

export const GATE_FAILED =
  "Refused. The seller's output does not match the offer. Your payment and the seller's bond are returned to you now.";

/**
 * Call the escrow's failDelivery when the rail supports it. Returns the buyer-facing message on
 * success, or null so the caller keeps today's message. On success the tx is stored as the job's
 * closeTx before the caller marks the job failed.
 */
export async function failOnGate(rail: Rail, jobId: Hex, store: Store): Promise<string | null> {
  const escrow = rail.escrow;
  const failDelivery = escrow?.failDelivery;
  if (!escrow || !failDelivery) return null;

  let result: SettleResult;
  try {
    result = await failDelivery.call(escrow, jobId);
  } catch {
    return null;
  }
  if (!result.success) return null;

  store.updateJob(jobId, { closeTx: result.transaction });
  return GATE_FAILED;
}
