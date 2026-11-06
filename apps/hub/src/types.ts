import type { Offer } from "./deps.ts";
import type { Hex } from "viem";

/** A listed offer as the discovery routes return it. */
export interface Listing {
  offerHash: Hex;
  offer: Offer;
  online: boolean;
  status: "listed" | "delisted";
}
