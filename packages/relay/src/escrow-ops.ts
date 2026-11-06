import type { Address, Chain, Hex, PublicClient, Transport } from "viem";
import { escrowRail } from "@countersign/rail";
import { txUrl } from "./chain.ts";
import { readNow } from "./exact.ts";
import type { CountersignContext } from "./countersign-scheme.ts";
import type { JobRecord } from "./ledger.ts";
import type { RelayCall } from "./relayer.ts";
import { WHITECHAIN_ESCROW, whitechainEscrowConfig } from "./whitechain-config.ts";

export type EscrowContext = CountersignContext & { escrow?: Address };

export type CloseStatus = "released" | "cancelled" | "refunded";

export type EscrowOpResult =
  | { ok: true; transaction: string; url: string; status: CloseStatus }
  | { ok: false; reason: string };

export type JobView = {
  jobId: string;
  chain: "none" | "funded" | "released" | "refunded";
  job: JobRecord | null;
};

function rail(ctx: EscrowContext) {
  const now = ctx.now;
  return escrowRail(
    whitechainEscrowConfig({
      escrow: ctx.escrow ?? WHITECHAIN_ESCROW,
      publicClient: ctx.chainClient as PublicClient<Transport, Chain>,
      now: () => readNow(now),
    }),
  );
}

function isJobId(value: unknown): value is Hex {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

export async function jobStatus(jobId: string, ctx: EscrowContext): Promise<JobView | null> {
  if (!isJobId(jobId)) return null;
  const job = ctx.ledger.getJob(jobId);
  let chain: JobView["chain"];
  try {
    chain = await rail(ctx).escrow!.status(jobId);
  } catch {
    chain = "none";
  }
  if (!job && chain === "none") return null;
  return { jobId, chain, job };
}

async function close(
  jobId: string,
  status: CloseStatus,
  call: (escrow: Address) => RelayCall,
  ctx: EscrowContext,
  slipHash?: Hex,
): Promise<EscrowOpResult> {
  if (!isJobId(jobId)) return { ok: false, reason: "job_not_found" };
  const known = ctx.ledger.getJob(jobId);
  const onChain = await jobStatus(jobId, ctx);
  if (!known && onChain?.chain !== "funded") return { ok: false, reason: "job_not_found" };
  if (known && known.status !== "funded" && known.status !== "pending") {
    return { ok: false, reason: "job_not_open" };
  }
  if (known?.status === "pending") {
    if (onChain?.chain !== "funded") return { ok: false, reason: "job_not_open" };
    ctx.ledger.promoteJob(jobId, known.fundBlock);
  }

  const escrow = ctx.escrow ?? WHITECHAIN_ESCROW;
  const outcome = await ctx.relayer.submit(call(escrow), (known?.buyer ?? escrow) as Address);
  switch (outcome.status) {
    case "confirmed":
      ctx.ledger.closeJob(jobId, status, outcome.txHash, slipHash, readNow(ctx.now) * 1000);
      return { ok: true, transaction: outcome.txHash, url: txUrl(outcome.txHash), status };
    case "pending":
      return { ok: false, reason: "settlement_pending" };
    case "reverted":
      return { ok: false, reason: "transaction_reverted" };
    case "refused":
      return { ok: false, reason: outcome.reason };
  }
}

const ZERO_SLIP_HASH = /^0x0{64}$/i;

export function releaseJob(
  input: { jobId: string; slipHash: Hex; sellerSig: Hex },
  ctx: EscrowContext,
): Promise<EscrowOpResult> {
  if (ZERO_SLIP_HASH.test(input.slipHash)) {
    return Promise.resolve({ ok: false, reason: "zero_slip_hash" });
  }
  return close(
    input.jobId,
    "released",
    (escrow) => ({
      kind: "escrowRelease",
      escrow,
      jobId: input.jobId as Hex,
      slipHash: input.slipHash,
      sellerSig: input.sellerSig,
    }),
    ctx,
    input.slipHash,
  );
}

export function cancelJob(input: { jobId: string; sellerSig: Hex }, ctx: EscrowContext): Promise<EscrowOpResult> {
  return close(
    input.jobId,
    "cancelled",
    (escrow) => ({ kind: "escrowCancel", escrow, jobId: input.jobId as Hex, sellerSig: input.sellerSig }),
    ctx,
  );
}

export function refundJob(input: { jobId: string }, ctx: EscrowContext): Promise<EscrowOpResult> {
  return close(
    input.jobId,
    "refunded",
    (escrow) => ({ kind: "escrowRefund", escrow, jobId: input.jobId as Hex }),
    ctx,
  );
}
