import type { HubClient } from "./hub-client.ts";
import type { Journal, JournalKind } from "./journal.ts";
import type { State } from "./state.ts";

export interface ResumeSummary {
  jobId: string;
  status: string;
  appended?: JournalKind;
}

export async function resume(args: { hub: HubClient; journal: Journal; state: State; now?: number }): Promise<ResumeSummary[]> {
  const { hub, journal, state } = args;
  const at = args.now ?? Math.floor(Date.now() / 1000);
  const out: ResumeSummary[] = [];
  for (const open of journal.open()) {
    const jobId = open.jobId as string;
    const base = { at, offerHash: open.offerHash, seller: open.seller, amount: open.amount, rail: open.rail, jobId };
    let job;
    try {
      job = await hub.job(jobId);
    } catch (e) {
      out.push({ jobId, status: e instanceof Error ? e.message : "unreachable" });
      continue;
    }
    if (job.status === "released" || job.status === "settled") {
      const kind: JournalKind = job.status;
      let slipHash: string | undefined;
      if (job.slipHash) {
        const slip = await hub.slip(job.slipHash);
        state.saveSlip(slip);
        slipHash = slip.hash;
      }
      journal.append({ ...base, kind, slipHash, closeTx: job.closeTx ?? undefined });
      out.push({ jobId, status: job.status, appended: kind });
    } else if (job.status === "refunded" || job.status === "failed") {
      journal.append({ ...base, kind: job.status, closeTx: job.closeTx ?? undefined });
      out.push({ jobId, status: job.status, appended: job.status });
    } else {
      out.push({ jobId, status: job.status });
    }
  }
  return out;
}
