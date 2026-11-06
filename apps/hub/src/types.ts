import type { Offer, RailId } from "./deps.ts";
import type { Hex } from "viem";

/** A listed offer as the discovery routes return it. */
export interface Listing {
  offerHash: Hex;
  offer: Offer;
  online: boolean;
  status: "listed" | "delisted";
  /** The offer's rails that this hub runs (offer.rails that GET /rails also declares), in the offer's order. Any other rail in the seller's signed list is listed, not live on this hub. */
  liveRails: RailId[];
}
