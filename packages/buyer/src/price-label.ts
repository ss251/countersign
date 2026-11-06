import { formatUnits } from "viem";

/** The token each rail settles in, by rail id. A rail not named here settles in USDC (Arc escrow, Gateway, Hedera). */
const RAIL_TOKENS: Readonly<Record<string, string>> = { whitechain: "USDT" };

export function railToken(rail: string): string {
  return RAIL_TOKENS[rail] ?? "USDC";
}

/**
 * An offer's price with the token its rails settle in: "0.01 USDT" on Whitechain, "0.01 USDC" on Arc, and
 * "0.01 USDC/USDT" when the offer's rails settle in different tokens, in the order the rails list them.
 */
export function priceLabel(price: string, rails: readonly string[]): string {
  const tokens = [...new Set(rails.map(railToken))];
  return `${formatUnits(BigInt(price), 6)} ${(tokens.length > 0 ? tokens : ["USDC"]).join("/")}`;
}
