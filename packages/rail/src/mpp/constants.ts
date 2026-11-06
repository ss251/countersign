import type { Asset, Network } from "@countersign/core";
import { pathusd } from "viem/tokens";

/** The card method's network id. */
export const MPP_STRIPE: Network = "mpp:stripe";
/** The Tempo method's network id. */
export const MPP_TEMPO: Network = "mpp:tempo";

/**
 * Tempo Moderato, the testnet mppx resolves to for `chainId.testnet`. The rail
 * builds the method with `testnet: true`; there is no mainnet configuration.
 */
export const TEMPO_CHAIN_ID = 42431;
/** pathUSD, mppx's default currency on Moderato. */
export const TEMPO_CURRENCY = pathusd.addresses[TEMPO_CHAIN_ID];
export const TEMPO_SYMBOL = "pathUSD";
export const TEMPO_DECIMALS = pathusd.decimals;
export const CARD_DECIMALS = 2;

/** The Tempo declaration asset: pathUSD on Tempo Moderato. */
export const TEMPO_ASSET: Asset = {
  network: MPP_TEMPO,
  address: TEMPO_CURRENCY,
  symbol: TEMPO_SYMBOL,
  decimals: TEMPO_DECIMALS,
};

/** Atomic 6-decimal units of USD. 0.01 pathUSD is the stablecoin floor. */
export const STABLECOIN_FLOOR = 10_000n;
/** Atomic 6-decimal units of USD. 0.50 USD is the card floor. */
export const CARD_FLOOR = 500_000n;
/** Atomic 6-decimal units in one cent. Stripe charges whole cents. */
export const ATOMIC_PER_CENT = 10n ** BigInt(TEMPO_DECIMALS - CARD_DECIMALS);
