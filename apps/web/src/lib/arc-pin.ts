/* Copied from packages/buyer/src/known-rails.ts: keep equal. */
import type { Address } from "viem";

/** The one Arc escrow this page signs for, pinned here and never taken from a hub. */
export const ARC_PIN = {
  chainId: 5042002,
  escrow: "0x19c27d770969291e6a0a305dc1be1a845e7c1b76",
  token: "0x3600000000000000000000000000000000000000",
  tokenName: "USDC",
  tokenVersion: "2",
} as const satisfies {
  chainId: number;
  escrow: Address;
  token: Address;
  tokenName: string;
  tokenVersion: string;
};

export const ARC_CHAIN_ID = ARC_PIN.chainId;
