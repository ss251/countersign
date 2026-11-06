import { type Hex, isAddress } from "viem";
import { parseAtomic } from "./amount.ts";
import { canonicalHash } from "./canonical.ts";
import { isEnsName } from "./ens.ts";
import { RAIL_IDS, type Offer } from "./types.ts";

export function offerHash(offer: Offer): Hex {
  return canonicalHash(offer);
}

export class OfferError extends Error {
  override name = "OfferError";
}

/** Structural checks a hub runs before it lists an offer. Throws OfferError naming the first problem. */
export function assertOffer(value: unknown): asserts value is Offer {
  const o = value as Partial<Offer> | null;
  const fail = (msg: string): never => {
    throw new OfferError(msg);
  };
  if (!o || typeof o !== "object") fail("offer must be an object");
  if (o!.v !== 1) fail("offer.v must be 1");
  if (typeof o!.seller !== "string" || !isAddress(o!.seller)) fail("offer.seller must be an address");
  if (typeof o!.title !== "string" || !o!.title.trim() || o!.title.length > 120) fail("offer.title must be 1-120 chars");
  if (typeof o!.summary !== "string" || o!.summary.length > 2000) fail("offer.summary must be at most 2000 chars");
  if (!["skill", "mcp", "openapi"].includes(o!.adapter as string)) fail("offer.adapter must be skill, mcp or openapi");
  if (!o!.input || typeof o!.input !== "object") fail("offer.input must be a JSON Schema object");
  if (!o!.output || typeof o!.output !== "object") fail("offer.output must be a JSON Schema object");
  try {
    if (parseAtomic(o!.price as string) === 0n) fail("offer.price must be above zero");
    parseAtomic(o!.bond as string);
  } catch (e) {
    if (e instanceof OfferError) throw e;
    fail("offer.price and offer.bond must be atomic digit strings");
  }
  if (
    o!.reviewWindow !== undefined &&
    (!Number.isSafeInteger(o!.reviewWindow) || o!.reviewWindow < 0 || o!.reviewWindow > 86_400)
  ) {
    fail("offer.reviewWindow must be 0 to 86400 seconds");
  }
  if (!Number.isSafeInteger(o!.deadline) || o!.deadline! < 10 || o!.deadline! > 7 * 24 * 3600) {
    fail("offer.deadline must be 10 s to 7 days");
  }
  if (!Array.isArray(o!.rails) || o!.rails.length === 0 || !o!.rails.every((r) => RAIL_IDS.includes(r))) {
    fail("offer.rails must list known rails");
  }
  if (new Set(o!.rails).size !== o!.rails!.length) fail("offer.rails must not repeat");
  if (!Number.isSafeInteger(o!.issuedAt) || o!.issuedAt! <= 0) fail("offer.issuedAt must be unix seconds");
  if (o!.upstream && (typeof o!.upstream.url !== "string" || typeof o!.upstream.licence !== "string")) {
    fail("offer.upstream needs url and licence");
  }
  if (o!.ens !== undefined && !isEnsName(o!.ens)) fail("offer.ens must be an ENS name in normal form");
}
