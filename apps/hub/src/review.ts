/**
 * The buyer's escrow v2 decisions. A delivered job's buyer accepts it (paying the seller) or
 * disputes it (refunding itself); a funded job's buyer may dispute it until the deadline. The
 * buyer's typed signature is the authority, so these routes carry no hub token.
 */

import { getAddress, recoverTypedDataAddress, type Hex } from "viem";
import {
  acceptTypedData,
  disputeTypedData,
  type Rail,
  type SettleResult,
} from "./deps.ts";
import type { Context, Hono } from "hono";
import { owns, personFrom, type PrivyVerifier } from "./privy.ts";
import type { JobRecord, Store } from "./store.ts";

export interface ReviewDeps {
  store: Store;
  rails: Rail[];
  now: () => number;
  /** Privy access-token verifier. Without it, the Privy header is ignored. */
  privy?: PrivyVerifier;
}

type Action = "accept" | "dispute";

export function registerReview(app: Hono, deps: ReviewDeps): void {
  app.post("/jobs/:jobId/accept", (c) => handleReview(c, deps, "accept"));
  app.post("/jobs/:jobId/dispute", (c) => handleReview(c, deps, "dispute"));
}

async function handleReview(c: Context, deps: ReviewDeps, action: Action): Promise<Response> {
  const jobId = c.req.param("jobId");
  const job = jobId === undefined ? null : deps.store.getJob(jobId);
  if (job === null) return fail(404, "unknown-job", "Refused. That job is not known.");

  const privyCheck = await personFrom(c.req.raw.headers, deps.privy);
  if (privyCheck.kind === "refused") return fail(privyCheck.status, privyCheck.code, privyCheck.message);
  if (privyCheck.kind === "person" && !owns(privyCheck.person, job.buyer)) {
    return fail(403, "not-your-job", "Refused. This job was not bought by one of your wallets.");
  }

  const now = deps.now();
  const rail = deps.rails.find((candidate) => candidate.declaration.id === job.rail);
  const escrow = rail?.escrow;
  const chainId = rail === undefined ? null : eip155ChainId(rail.declaration.network);
  const escrowAddress = rail?.declaration.escrow;
  if (!rail || !escrow || chainId === null || escrowAddress === undefined) {
    return notReviewable();
  }

  const submitting = action === "accept" ? escrow.accept : escrow.dispute;
  if (!submitting || !reviewable(job, action, now)) return notReviewable();

  const signature = await readSignature(c);
  if (signature === null) return badSignature();

  const disputeStatus = job.status === "delivered" ? 5 : 1;

  try {
    const address = getAddress(escrowAddress);
    const signer =
      action === "accept"
        ? await recoverTypedDataAddress({
            ...acceptTypedData(chainId, address, job.jobId, job.slipHash as Hex),
            signature,
          })
        : await recoverTypedDataAddress({
            ...disputeTypedData(chainId, address, job.jobId, disputeStatus),
            signature,
          });
    if (signer.toLowerCase() !== job.buyer.toLowerCase()) return badSignature();
  } catch {
    return badSignature();
  }

  let result: SettleResult;
  try {
    result =
      action === "accept"
        ? await escrow.accept!(job.jobId, signature)
        : await escrow.dispute!(job.jobId, disputeStatus, signature);
  } catch {
    return reviewFailed();
  }
  if (!result.success) return reviewFailed();

  const status = action === "accept" ? "released" : "disputed";
  deps.store.updateJob(job.jobId, {
    status,
    reviewOutcome: action === "accept" ? "accepted" : "disputed",
    reviewTx: result.transaction,
    closeTx: result.transaction,
    closedAt: now,
  });

  return json({ jobId: job.jobId, status, tx: result.transaction });
}

/** The state each decision needs. Boundaries are inclusive: "until T" means now <= T. */
function reviewable(job: JobRecord, action: Action, now: number): boolean {
  if (action === "accept") return job.status === "delivered" && job.slipHash !== null;
  if (job.status === "funded") return now <= job.deadline;
  if (job.status === "delivered") return job.endsAt !== null && job.endsAt !== undefined && now <= job.endsAt;
  return false;
}

async function readSignature(c: Context): Promise<Hex | null> {
  let body: unknown;
  try {
    body = await c.req.json<unknown>();
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const sig = (body as { sig?: unknown }).sig;
  return typeof sig === "string" && /^0x[0-9a-fA-F]*$/.test(sig) ? (sig as Hex) : null;
}

function eip155ChainId(network: string): number | null {
  const match = /^eip155:(\d+)$/.exec(network);
  return match === null ? null : Number(match[1]);
}

function notReviewable(): Response {
  return fail(409, "not-reviewable", "Refused. This job cannot be reviewed now.");
}

function badSignature(): Response {
  return fail(401, "bad-signature", "Refused. The review signature is not the buyer's.");
}

function reviewFailed(): Response {
  return fail(502, "review-failed", "Refused. The escrow did not take the review.");
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fail(status: number, code: string, message: string): Response {
  return json({ code, message }, status);
}
