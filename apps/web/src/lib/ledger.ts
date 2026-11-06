import type { Settlement } from "./types.ts";

/* The settlements, indexed the two ways the registry and the offer page read them. */

export interface Ledger {
  /** null when the hub does not list settlements: say nothing rather than "none". */
  known: boolean;
  lastBySeller: Map<string, Settlement>;
  byOffer: Map<string, { paid: number; refunded: number }>;
}

export function settlementIndex(rows: Settlement[] | null | undefined): Ledger {
  const lastBySeller = new Map<string, Settlement>();
  const byOffer = new Map<string, { paid: number; refunded: number }>();
  for (const s of rows ?? []) {
    const seller = s.seller.toLowerCase();
    if (!lastBySeller.has(seller)) lastBySeller.set(seller, s);
    const key = s.offerHash.toLowerCase();
    const c = byOffer.get(key) ?? { paid: 0, refunded: 0 };
    if (s.kind === "refunded") c.refunded += 1;
    else c.paid += 1;
    byOffer.set(key, c);
  }
  return { known: Array.isArray(rows), lastBySeller, byOffer };
}

