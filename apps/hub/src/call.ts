import {
  checkSchema,
  fromBase64Json,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  slipCommitHash,
  toBase64Json,
  type PaymentPayload,
  type PaymentRequired,
  type PaymentRequirements,
  type SettleResult,
  type Slip,
  ZERO_HASH,
} from "./deps.ts";
import { explorerUrl, type Rail } from "./deps.ts";
import { keccak256, toBytes, type Hex } from "viem";
import { authorizationNonce, buildOrder, checksOut, termsDeadline } from "./delivery.ts";
import type { RunnerLink } from "./runners.ts";
import type { Store } from "./store.ts";
import { hexList, isRecord, sameText } from "./util.ts";

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

interface Option {
  entry: PaymentRequirements;
  rail: Rail;
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

  const resource = `${deps.publicUrl}/offers/${stored.offerHash}/call`;
  const configured = new Map<string, Rail>();
  for (const rail of deps.rails) configured.set(rail.declaration.id, rail);

  const options: Option[] = [];
  for (const id of offer.rails) {
    const rail = configured.get(id);
    if (!rail) continue;
    options.push({ entry: rail.challenge(offer, { resource, now }), rail });
  }
  if (options.length === 0) {
    return failure(503, "no-rail", "Refused. No settlement rail is configured for this offer.");
  }
  const accepts = options.map((option) => option.entry);

  const signatureHeader = headers.get(PAYMENT_SIGNATURE_HEADER);
  if (!signatureHeader) {
    return paymentRequired(offer.title, resource, accepts);
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
    return paymentRequired(offer.title, resource, accepts, "Refused. This offer does not take that rail.");
  }
  const railId = match.rail.declaration.id;
  if (payment.accepted.amount !== match.entry.amount) {
    return paymentRequired(
      offer.title,
      resource,
      accepts,
      "Refused. The price moved after you signed.",
      railId,
    );
  }
  if (!sameText(payment.accepted.payTo, match.entry.payTo) || !sameText(payment.accepted.asset, match.entry.asset)) {
    return paymentRequired(
      offer.title,
      resource,
      accepts,
      "Refused. The payment does not match this offer.",
      railId,
    );
  }

  const verify = await match.rail.verify(payment, match.entry);
  if (!verify.isValid) {
    return paymentRequired(
      offer.title,
      resource,
      accepts,
      verify.invalidReason ?? "Refused. The payment is not valid.",
      railId,
    );
  }

  const settle = await match.rail.settle(payment, match.entry);
  if (!settle.success) {
    return paymentRequired(
      offer.title,
      resource,
      accepts,
      settle.errorReason ?? "Refused. The payment could not be settled.",
      railId,
    );
  }

  const jobId = authorizationNonce(payment.payload) ?? keccak256(toBytes(settle.transaction));
  const deadline = termsDeadline(payment.payload) ?? now + offer.deadline;
  const buyer = settle.payer ?? verify.payer ?? "";
  const escrowRail = match.rail.escrow !== undefined;

  deps.store.putJob({
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

  const timeoutMs = Math.max(
    0,
    Math.min(deps.jobTimeoutMs ?? 120_000, (deadline - now - 5) * 1000),
  );
  const delivered = await deps.runners.dispatch(order, timeoutMs);
  if ("fail" in delivered) {
    return failedDelivery(deps, jobId, railId);
  }

  if (!(await checksOut(offer.seller, offer.output, order, payment, settle, delivered))) {
    return failedDelivery(deps, jobId, railId);
  }

  let closeTx = settle.transaction;
  let closing: SettleResult = settle;
  const escrow = match.rail.escrow;
  const slipHash = delivered.slip.hash;
  if (escrow) {
    const commitsBody = slipHash.toLowerCase() === slipCommitHash(delivered.slip.body).toLowerCase();
    if (!commitsBody || slipHash.toLowerCase() === ZERO_HASH) {
      return failedDelivery(deps, jobId, railId);
    }
    const release = await escrow.release(jobId, slipHash, delivered.slip.sellerSig);
    if (!release.success) {
      return failure(502, "release-failed", "Refused. The escrow did not release.", railId);
    }
    closeTx = release.transaction;
    closing = release;
  }

  const slip: Slip = {
    body: delivered.slip.body,
    hash: slipHash,
    sellerSig: delivered.slip.sellerSig,
    payment,
    settlement: {
      transaction: closeTx,
      network: match.rail.declaration.network,
      url: explorerUrl(match.rail.declaration, closeTx),
    },
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

function failedDelivery(deps: CallDeps, jobId: Hex, railId: string): CallOutcome {
  deps.store.updateJob(jobId, { status: "failed" });
  return failure(
    502,
    "failed-delivery",
    "Refused. The seller's output does not match the offer. Your money returns at the deadline.",
    railId,
  );
}

function failure(status: number, code: string, message: string, railId?: string): CallOutcome {
  return { status, body: { code, message }, railId };
}

function paymentRequired(
  title: string,
  resource: string,
  accepts: PaymentRequirements[],
  error?: string,
  railId?: string,
): CallOutcome {
  const body: PaymentRequired = {
    x402Version: 2,
    resource: { url: resource, description: title, mimeType: "application/json" },
    accepts,
  };
  if (error !== undefined) body.error = error;
  return {
    status: 402,
    body,
    headers: { [PAYMENT_REQUIRED_HEADER]: toBase64Json(body) },
    railId,
  };
}
