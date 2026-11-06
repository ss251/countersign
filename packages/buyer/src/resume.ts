import { createPublicClient, http, type Hex } from "viem";
import type { Envelope, Network } from "@countersign/core";
import type { HubClient } from "./hub-client.ts";
import type { Journal, JournalEntry, JournalKind } from "./journal.ts";
import { KNOWN_RAILS, type KnownRail } from "./known-rails.ts";
import { publishEnvelope, type SigningAccount } from "./mirror.ts";
import type { State } from "./state.ts";

export interface ResumeSummary {
  jobId: string;
  status: string;
  appended?: JournalKind;
}

export type JobStatusReader = (rail: KnownRail, jobId: Hex) => Promise<number>;

/** Minimal escrow view: status 3 is Refunded. */
export const JOB_OF_ABI = [
  {
    type: "function",
    name: "jobOf",
    stateMutability: "view",
    inputs: [{ name: "jobId", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "buyer", type: "address" },
          { name: "deadline", type: "uint64" },
          { name: "status", type: "uint8" },
          { name: "payee", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "offerHash", type: "bytes32" },
          { name: "slipHash", type: "bytes32" },
        ],
      },
    ],
  },
] as const;

export async function readJobStatus(rail: KnownRail, jobId: Hex): Promise<number> {
  const client = createPublicClient({ transport: http(rail.rpcUrl) });
  const job = await client.readContract({
    address: rail.escrow,
    abi: JOB_OF_ABI,
    functionName: "jobOf",
    args: [jobId],
  });
  return Number(job.status);
}

function railFor(entry: JournalEntry, known: KnownRail[]): KnownRail | undefined {
  const network: Network | undefined = entry.network;
  if (network) return known.find((rail) => rail.network === network);
  if (entry.rail === "whitechain") return known.find((rail) => rail.network === "eip155:1874");
  if (entry.rail) return known.find((rail) => rail.network === "eip155:5042002");
  return undefined;
}

export async function resume(args: {
  hub: HubClient;
  journal: Journal;
  state: State;
  now?: number;
  known?: KnownRail[];
  readJobStatus?: JobStatusReader;
  /** Publish the envelope mirror after the resume settles any open jobs. */
  mirror?: { account: SigningAccount; envelope: Envelope };
}): Promise<ResumeSummary[]> {
  const { hub, journal, state } = args;
  const known = args.known ?? KNOWN_RAILS;
  const read = args.readJobStatus ?? readJobStatus;
  const at = args.now ?? Math.floor(Date.now() / 1000);
  const out: ResumeSummary[] = [];
  for (const open of journal.open()) {
    const jobId = open.jobId as string;
    const base = {
      at,
      offerHash: open.offerHash,
      seller: open.seller,
      amount: open.amount,
      network: open.network,
      rail: open.rail,
      reservationId: open.reservationId,
      jobId,
    };
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
    } else if (job.status === "refunded" || job.status === "disputed") {
      const rail = railFor(open, known);
      let status = 0;
      try {
        if (rail) status = await read(rail, jobId as Hex);
      } catch {
        status = 0;
      }
      // Refunded (3), Failed (4) and Disputed (6, which escrow v2 refunds at once) all leave the payment with the buyer.
      if (status !== 3 && status !== 4 && status !== 6) {
        out.push({ jobId, status: "hub says refunded; chain does not" });
        continue;
      }
      journal.append({ ...base, kind: "refunded", closeTx: job.closeTx ?? undefined });
      out.push({ jobId, status: "refunded", appended: "refunded" });
    } else if (job.status === "failed") {
      const rail = railFor(open, known);
      let status = 0;
      try {
        if (rail) status = await read(rail, jobId as Hex);
      } catch {
        status = 0;
      }
      // A Failed job pays the buyer the amount and the bond, so its budget is back too.
      if (status !== 4 && status !== 3) {
        out.push({ jobId, status: "hub says failed; chain does not" });
        continue;
      }
      journal.append({ ...base, kind: "failed", closeTx: job.closeTx ?? undefined });
      out.push({ jobId, status: job.status, appended: "failed" });
    } else {
      out.push({ jobId, status: job.status });
    }
  }
  if (args.mirror) {
    await publishEnvelope({
      hub,
      account: args.mirror.account,
      envelope: args.mirror.envelope,
      spent: journal.spend(),
      now: at,
    });
  }
  return out;
}
