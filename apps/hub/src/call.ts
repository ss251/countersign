import {
  canonicalJson,
  checkEnsLock,
  checkSchema,
  fromBase64Json,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  slipCommitHash,
  toBase64Json,
  type EnsResolve,
  isV2Terms,
  type CountersignTerms,
  type LockTerms,
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
import { keccak256, toBytes, type Address, type Hex } from "viem";
import { failOnGate } from "./bond.ts";
import { authorizationNonce, buildOrder, checksOut, termsDeadline } from "./delivery.ts";
import { bazaarExtension, firstLine, resourceFor } from "./discovery.ts";
import { owns, personFrom, type PrivyVerifier } from "./privy.ts";
import type { HubRouter } from "./route.ts";
import type { RunnerLink } from "./runners.ts";
import type { Fault, StoredOffer, Store } from "./store.ts";
import { hexList, isRecord, sameText } from "./util.ts";

const CHECK_FAILED = "Refused. The payment could not be checked.";
export const REVOKED = "Refused. This agent's envelope was revoked by its approver. Nothing was charged.";

/** How much of its validity window a payment that settles after delivery must keep past the deadline. */
export const SETTLE_MARGIN_SECONDS = 30;

export interface CallDeps {
  store: Store;
  rails: Rail[];
  runners: RunnerLink;
  router: HubRouter;
  now: () => number;
  publicUrl: string;
  jobTimeoutMs?: number;
  /** Sepolia ENS lookups. A named offer is served only while its name still locks its payees. */
  ens?: EnsResolve;
  /** Privy access-token verifier. Without it, the Privy header is ignored. */
  privy?: PrivyVerifier;
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
  const privyCheck = await personFrom(headers, deps.privy);
  if (privyCheck.kind === "refused") return failure(privyCheck.status, privyCheck.code, privyCheck.message);
  const claimedAgent = (headers.get("x-countersign-agent") ?? "").trim();
  if (claimedAgent !== "" && deps.store.getRevocation(claimedAgent) !== null) {
    return failure(403, "envelope-revoked", REVOKED);
  }
  const offer = stored.offer;
  const call = isRecord(body) ? body : {};
  const input = call.input;
  // Offer hashes this call is already inside, outermost first. Checked before the ENS lock,
  // the input gates, any rail method and any 402, so a cycle never reaches a payment.
  const lineage = hexList(call.lineage);
  if (purchaseCycle(lineage, stored.offerHash)) {
    return failure(
      422,
      "purchase-cycle",
      "Refused. Paying this offer would repeat an offer hash already in the lineage. Nothing was charged.",
    );
  }

  if (lineageCycle(deps.store, stored, hexList(call.lineage))) {
    return failure(
      409,
      "lineage-cycle",
      "Refused. This call is nested inside a purchase of the same offer or from the same seller, so it would close a cycle. Nothing was charged.",
    );
  }

  // A name checked at listing can be re-pointed later. Check it again before any 402 or payment,
  // so the hub never takes money for a named offer whose name no longer locks its payees.
  const lock = await checkEnsLock(offer, deps.ens);
  if (lock && !lock.ok) {
    return failure(lock.code === "ens-unavailable" ? 503 : 409, lock.code, `${lock.message} Nothing was charged.`);
  }

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

  // The hedera rail signs no nonce: a wallet-paid claim there is keyed on settle.transaction alone.
  const nonce = match.rail.declaration.id === "hedera" ? null : authorizationNonce(payment.payload);
  if (nonce !== null && deps.store.getJob(nonce) !== null) {
    return duplicatePayment(railId);
  }

  if (
    privyCheck.kind === "person" &&
    !(/^0x[0-9a-fA-F]{40}$/.test(verify.payer ?? "") && owns(privyCheck.person, verify.payer))
  ) {
    return failure(
      403,
      "not-your-wallet",
      "Refused. This payment is not from one of your wallets. Nothing was charged.",
      railId,
    );
  }

  if (/^0x[0-9a-fA-F]{40}$/.test(verify.payer ?? "") && deps.store.getRevocation(verify.payer as string) !== null) {
    return failure(403, "envelope-revoked", REVOKED, railId);
  }

  const payer = verify.payer ?? "";
  const deadline = termsDeadline(payment.payload) ?? now + offer.deadline;
  const pending =
    match.rail.settlesAfterDelivery === true ? (match.rail.pending?.(payment) ?? null) : null;

  // A rail that settles after delivery: verify, dispatch, gate, then settle. The buyer's signed
  // transfer is never submitted when the seller fails or the gate refuses, so nothing moves.
  if (pending !== null) {
    // The buyer signs only the transfer: terms.deadline is plain JSON anyone can add.
    const deadline = now + offer.deadline;
    if (pending.validUntil < deadline + SETTLE_MARGIN_SECONDS) {
      return paymentRequired(
        offer,
        resource,
        accepts,
        "Refused. Your signed Hedera transfer expires before this offer's deadline. Sign a fresh one and retry. Nothing was charged.",
        railId,
        route,
      );
    }

    const jobId = keccak256(toBytes(pending.transaction));
    const buyer = verify.payer ?? "";
    const claimed = deps.store.claimJob({
      jobId,
      offerHash: stored.offerHash,
      rail: railId,
      buyer,
      amount: match.entry.amount,
      deadline,
      status: "verified",
      payment,
      settleTx: null,
      closeTx: null,
      slipHash: null,
      createdAt: now,
      reviewWindow: null,
      parentJobId: parentOf(deps.store, lineage),
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
      lineage,
    });

    const deadlineMs = (deadline - now - 5) * 1000;
    const hubLimitMs = deps.jobTimeoutMs ?? 120_000;
    const timeoutMs = Math.max(
      0,
      Math.min(hubLimitMs, deadlineMs, (pending.validUntil - now - SETTLE_MARGIN_SECONDS) * 1000),
    );
    const delivered = await deps.runners.dispatch(order, timeoutMs);
    if ("fail" in delivered) {
      return failedDelivery(
        deps,
        jobId,
        railId,
        dispatchFault(delivered, hubLimitMs < deadlineMs),
        false,
        undefined,
        true,
      );
    }

    const provisional: SettleResult = {
      success: true,
      payer: buyer,
      transaction: pending.transaction,
      network: match.rail.declaration.network,
    };
    if (!(await checksOut(offer.seller, offer.output, order, payment, provisional, delivered))) {
      return failedDelivery(deps, jobId, railId, "seller", false, undefined, true);
    }

    let settle: SettleResult;
    try {
      settle = await match.rail.settle(payment, match.entry);
    } catch (error) {
      console.warn(`[hub] rail ${railId} settle failed: ${firstLine(error)}`);
      deps.router.recordFailure(stored.offerHash, railId, now);
      deps.router.recordAttempt(stored.offerHash, payer, railId, "settle-failed", now);
      deps.store.updateJob(jobId, { status: "failed", fault: "hub" });
      return settleFailedAfterDelivery(pending, railId);
    }
    if (!settle.success) {
      deps.router.recordFailure(stored.offerHash, railId, now);
      deps.router.recordAttempt(stored.offerHash, settle.payer ?? payer, railId, "settle-failed", now);
      deps.store.updateJob(jobId, { status: "failed", fault: "hub" });
      return settleFailedAfterDelivery(pending, railId);
    }

    deps.router.recordSuccess(stored.offerHash, railId);
    deps.router.recordAttempt(stored.offerHash, settle.payer ?? buyer, railId, "settled", now);

    const closeTx = settle.transaction;
    const closing: SettleResult = settle;
    const settlement: Slip["settlement"] = {
      transaction: closeTx,
      network: match.rail.declaration.network,
      route: {
        chosen: railId,
        reason: route.chosen === railId ? route.reason : `${railId}: chosen by the buyer`,
        attempts: deps.router.slipAttempts(stored.offerHash, buyer, now),
      },
    };
    if (match.rail.declaration.explorerTx !== "") {
      settlement.url = explorerUrl(match.rail.declaration, closing.explorerRef ?? closeTx);
    }
    const slip: Slip = {
      body: delivered.slip.body,
      hash: delivered.slip.hash,
      sellerSig: delivered.slip.sellerSig,
      payment,
      settlement,
    };
    deps.store.putSlip(slip.hash, jobId, slip, now);
    deps.store.updateJob(jobId, {
      status: "settled",
      settleTx: settle.transaction,
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

  let lockSig: Hex | undefined;
  const bond = bondOfTerms(payment);
  if (bond !== null && match.rail.escrow !== undefined && match.rail.declaration.escrow !== undefined && nonce !== null) {
    if (match.rail.funder === undefined) {
      return failure(
        503,
        "rail-unavailable",
        "Refused. This rail cannot fund a bonded job right now. Nothing was charged.",
        railId,
      );
    }
    const chainId = eip155ChainId(match.rail.declaration.network);
    const lock = chainId === null ? { refused: "unknown chain" } : await deps.runners.lock(
      {
        jobId: nonce,
        offerHash: stored.offerHash,
        escrow: match.rail.declaration.escrow as Address,
        chainId,
        bond,
        funder: match.rail.funder,
        terms: lockTermsOf(payment),
      },
      10_000,
    );
    if ("refused" in lock) {
      return failure(409, "seller-declined", "Refused. The seller did not accept this job, so nothing was charged.", railId);
    }
    lockSig = lock.sig;
  }

  let settle: SettleResult;
  try {
    settle = await match.rail.settle(payment, match.entry, lockSig ? { lockSig } : undefined);
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
    parentJobId: parentOf(deps.store, lineage),
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
    ...(railId === "hedera-scheduled"
      ? {
          schedule: {
            id: String(payment.payload.scheduleId),
            createTx: String(payment.payload.createTxId),
          },
        }
      : {}),
    lineage,
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
    const release = await escrow.release(
      jobId,
      slipHash,
      delivered.slip.sellerSig,
      delivered.countersign,
    );
    if (!release.success) {
      return failure(502, "release-failed", "Refused. The escrow did not release.", railId);
    }
    closeTx = release.transaction;
    closing = release;
    const window = termsReviewWindow(payment);
    if (window !== null && window > 0 && escrow.reviewOf) {
      // The release has landed, so the job is Delivered on chain whatever this read says. A failed read
      // must not strand it as funded (cs-w1, review of ba868fa): fall back to the countersigned window
      // from the hub's clock. The janitor's releaseAfterWindow retries if this runs ahead of the chain.
      try {
        const state = await escrow.reviewOf(jobId);
        review = state.window > 0 ? state : { window, deliveredAt: now, endsAt: now + window };
      } catch {
        review = { window, deliveredAt: now, endsAt: now + window };
      }
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
    settlement.url = explorerUrl(match.rail.declaration, closing.explorerRef ?? closeTx);
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

/** The parent job: the last lineage entry that names a job this hub recorded, or null. Offer-hash entries are skipped. */
export function parentOf(store: Store, lineage: Hex[]): Hex | null {
  for (let index = lineage.length - 1; index >= 0; index -= 1) {
    const entry = lineage[index];
    if (entry === undefined) continue;
    const job = store.getJob(entry);
    if (job !== null) return job.jobId;
  }
  return null;
}

/** D17: true when an ancestor purchase this hub knows bought the target offer, or an offer from its seller. */
export function lineageCycle(store: Store, target: StoredOffer, lineage: Hex[]): boolean {
  for (const jobId of lineage) {
    if (sameText(jobId, target.offerHash) || sameText(jobId, target.seller)) return true;
    const ancestor = store.getJob(jobId);
    if (ancestor === null) continue;
    if (ancestor.offerHash.toLowerCase() === target.offerHash.toLowerCase()) return true;
    const bought = store.getOffer(ancestor.offerHash);
    if (bought !== null && sameText(bought.seller, target.seller)) return true;
  }
  return false;
}

/** The review a v2 escrow opens at delivery, stored on the slip outside the committed hash (D12). */
interface ReviewRecord {
  window: number;
  deliveredAt: number;
  endsAt: number;
}

/**
 * True when `lineage` plus this offer hash contains the same hash twice.
 * That is a direct cycle (the offer is already in the list) or an earlier one
 * (the list already names one hash twice).
 */
function purchaseCycle(lineage: readonly string[], offerHash: string): boolean {
  const seen = new Set<string>();
  for (const hash of lineage) {
    const key = hash.toLowerCase();
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return seen.has(offerHash.toLowerCase());
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

/** The buyer's countersigned terms, for the lock frame. bond and reviewWindow default to "0" and 0. */
function lockTermsOf(payment: PaymentPayload): LockTerms {
  const raw = (payment.payload as { terms?: unknown }).terms;
  const terms = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    buyer: (typeof terms.buyer === "string" ? terms.buyer : "") as Address,
    payee: (typeof terms.payee === "string" ? terms.payee : "") as Address,
    amount: typeof terms.amount === "string" ? terms.amount : "",
    deadline: typeof terms.deadline === "number" ? terms.deadline : 0,
    salt: typeof terms.salt === "string" ? terms.salt : "",
    bond: typeof terms.bond === "string" ? terms.bond : "0",
    reviewWindow: typeof terms.reviewWindow === "number" ? terms.reviewWindow : 0,
  };
}

/** The bond a v2 countersignature locks, as a decimal string, or null when it locks none. */
function bondOfTerms(payment: PaymentPayload): string | null {
  const terms = (payment.payload as { terms?: unknown }).terms;
  if (typeof terms !== "object" || terms === null) return null;
  const signed = terms as CountersignTerms;
  if (!isV2Terms(signed)) return null;
  try {
    const bond = BigInt(signed.bond ?? "0");
    return bond > 0n ? bond.toString() : null;
  } catch {
    return null;
  }
}

/** The chain id in an eip155 network, or null when the network is not EVM. */
function eip155ChainId(network: string): number | null {
  const match = /^eip155:(\d+)$/.exec(network);
  return match === null ? null : Number(match[1]);
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
  settlesAfterDelivery = false,
): CallOutcome {
  deps.store.updateJob(jobId, { status: "failed", fault });
  // failDelivery's own message wins: the buyer already has the payment and any bond back.
  const message =
    gateMessage ??
    (railId === "hedera-scheduled"
      ? "Not delivered. This hub will not submit the seller's countersignature. Your USDC stays in your account unless the seller signs the schedule itself before it expires."
      : escrow
        ? "Refused. The seller's output does not match the offer. Your money returns at the deadline."
        : settlesAfterDelivery
          ? "Not delivered. Nothing was charged: this hub settles a Hedera payment only after delivery, so your signed transfer was never submitted and expires unused."
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

/** The signed transfer may still land: tell the buyer to check it after it expires instead of paying again. */
function settleFailedAfterDelivery(
  pending: { transaction: string; validUntil: number },
  railId: string,
): CallOutcome {
  return failure(
    502,
    "settle-failed",
    `Not settled. The seller delivered, but the hub could not confirm your payment, so it withholds the output. Your signed transfer ${pending.transaction} cannot land after ${new Date(pending.validUntil * 1000).toISOString()}; check it on HashScan after then before you sign a fresh payment.`,
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
