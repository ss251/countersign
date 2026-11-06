import { ARC_CHAIN_ID } from "../../lib/arc-pin.ts";
import type { RailId } from "../../lib/types.ts";

/** Whether the card's hold can sign with the person's wallet, or only hand the agent a command. */
export type CardMode = { wallet: true } | { wallet: false; why: string | null };

export function cardMode(a: { connected: boolean; chainId: number | undefined; rails: RailId[] }): CardMode {
  if (!a.connected) return { wallet: false, why: null };
  if (!a.rails.includes("escrow")) {
    return { wallet: false, why: "Your wallet can countersign only on Arc's escrow rail, and this offer does not take it." };
  }
  if (a.chainId !== ARC_CHAIN_ID) {
    return { wallet: false, why: "Switch to Arc testnet to countersign this with your wallet." };
  }
  return { wallet: true };
}
