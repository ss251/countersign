import type { Hex } from "viem";
import type { CountersignExtra, Offer, PaymentRequirements } from "@countersign/core";
import {
  KNOWN_GATEWAYS,
  knownDirectFor,
  knownGatewayFor,
  knownRailFor,
  sameAddress,
  type KnownDirect,
  type KnownGateway,
  type KnownRail,
} from "./known-rails.ts";

export type TermsCheck = { ok: true; rail: KnownRail } | { ok: false; message: string };
export type GatewayTermsCheck =
  | { ok: true; gateway: KnownGateway }
  | { ok: false; message: string };
export type DirectTermsCheck = { ok: true; direct: KnownDirect } | { ok: false; message: string };

const UNKNOWN_RAIL = "Refused. This rail is not one this agent knows.";
const WRONG_PAYEE = "Refused. The payment terms pay someone other than the offer's seller.";
const WRONG_AMOUNT = "Refused. The payment terms ask a different amount than the offer's price.";
const WRONG_OFFER = "Refused. The payment terms name a different offer.";
const WRONG_VERSION = "Refused. The escrow version is not the one this agent pinned.";
const WRONG_BOND_WINDOW = "Refused. The bond or review window in the payment terms is not the offer's.";

/** An offer that may carry escrow v2's review window; the core Offer type predates it. */
type OfferWithWindow = Offer & { reviewWindow?: number };

/**
 * Compare a 402 entry with the offer the buyer fetched. Every field the buyer signs must
 * come from the offer or a pinned rail; the hub's word for any of them is not enough.
 */
export function checkTerms(offer: Offer, offerHash: Hex, entry: PaymentRequirements, known: KnownRail[]): TermsCheck {
  if (entry.scheme !== "countersign") return { ok: false, message: UNKNOWN_RAIL };
  const rail = knownRailFor(entry, known);
  const extra = entry.extra as Partial<CountersignExtra> | undefined;
  if (
    !rail ||
    !extra ||
    typeof extra.rail !== "string" ||
    typeof extra.offerHash !== "string" ||
    typeof extra.deadlineSeconds !== "number"
  ) {
    return { ok: false, message: UNKNOWN_RAIL };
  }
  if (extra.offerHash.toLowerCase() !== offerHash.toLowerCase()) {
    return { ok: false, message: "Refused. The payment terms name a different offer." };
  }
  const version = rail.version ?? 1;
  const escrowVersion = (extra as { escrowVersion?: unknown }).escrowVersion;
  if (version !== 2 && escrowVersion === 2) {
    return { ok: false, message: WRONG_VERSION };
  }
  if (version === 2) {
    if (escrowVersion !== 2) return { ok: false, message: WRONG_VERSION };
    const bond = (extra as { bond?: unknown }).bond;
    const reviewWindow = (extra as { reviewWindow?: unknown }).reviewWindow;
    if (bond !== (offer.bond ?? "0") || reviewWindow !== ((offer as OfferWithWindow).reviewWindow ?? 0)) {
      return { ok: false, message: WRONG_BOND_WINDOW };
    }
  }
  const bond = entry.extra?.bond;
  if (bond !== undefined && bond !== offer.bond) {
    return { ok: false, message: "Refused. The hub's bond differs from the offer's." };
  }
  const expectedPayTo = offer.payTo?.[extra.rail] ?? offer.seller;
  if (!sameAddress(entry.payTo, expectedPayTo)) {
    return { ok: false, message: WRONG_PAYEE };
  }
  if (entry.amount !== offer.price) {
    return { ok: false, message: WRONG_AMOUNT };
  }
  if (extra.deadlineSeconds !== offer.deadline) {
    return { ok: false, message: "Refused. The payment terms use a different delivery window than the offer." };
  }
  if (entry.maxTimeoutSeconds > offer.deadline) {
    return { ok: false, message: "Refused. The payment terms outlast the offer's deadline." };
  }
  return { ok: true, rail };
}

/**
 * The direct counterpart: the token, its EIP-712 domain, the payee and the amount
 * all come from the fetched offer or a pinned direct entry.
 */
export function checkDirectTerms(
  offer: Offer,
  entry: PaymentRequirements,
  known: KnownDirect[],
): DirectTermsCheck {
  const direct = knownDirectFor(entry, known);
  if (!direct) return { ok: false, message: UNKNOWN_RAIL };
  const expectedPayTo = offer.payTo?.eip3009 ?? offer.seller;
  if (!sameAddress(entry.payTo, expectedPayTo)) return { ok: false, message: WRONG_PAYEE };
  if (entry.amount !== offer.price) return { ok: false, message: WRONG_AMOUNT };
  if (entry.maxTimeoutSeconds > 300) {
    return { ok: false, message: "Refused. The payment window is longer than this agent allows." };
  }
  return { ok: true, direct };
}

/**
 * The hedera counterpart: the payee, the price and the offer hash must all come
 * from the fetched offer, because the hub's 402 is not signed by the seller.
 */
export function checkHederaTerms(
  offer: Offer,
  offerHash: Hex,
  entry: PaymentRequirements,
): { ok: true } | { ok: false; message: string } {
  if (!offer.rails.includes("hedera")) return { ok: false, message: UNKNOWN_RAIL };
  const expectedPayTo = offer.payTo?.hedera;
  if (typeof expectedPayTo !== "string" || entry.payTo !== expectedPayTo) {
    return { ok: false, message: WRONG_PAYEE };
  }
  if (entry.amount !== offer.price) return { ok: false, message: WRONG_AMOUNT };
  const named = entry.extra?.offerHash;
  if (typeof named !== "string" || named.toLowerCase() !== offerHash.toLowerCase()) {
    return { ok: false, message: WRONG_OFFER };
  }
  return { ok: true };
}

/**
 * The gateway counterpart: the payee and amount come from the fetched offer, and
 * the Gateway wallet domain and USDC address must match a pinned entry.
 */
export function checkGatewayTerms(
  offer: Offer,
  entry: PaymentRequirements,
  known: KnownGateway[] = KNOWN_GATEWAYS,
): GatewayTermsCheck {
  const gateway = knownGatewayFor(entry, known);
  if (!gateway) return { ok: false, message: UNKNOWN_RAIL };
  const expectedPayTo = offer.payTo?.gateway ?? offer.seller;
  if (!sameAddress(entry.payTo, expectedPayTo)) return { ok: false, message: WRONG_PAYEE };
  if (entry.amount !== offer.price) return { ok: false, message: WRONG_AMOUNT };
  return { ok: true, gateway };
}
