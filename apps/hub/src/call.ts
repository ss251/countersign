import {
  checkSchema,
  fromBase64Json,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  slipCommitHash,
  toBase64Json,
  type Offer,
  type PaymentPayload,
  type PaymentRequired,
  type PaymentRequirements,
  type SettleResult,
  type Slip,
  type VerifyResult,
  ZERO_HASH,
} from "./deps.ts";
import { explorerUrl, type Rail } from "./deps.ts";
import { keccak256, toBytes, type Hex } from "viem";
import { authorizationNonce, buildOrder, checksOut, termsDeadline } from "./delivery.ts";
import { bazaarExtension, challengeOptions, firstLine, resourceFor } from "./discovery.ts";
import type { RunnerLink } from "./runners.ts";
import type { Fault, Store } from "./store.ts";
import { hexList, isRecord, sameText } from "./util.ts";

const CHECK_FAILED = "Refused. The payment could not be checked.";

export interface CallDeps {
  store: Store;
  rails: Rail[];
  runners: RunnerLink;
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

  if (!deps.runners.isOnline(stored.offerHash)) {
    return failure(503, "seller-offline", "The seller is offline. Nothing was charged.");
  }

  const resource = resourceFor(deps.publicUrl, stored.offerHash);
  const options = challengeOptions(deps.rails, offer, resource, now);
  if (options.length === 0) {
    return failure(503, "no-rail", "Refused. No settlement rail is configured for this offer.");
  }
  const accepts = options.map((option) => option.entry);

  const signatureHeader = headers.get(PAYMENT_SIGNATURE_HEADER);
  if (!signatureHeader) {
    return paymentRequired(offer, resource, accepts);
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

  const match = options.find(
    (option) =>
      option.entry.scheme === payment.accepted.scheme && option.entry.network === payment.accepted.network,
  );
  if (!match) {
    return paymentRequired(offer, resource, accepts, "Refused. This offer does not take that rail.");
  }
  const railId = match.rail.declaration.id;
  if (payment.accepted.amount !== match.entry.amount) {
    return paymentRequired(
      offer,
      resource,
      accepts,
      "Refused. The price moved after you signed.",
      railId,
    );
  }
  if (!sameText(payment.accepted.payTo, match.entry.payTo) || !sameText(payment.accepted.asset, match.entry.asset)) {
    return paymentRequired(
      offer,
      resource,
      accepts,
      "Refused. The payment does not match this offer.",
      railId,
    );
  }

  let verify: VerifyResult;
  try {
    verify = await match.rail.verify(payment, match.entry);
  } catch (error) {
    console.warn(`[hub] rail ${railId} verify failed: ${firstLine(error)}`);
    return paymentRequired(offer, resource, accepts, CHECK_FAILED, railId);
  }
  if (!verify.isValid) {
    return paymentRequired(
      offer,
      resource,
      accepts,
      verify.invalidReason ?? "Refused. The payment is not valid.",
      railId,
    );
  }

  const nonce = authorizationNonce(payment.payload);
  if (nonce !== null && deps.store.getJob(nonce) !== null) {
    return duplicatePayment(railId);
  }

  let settle: SettleResult;
  try {
    settle = await match.rail.settle(payment, match.entry);
  } catch (error) {
    console.warn(`[hub] rail ${railId} settle failed: ${firstLine(error)}`);
    return paymentRequired(offer, resource, accepts, CHECK_FAILED, railId);
  }
  if (!settle.success) {
    return paymentRequired(
      offer,
      resource,
      accepts,
      settle.errorReason ?? "Refused. The payment could not be settled.",
      railId,
    );
  }

  const jobId = nonce ?? keccak256(toBytes(settle.transaction));
  const deadline = termsDeadline(payment.payload) ?? now + offer.deadline;
  const buyer = settle.payer ?? verify.payer ?? "";
  const escrowRail = match.rail.escrow !== undefined;

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
    return failedDelivery(deps, jobId, railId, dispatchFault(delivered, hubLimitMs < deadlineMs));
  }

  if (!(await checksOut(offer.seller, offer.output, order, payment, settle, delivered))) {
    return failedDelivery(deps, jobId, railId, "seller");
  }

  let closeTx = settle.transaction;
  let closing: SettleResult = settle;
  const escrow = match.rail.escrow;
  const slipHash = delivered.slip.hash;
  if (escrow) {
    const commitsBody = slipHash.toLowerCase() === slipCommitHash(delivered.slip.body).toLowerCase();
    if (!commitsBody || slipHash.toLowerCase() === ZERO_HASH) {
      return failedDelivery(deps, jobId, railId, "seller");
    }
    const release = await escrow.release(jobId, slipHash, delivered.slip.sellerSig);
    if (!release.success) {
      return failure(502, "release-failed", "Refused. The escrow did not release.", railId);
    }
    closeTx = release.transaction;
    closing = release;
  }

  const settlement: Slip["settlement"] = {
    transaction: closeTx,
    network: match.rail.declaration.network,
  };
  if (match.rail.declaration.explorerTx !== "") {
    settlement.url = explorerUrl(match.rail.declaration, closeTx);
  }
  const slip: Slip = {
    body: delivered.slip.body,
    hash: slipHash,
    sellerSig: delivered.slip.sellerSig,
    payment,
    settlement,
  };
  deps.store.putSlip(slip.hash, jobId, slip, now);
  deps.store.updateJob(jobId, {
    status: escrowRail ? "released" : "settled",
    closeTx,
    slipHash: slip.hash,
  });

  return {
    status: 200,
    body: { output: delivered.output, slip },
    headers: { [PAYMENT_RESPONSE_HEADER]: toBase64Json(closing) },
    railId,
  };
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

function failedDelivery(deps: CallDeps, jobId: Hex, railId: string, fault: Fault): CallOutcome {
  deps.store.updateJob(jobId, { status: "failed", fault });
  return failure(
    502,
    "failed-delivery",
    "Refused. The seller's output does not match the offer. Your money returns at the deadline.",
    railId,
  );
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
): CallOutcome {
  const body: PaymentRequired = {
    x402Version: 2,
    resource: { url: resource, description: offer.title, mimeType: "application/json" },
    accepts,
    extensions: bazaarExtension(offer),
  };
  if (error !== undefined) body.error = error;
  return {
    status: 402,
    body,
    headers: { [PAYMENT_REQUIRED_HEADER]: toBase64Json(body) },
    railId,
  };
}
