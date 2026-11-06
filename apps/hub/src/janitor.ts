import type { Rail } from "./deps.ts";
import type { Store } from "./store.ts";

export interface JanitorDeps {
  store: Store;
  rails: Rail[];
  now: () => number;
}

/**
 * Refund every job whose money is still locked and whose deadline has arrived.
 * A failed delivery is still funded on chain, so it is swept here too.
 */
export async function runJanitor(deps: JanitorDeps): Promise<number> {
  const byId = new Map<string, Rail>();
  for (const rail of deps.rails) byId.set(rail.declaration.id, rail);

  let refunded = 0;
  for (const job of deps.store.fundedJobsPastDeadline(deps.now())) {
    const rail = byId.get(job.rail);
    const escrow = rail?.escrow;
    if (!escrow) continue;
    try {
      const result = await escrow.refund(job.jobId);
      if (!result.success) continue;
      deps.store.updateJob(job.jobId, { status: "refunded", closeTx: result.transaction });
      refunded += 1;
    } catch {
      // Leave it funded; the next pass tries again.
    }
  }
  return refunded;
}
