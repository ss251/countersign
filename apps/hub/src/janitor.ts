import type { Rail } from "./deps.ts";
import type { Store } from "./store.ts";

export interface JanitorDeps {
  store: Store;
  rails: Rail[];
  now: () => number;
}

/**
 * Close jobs whose money is still locked: release a delivered job after its review window, and
 * refund a job the seller never delivered once the settle window has passed. A failed delivery is
 * still funded on chain, so it is swept with the refunds too.
 */
export async function runJanitor(deps: JanitorDeps): Promise<number> {
  const byId = new Map<string, Rail>();
  for (const rail of deps.rails) byId.set(rail.declaration.id, rail);

  const now = deps.now();
  let closed = 0;

  for (const job of deps.store.deliveredJobsPastWindow(now)) {
    const escrow = byId.get(job.rail)?.escrow;
    const release = escrow?.releaseAfterWindow;
    if (!escrow || !release) continue;
    try {
      const result = await release.call(escrow, job.jobId);
      if (!result.success) continue;
      deps.store.updateJob(job.jobId, {
        status: "released",
        reviewOutcome: "window-elapsed",
        reviewTx: result.transaction,
        closeTx: result.transaction,
        closedAt: now,
      });
      closed += 1;
    } catch {
      // Leave it delivered; the next pass tries again.
    }
  }

  for (const job of deps.store.fundedJobsPastDeadline(now)) {
    const escrow = byId.get(job.rail)?.escrow;
    if (!escrow) continue;
    // On v2 the deadline refund opens only after deadline + DISPUTE_WINDOW, so release and
    // failDelivery keep their full window first. v1 has a zero window, exactly as before.
    if (now <= job.deadline + (escrow.disputeWindowSeconds ?? 0)) continue;
    try {
      const result = await escrow.refund(job.jobId);
      if (!result.success) continue;
      deps.store.updateJob(job.jobId, { status: "refunded", closeTx: result.transaction });
      closed += 1;
    } catch {
      // Leave it funded; the next pass tries again.
    }
  }
  return closed;
}
