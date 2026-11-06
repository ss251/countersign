import { getAddress, type Address, type Chain, type Hex, type PublicClient, type Transport } from "viem";
import { escrowRail, type ReviewState } from "@countersign/rail";
import { txUrl } from "./chain.ts";
import { readNow } from "./exact.ts";
import type { CountersignContext } from "./countersign-scheme.ts";
import type { CloseVia, JobRecord, RefundReason } from "./ledger.ts";
import type { RelayCall } from "./relayer.ts";
import { WHITECHAIN_ESCROW, whitechainEscrowConfig } from "./whitechain-config.ts";

export type EscrowContext = CountersignContext & { escrow?: Address };

export type CloseStatus = "released" | "cancelled" | "refunded" | "delivered" | "disputed" | "failed";

export type EscrowOpResult =
  | { ok: true; transaction: string; url: string; status: CloseStatus }
  | { ok: false; reason: string };

export type JobView = {
  jobId: string;
  chain: "none" | "funded" | "released" | "refunded" | "failed" | "delivered" | "disputed";
  job: JobRecord | null;
};

function rail(ctx: EscrowContext, escrow: Address, version: 1 | 2) {
  const now = ctx.now;
  return escrowRail(
    whitechainEscrowConfig({
      escrow,
      ...(version === 2 ? { version: 2 as const } : {}),
      publicClient: ctx.chainClient as PublicClient<Transport, Chain>,
      now: () => readNow(now),
    }),
  );
}

function jobEscrow(job: JobRecord | null, ctx: EscrowContext): Address {
  if (job?.escrow) return getAddress(job.escrow);
  return ctx.escrow ?? WHITECHAIN_ESCROW;
}

function isJobId(value: unknown): value is Hex {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

export async function jobStatus(jobId: string, ctx: EscrowContext): Promise<JobView | null> {
  if (!isJobId(jobId)) return null;
  const job = ctx.ledger.getJob(jobId);
  const escrow = jobEscrow(job, ctx);
  let chain: JobView["chain"];
  try {
    chain = await rail(ctx, escrow, ctx.relayer.escrowVersion(escrow)).escrow!.status(jobId);
  } catch {
    chain = "none";
  }
  if (!job && chain === "none") return null;
  return { jobId, chain, job };
}

type CloseOptions = {
  slipHash?: Hex;
  closeReason?: RefundReason | null;
  closeVia?: CloseVia | null;
};

async function close(
  jobId: string,
  status: "released" | "cancelled" | "refunded",
  call: (escrow: Address) => RelayCall,
  ctx: EscrowContext,
  options: CloseOptions = {},
): Promise<EscrowOpResult> {
  if (!isJobId(jobId)) return { ok: false, reason: "job_not_found" };
  const known = ctx.ledger.getJob(jobId);
  const onChain = await jobStatus(jobId, ctx);
  if (!known && onChain?.chain !== "funded") return { ok: false, reason: "job_not_found" };
  if (known) {
    const open = known.status === "funded" || known.status === "pending";
    if (!open) return { ok: false, reason: "job_not_open" };
    if (known.status === "pending") {
      if (onChain?.chain !== "funded") return { ok: false, reason: "job_not_open" };
      ctx.ledger.promoteJob(jobId, known.fundBlock);
    }
  }

  const escrow = jobEscrow(known, ctx);
  const version = ctx.relayer.escrowVersion(escrow);
  const outcome = await ctx.relayer.submit(call(escrow), (known?.buyer ?? escrow) as Address);
  switch (outcome.status) {
    case "confirmed": {
      const closedAt = readNow(ctx.now) * 1000;
      if (version === 2 && status === "released") {
        const reviewOf = rail(ctx, escrow, version).escrow!.reviewOf;
        if (reviewOf) {
          let review: ReviewState | null = null;
          try {
            review = await reviewOf(jobId);
          } catch {
            // The release landed; a failed read must not turn it into an error.
          }
          if (review && review.endsAt > 0) {
            ctx.ledger.deliverJob(jobId, {
              slipHash: options.slipHash,
              deliveredAt: review.deliveredAt * 1000,
              reviewEndsAt: review.endsAt * 1000,
              reviewWindow: review.window,
            });
            return { ok: true, transaction: outcome.txHash, url: txUrl(outcome.txHash), status: "delivered" };
          }
          const recordedWindow = known?.reviewWindow ?? 0;
          if (!review && recordedWindow > 0) {
            ctx.ledger.deliverJob(jobId, {
              slipHash: options.slipHash,
              deliveredAt: closedAt,
              reviewEndsAt: closedAt + recordedWindow * 1000,
              reviewWindow: recordedWindow,
            });
            return { ok: true, transaction: outcome.txHash, url: txUrl(outcome.txHash), status: "delivered" };
          }
        }
      }
      ctx.ledger.closeJob(
        jobId,
        status,
        outcome.txHash,
        options.slipHash,
        closedAt,
        options.closeReason ?? null,
        options.closeVia ?? null,
      );
      return { ok: true, transaction: outcome.txHash, url: txUrl(outcome.txHash), status };
    }
    case "pending":
      return { ok: false, reason: "settlement_pending" };
    case "reverted":
      return { ok: false, reason: "transaction_reverted" };
    case "refused":
      return { ok: false, reason: outcome.reason };
  }
}

/** A v2-only close: the ledger must hold the job, and the job must be on the v2 escrow. */
async function closeV2(
  jobId: string,
  status: "released" | "disputed" | "failed",
  call: (escrow: Address) => RelayCall,
  ctx: EscrowContext,
  closeVia?: CloseVia | null,
): Promise<EscrowOpResult> {
  if (!isJobId(jobId)) return { ok: false, reason: "job_not_found" };
  const known = ctx.ledger.getJob(jobId);
  if (!known) return { ok: false, reason: "job_not_found" };
  const escrow = jobEscrow(known, ctx);
  if (ctx.relayer.escrowVersion(escrow) !== 2) {
    return { ok: false, reason: "not_supported_on_v1" };
  }
  if (known.status !== "funded" && known.status !== "delivered") {
    return { ok: false, reason: "job_not_open" };
  }
  const outcome = await ctx.relayer.submit(call(escrow), known.buyer as Address);
  switch (outcome.status) {
    case "confirmed":
      ctx.ledger.closeJob(
        jobId,
        status,
        outcome.txHash,
        undefined,
        readNow(ctx.now) * 1000,
        null,
        closeVia ?? null,
      );
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
    { slipHash: input.slipHash },
  );
}

export function cancelJob(
  input: { jobId: string; sellerSig: Hex; reason?: RefundReason },
  ctx: EscrowContext,
): Promise<EscrowOpResult> {
  return close(
    input.jobId,
    "cancelled",
    (escrow) => ({ kind: "escrowCancel", escrow, jobId: input.jobId as Hex, sellerSig: input.sellerSig }),
    ctx,
    { closeReason: input.reason ?? null },
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

export function acceptJob(
  input: { jobId: string; buyerSig: Hex },
  ctx: EscrowContext,
): Promise<EscrowOpResult> {
  return closeV2(
    input.jobId,
    "released",
    (escrow) => ({ kind: "escrowAccept", escrow, jobId: input.jobId as Hex, buyerSig: input.buyerSig }),
    ctx,
    "accept",
  );
}

export function disputeJob(
  input: { jobId: string; status: number; buyerSig: Hex },
  ctx: EscrowContext,
): Promise<EscrowOpResult> {
  return closeV2(
    input.jobId,
    "disputed",
    (escrow) => ({
      kind: "escrowDispute",
      escrow,
      jobId: input.jobId as Hex,
      status: input.status,
      buyerSig: input.buyerSig,
    }),
    ctx,
  );
}

export function releaseAfterWindowJob(
  input: { jobId: string },
  ctx: EscrowContext,
): Promise<EscrowOpResult> {
  return closeV2(
    input.jobId,
    "released",
    (escrow) => ({ kind: "escrowReleaseAfterWindow", escrow, jobId: input.jobId as Hex }),
    ctx,
    "window",
  );
}

export function failDeliveryJob(input: { jobId: string }, ctx: EscrowContext): Promise<EscrowOpResult> {
  return closeV2(
    input.jobId,
    "failed",
    (escrow) => ({ kind: "escrowFailDelivery", escrow, jobId: input.jobId as Hex }),
    ctx,
  );
}
