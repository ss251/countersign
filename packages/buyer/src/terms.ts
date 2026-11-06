import type { Hex } from "viem";
import type { CountersignExtra, Offer, PaymentRequirements } from "@countersign/core";
import {
  KNOWN_GATEWAYS,
  knownGatewayFor,
  knownRailFor,
  sameAddress,
  type KnownGateway,
  type KnownRail,
} from "./known-rails.ts";

export type TermsCheck = { ok: true; rail: KnownRail } | { ok: false; message: string };
export type GatewayTermsCheck =
  | { ok: true; gateway: KnownGateway }
  | { ok: false; message: string };

const UNKNOWN_RAIL = "Refused. This rail is not one this agent knows.";
const WRONG_PAYEE = "Refused. The payment terms pay someone other than the offer's seller.";
const WRONG_AMOUNT = "Refused. The payment terms ask a different amount than the offer's price.";

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
