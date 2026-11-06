// Fixed facts for the hedera rail on testnet. Probed 2026-11-06; see docs/hedera.md.

export const HEDERA_TESTNET = "hedera:testnet" as const;
export type HederaNetwork = typeof HEDERA_TESTNET;

/** x402 asset id for native HBAR (amounts in tinybars, 8 decimals). */
export const HBAR = "0.0.0";
export const HBAR_DECIMALS = 8;

/** Circle's USDC on Hedera testnet, an HTS fungible token with 6 decimals. */
export const USDC_TESTNET = "0.0.429274";
export const USDC_DECIMALS = 6;

export const MIRROR_TESTNET = "https://testnet.mirrornode.hedera.com";
export const HASHSCAN_TESTNET = "https://hashscan.io/testnet";

/**
 * Hosted x402 v2 facilitators that list `exact` on hedera:testnet, in preference order.
 * Neither needs an API key. Each pays network fees from its own fee-payer account, which it
 * publishes under `extra.feePayer` in GET /supported, so the order here is only a preference:
 * the fee payer is always read live, never hard-coded.
 */
export const FACILITATORS = [
  { name: "x402.org", url: "https://x402.org/facilitator" },
  { name: "blocky402", url: "https://api.testnet.blocky402.com" },
] as const;

/** Hedera caps a transaction memo at 100 bytes. */
export const MEMO_MAX_BYTES = 100;
