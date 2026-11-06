import {
  canonicalJson,
  checkSchema,
  fromBase64Json,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  slipCommitHash,
  toBase64Json,
  isV2Terms,
  type CountersignTerms,
  type Offer,
  type PaymentPayload,
  type PaymentRequired,
  type PaymentRequirements,
  type RouteChoice,
  type SettleResult,
  type Slip,
  type VerifyResult,
  ZERO_HASH,
} from "./deps.ts";
import { explorerUrl, type Rail } from "./deps.ts";
import { keccak256, toBytes, type Hex } from "viem";
import { failOnGate } from "./bond.ts";
import { authorizationNonce, buildOrder, checksOut, termsDeadline } from "./delivery.ts";
import { bazaarExtension, firstLine, resourceFor } from "./discovery.ts";
import type { HubRouter } from "./route.ts";
import type { RunnerLink } from "./runners.ts";
import type { Fault, Store } from "./store.ts";
import { hexList, isRecord, sameText } from "./util.ts";

const CHECK_FAILED = "Refused. The payment could not be checked.";

export interface CallDeps {
  store: Store;
  rails: Rail[];
  runners: RunnerLink;
  router: HubRouter;
  now: () => number;
  publicUrl: string;
  jobTimeoutMs?: number;
}

export interface CallOutcome {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
  railId?: string;
}

export async function paidCall(
  deps: CallDeps,
  offerHash: string,
  headers: Headers,
  body: unknown,
): Promise<CallOutcome> {
  const now = deps.now();
  const stored = deps.store.getOffer(offerHash);
  if (!stored || stored.delistedAt !== null) {
    return failure(404, "unknown-offer", "Refused. That offer is not listed.");
  }
  const offer = stored.offer;
  const call = isRecord(body) ? body : {};
  const input = call.input;

  const inputCheck = checkSchema(offer.input, input);
  if (!inputCheck.ok) {
    return {
      status: 422,
      body: {
        code: "bad-input",
        message: "Refused. The input does not match the offer's schema.",
        errors: inputCheck.errors,
      },
    };
  }

  // The seller hashes the input into its slip with canonical JSON. An input the schema accepts but
  // canonical JSON refuses (a fractional or unsafe number, for example) would only fail after a
  // direct rail had already settled, so it is refused here, before any 402 or payment.
  try {
    canonicalJson(input);
  } catch (error) {
    return {
      status: 422,
      body: {
        code: "bad-input",
        message:
          "Refused. The input holds a value the slip cannot hash, such as a fractional number. Nothing was charged.",
        errors: [firstLine(error)],
      },
    };
  }

  if (!deps.runners.isOnline(stored.offerHash)) {
    return failure(503, "seller-offline", "The seller is offline. Nothing was charged.");
  }

  const resource = resourceFor(deps.publicUrl, stored.offerHash);
  const caps = deps.router.buyerCaps(headers);
  const plan = deps.router.challengeOptions(offer, resource, now, caps);
  const options = plan.options;
  if (options.length === 0) {
    return failure(503, "no-rail", "Refused. No settlement rail is configured for this offer.");
  }
  const accepts = options.map((option) => option.entry);
  const route = plan.route;

  const signatureHeader = headers.get(PAYMENT_SIGNATURE_HEADER);
  if (!signatureHeader) {
    return paymentRequired(offer, resource, accepts, undefined, undefined, route);
  }

  let payment: PaymentPayload;
  try {
    const decoded = fromBase64Json<unknown>(signatureHeader);
    if (!isRecord(decoded) || !isRecord(decoded.accepted) || !isRecord(decoded.payload)) {
      throw new Error("bad payment shape");
    }
    payment = decoded as unknown as PaymentPayload;
  } catch {
    return failure(400, "bad-payment", "Refused. The payment header does not decode.");
  }

  const match = options.find((option) => {
    const entry = option.entry;
    const accepted = payment.accepted;
    return (
      entry.scheme === accepted.scheme &&
      entry.network === accepted.network &&
      sameText(accepted.asset, entry.asset) &&
      sameText(accepted.payTo, entry.payTo) &&
      namesMatch(accepted.extra, entry.extra)
    );
  });
  if (!match) {
    return paymentRequired(
      offer,
      resource,
      accepts,
      "Refused. This offer does not take that rail.",
      undefined,
      route,
    );
  }
  const railId = match.rail.declaration.id;
  if (payment.accepted.amount !== match.entry.amount) {
    return paymentRequired(
      offer,
      resource,
      accepts,
      "Refused. The price moved after you signed.",
      railId,
      route,
    );
  }
  if (!sameText(payment.accepted.payTo, match.entry.payTo) || !sameText(payment.accepted.asset, match.entry.asset)) {
    return paymentRequired(
      offer,
      resource,
      accepts,
      "Refused. The payment does not match this offer.",
      railId,
      route,
    );
  }

  let verify: VerifyResult;
  try {
    verify = await match.rail.verify(payment, match.entry);
  } catch (error) {
    console.warn(`[hub] rail ${railId} verify failed: ${firstLine(error)}`);
    return paymentRequired(offer, resource, accepts, CHECK_FAILED, railId, route);
  }
  if (!verify.isValid) {
    return paymentRequired(
      offer,
      resource,
      accepts,
      verify.invalidReason ?? "Refused. The payment is not valid.",
      railId,
      route,
    );
  }

  const nonce = authorizationNonce(payment.payload);
  if (nonce !== null && deps.store.getJob(nonce) !== null) {
    return duplicatePayment(railId);
  }

  const payer = verify.payer ?? "";
  let settle: SettleResult;
  try {
    settle = await match.rail.settle(payment, match.entry);
  } catch (error) {
    console.warn(`[hub] rail ${railId} settle failed: ${firstLine(error)}`);
    deps.router.recordFailure(stored.offerHash, railId, now);
    deps.router.recordAttempt(stored.offerHash, payer, railId, "settle-failed", now);
    const retry = deps.router.challengeOptions(offer, resource, now, caps);
    return paymentRequired(
      offer,
      resource,
      retry.options.map((option) => option.entry),
      CHECK_FAILED,
      railId,
      retry.route,
    );
  }
  if (!settle.success) {
    deps.router.recordFailure(stored.offerHash, railId, now);
    deps.router.recordAttempt(
      stored.offerHash,
      settle.payer ?? payer,
      railId,
      "settle-failed",
      now,
    );
    const retry = deps.router.challengeOptions(offer, resource, now, caps);
    return paymentRequired(
      offer,
      resource,
      retry.options.map((option) => option.entry),
      settle.errorReason ?? "Refused. The payment could not be settled.",
      railId,
      retry.route,
    );
  }

  const jobId = nonce ?? keccak256(toBytes(settle.transaction));
  const deadline = termsDeadline(payment.payload) ?? now + offer.deadline;
  const buyer = settle.payer ?? verify.payer ?? "";
  const escrowRail = match.rail.escrow !== undefined;
  deps.router.recordSuccess(stored.offerHash, railId);
  deps.router.recordAttempt(stored.offerHash, buyer, railId, "settled", now);

  const claimed = deps.store.claimJob({
    jobId,
    offerHash: stored.offerHash,
    rail: railId,
    buyer,
    amount: match.entry.amount,
    deadline,
    status: escrowRail ? "funded" : "paid",
    payment,
    settleTx: settle.transaction,
    closeTx: null,
    slipHash: null,
    createdAt: now,
    reviewWindow: termsReviewWindow(payment),
  });
  if (!claimed) return duplicatePayment(railId);

  const order = buildOrder({
    jobId,
    offerHash: stored.offerHash,
    input,
    railId,
    network: match.rail.declaration.network,
    buyer,
    entry: match.entry,
    deadline,
    lineage: hexList(call.lineage),
  });

  const deadlineMs = (deadline - now - 5) * 1000;
  const hubLimitMs = deps.jobTimeoutMs ?? 120_000;
  const timeoutMs = Math.max(0, Math.min(hubLimitMs, deadlineMs));
  const delivered = await deps.runners.dispatch(order, timeoutMs);
  if ("fail" in delivered) {
    return failedDelivery(deps, jobId, railId, dispatchFault(delivered, hubLimitMs < deadlineMs), escrowRail);
  }

  if (!(await checksOut(offer.seller, offer.output, order, payment, settle, delivered))) {
    const gate = await failOnGate(match.rail, jobId, deps.store, now);
    return failedDelivery(deps, jobId, railId, "seller", escrowRail, gate ?? undefined);
  }

  let closeTx = settle.transaction;
  let closing: SettleResult = settle;
  let review: ReviewRecord | null = null;
  const escrow = match.rail.escrow;
  const slipHash = delivered.slip.hash;
  if (escrow) {
    const commitsBody = slipHash.toLowerCase() === slipCommitHash(delivered.slip.body).toLowerCase();
    if (!commitsBody || slipHash.toLowerCase() === ZERO_HASH) {
      const gate = await failOnGate(match.rail, jobId, deps.store, now);
      return failedDelivery(deps, jobId, railId, "seller", escrowRail, gate ?? undefined);
    }
    const release = await escrow.release(jobId, slipHash, delivered.slip.sellerSig);
    if (!release.success) {
      return failure(502, "release-failed", "Refused. The escrow did not release.", railId);
    }
    closeTx = release.transaction;
    closing = release;
    const window = termsReviewWindow(payment);
    if (window !== null && window > 0 && escrow.reviewOf) {
      const state = await escrow.reviewOf(jobId);
      if (state.window > 0) review = state;
    }
  }

  const settlement: Slip["settlement"] & { review?: ReviewRecord } = {
    transaction: closeTx,
    network: match.rail.declaration.network,
    route: {
      chosen: railId,
      reason: route.chosen === railId ? route.reason : `${railId}: chosen by the buyer`,
      attempts: deps.router.slipAttempts(stored.offerHash, buyer, now),
    },
  };
  if (match.rail.declaration.explorerTx !== "") {
    settlement.url = explorerUrl(match.rail.declaration, closeTx);
  }
  if (review !== null) settlement.review = review;
  const slip: Slip = {
    body: delivered.slip.body,
    hash: slipHash,
    sellerSig: delivered.slip.sellerSig,
    payment,
    settlement,
  };
  deps.store.putSlip(slip.hash, jobId, slip, now);
  deps.store.updateJob(
    jobId,
    review === null
      ? {
          status: escrowRail ? "released" : "settled",
          closeTx,
          slipHash: slip.hash,
        }
      : {
          status: "delivered",
          closeTx,
          slipHash: slip.hash,
          reviewWindow: review.window,
          deliveredAt: review.deliveredAt,
          endsAt: review.endsAt,
        },
  );

  return {
    status: 200,
    body: { output: delivered.output, slip },
    headers: { [PAYMENT_RESPONSE_HEADER]: toBase64Json(closing) },
    railId,
  };
}

/** The review a v2 escrow opens at delivery, stored on the slip outside the committed hash (D12). */
interface ReviewRecord {
  window: number;
  deliveredAt: number;
  endsAt: number;
}

/** The countersigned review window: null for v1 terms, 0 for a v2 offer without one. */
function termsReviewWindow(payment: PaymentPayload): number | null {
  const payload = payment.payload as { terms?: unknown };
  const terms = payload.terms;
  if (typeof terms !== "object" || terms === null) return null;
  const signed = terms as CountersignTerms;
  if (!isV2Terms(signed)) return null;
  return signed.reviewWindow ?? 0;
}

/**
 * Who a dispatch failure is on. The runner refusing the job, or running past the offer's own
 * deadline, is the seller's. A missing runner, a dropped connection, or a cut-off the hub
 * imposed before the offer's deadline is the hub's.
 */
function dispatchFault(result: { fail: string; byRunner?: true }, hubCutShort: boolean): Fault {
  if (result.byRunner) return "seller";
  if (result.fail === "timeout" && !hubCutShort) return "seller";
  return "hub";
}

function failedDelivery(
  deps: CallDeps,
  jobId: Hex,
  railId: string,
  fault: Fault,
  escrow: boolean,
  gateMessage?: string,
): CallOutcome {
  deps.store.updateJob(jobId, { status: "failed", fault });
  // failDelivery's own message wins: the buyer already has the payment and any bond back.
  const message =
    gateMessage ??
    (escrow
      ? "Refused. The seller's output does not match the offer. Your money returns at the deadline."
      : "Refused. The seller's output does not match the offer. This rail settles before delivery, so the payment is not returned automatically; the slip records the failure.");
  return failure(502, "failed-delivery", message, railId);
}

/** Two `exact` rails may share scheme and network; the signing-domain name keeps them apart. */
function namesMatch(
  accepted: Record<string, unknown> | undefined,
  entry: Record<string, unknown> | undefined,
): boolean {
  const a = accepted?.name;
  const b = entry?.name;
  if (a === undefined && b === undefined) return true;
  return typeof a === "string" && typeof b === "string" && a === b;
}

function duplicatePayment(railId: string): CallOutcome {
  return failure(409, "duplicate-payment", "Refused. This payment was already used.", railId);
}

function failure(status: number, code: string, message: string, railId?: string): CallOutcome {
  return { status, body: { code, message }, railId };
}

function paymentRequired(
  offer: Offer,
  resource: string,
  accepts: PaymentRequirements[],
  error?: string,
  railId?: string,
  route?: RouteChoice,
): CallOutcome {
  const extensions = bazaarExtension(offer);
  if (route) {
    extensions.route = { chosen: route.chosen, reason: route.reason, trace: route.trace };
  }
  const body: PaymentRequired = {
    x402Version: 2,
    resource: { url: resource, description: offer.title, mimeType: "application/json" },
    accepts,
    extensions,
  };
  if (error !== undefined) body.error = error;
  return {
    status: 402,
    body,
    headers: { [PAYMENT_REQUIRED_HEADER]: toBase64Json(body) },
    railId,
  };
}
