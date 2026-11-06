/* Copied from packages/buyer/src/known-rails.ts: keep equal. */
import { getAddress, type Address } from "viem";

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

/** One escrow this page will sign for, with the countersignature version it speaks. */
export interface ArcPin {
  version: 1 | 2;
  chainId: number;
  escrow: Address;
  token: Address;
  tokenName: string;
  tokenVersion: string;
}

export const ARC_PINS: readonly ArcPin[] = [
  { version: 1, ...ARC_PIN },
  {
    version: 2,
    chainId: 5042002,
    escrow: "0x10A3c07cc6A519C0106e315D2C42010eCbEFF3CE",
    token: ARC_PIN.token,
    tokenName: ARC_PIN.tokenName,
    tokenVersion: ARC_PIN.tokenVersion,
  },
];

/** The pin for the escrow a 402 names; v1 when it names none, as before; null for an escrow not pinned. */
export function pinFor(escrow: unknown): ArcPin | null {
  if (escrow === undefined) return ARC_PINS[0] ?? null;
  if (typeof escrow !== "string") return null;
  const text = escrow.startsWith("0X") ? `0x${escrow.slice(2)}` : escrow;
  try {
    const named = getAddress(text);
    return ARC_PINS.find((pin) => getAddress(pin.escrow) === named) ?? null;
  } catch {
    return null;
  }
}
