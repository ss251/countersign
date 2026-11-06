import { formatUnits, parseAtomic } from "./amount.ts";
import type { Envelope, EnvelopeDecision, EnvelopeSpend } from "./types.ts";

export interface SpendRequest {
  seller: string;
  offerHash: string;
  amount: string;
}

const usd = (atomic: bigint) => formatUnits(atomic, 6);

/**
 * Decide whether the agent may countersign this spend. Pure: the caller owns the spend journal
 * and records the spend only after the payment settles.
 */
export function checkEnvelope(env: Envelope, spent: EnvelopeSpend, req: SpendRequest, now: number): EnvelopeDecision {
  const seller = req.seller.toLowerCase();
  const amount = parseAtomic(req.amount);
  if (env.revoked) {
    return { ok: false, reason: "revoked", message: "Refused. The envelope was revoked." };
  }
  if (env.expiresAt !== undefined && now >= env.expiresAt) {
    return { ok: false, reason: "expired", message: "Refused. The envelope has expired." };
  }
  if (
    env.allowlist.length > 0 &&
    !env.allowlist.some((entry) => entry.toLowerCase() === seller || entry.toLowerCase() === req.offerHash.toLowerCase())
  ) {
    return { ok: false, reason: "not-allowlisted", message: "Refused. This seller is not on the allowlist." };
  }
  const cap = parseAtomic(env.cap);
  const total = parseAtomic(spent.total) + amount;
  if (total > cap) {
    return {
      ok: false,
      reason: "over-cap",
      message: `Refused. This would spend ${usd(total)} of a ${usd(cap)} budget.`,
    };
  }
  const limit = parseAtomic(env.merchantLimits?.[seller] ?? env.perMerchant);
  const sellerTotal = parseAtomic(spent.bySeller[seller] ?? "0") + amount;
  if (sellerTotal > limit) {
    return {
      ok: false,
      reason: "over-merchant-limit",
      message: `Refused. This would spend ${usd(sellerTotal)} with one seller; the limit is ${usd(limit)}.`,
    };
  }
  return { ok: true };
}

/** The spend after a settled payment. Returns a new object. */
export function recordSpend(spent: EnvelopeSpend, req: SpendRequest): EnvelopeSpend {
  const seller = req.seller.toLowerCase();
  const amount = parseAtomic(req.amount);
  return {
    total: (parseAtomic(spent.total) + amount).toString(10),
    bySeller: { ...spent.bySeller, [seller]: (parseAtomic(spent.bySeller[seller] ?? "0") + amount).toString(10) },
  };
}
