import type { Asset, Network } from "@countersign/core";

/** The card method's network id. */
export const MPP_STRIPE: Network = "mpp:stripe";
/** The stablecoin method's network id. */
export const MPP_TEMPO: Network = "mpp:tempo";

/** USDC.e on Tempo mainnet, the stablecoin the declaration describes. */
export const TEMPO_USDC = "0x20c000000000000000000000b9537d11c60e8b50";
export const TEMPO_DECIMALS = 6;
export const CARD_DECIMALS = 2;

export const TEMPO_ASSET: Asset = {
  network: MPP_TEMPO,
  address: TEMPO_USDC,
  symbol: "USDC",
  decimals: TEMPO_DECIMALS,
};

/** Atomic 6-decimal units of USD. 0.01 USDC is the stablecoin floor. */
export const STABLECOIN_FLOOR = 10_000n;
/** Atomic 6-decimal units of USD. 0.50 USD is the card floor. */
export const CARD_FLOOR = 500_000n;
/** Atomic 6-decimal units in one cent. Stripe charges whole cents. */
export const ATOMIC_PER_CENT = 10n ** BigInt(TEMPO_DECIMALS - CARD_DECIMALS);

/**
 * Placeholder Tempo recipient while no deposit address exists. A real Tempo
 * deposit address replaces this through `createMppRail({ tempoRecipient })`.
 */
export const PLACEHOLDER_TEMPO_RECIPIENT = "0x0000000000000000000000000000000000000001";
