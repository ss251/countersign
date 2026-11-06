import { getAddress, type Address } from "viem";
import type { CountersignExtra, Network, PaymentRequirements } from "@countersign/core";

/** A rail this buyer is willing to sign on: the escrow, token and domain are pinned here. */
export interface KnownRail {
  network: Network;
  scheme: "countersign";
  chainId: number;
  escrow: Address;
  token: Address;
  tokenName: string;
  tokenVersion: string;
  rpcUrl: string;
}

export const KNOWN_RAILS: KnownRail[
  {
    // CountersignedEscrow deployed through Arc Studio: the escrow the hub settles Arc calls through.
    network: "eip155:5042002",
    scheme: "countersign",
    chainId: 5042002,
    escrow: "0x19c27d770969291e6a0a305dc1be1a845e7c1b76",
    token: "0x3600000000000000000000000000000000000000",
    tokenName: "USDC",
    tokenVersion: "2",
    rpcUrl: "https://rpc.testnet.arc.network",
  },] = [
  {
    network: "eip155:5042002",
    scheme: "countersign",
    chainId: 5042002,
    escrow: "0x44d11b8909485e3f575F6628b689383E4420f54a",
    token: "0x3600000000000000000000000000000000000000",
    tokenName: "USDC",
    tokenVersion: "2",
    rpcUrl: "https://rpc.testnet.arc.network",
  },
  {
    network: "eip155:1874",
    scheme: "countersign",
    chainId: 1874,
    escrow: "0x9279D3edeef4c3738a0b200D762e2985Ff3B7eb4",
    token: "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7",
    tokenName: "Tether USD",
    tokenVersion: "1",
    rpcUrl: "https://rpc.testnet.whitechain.io",
  },
];

export function sameAddress(a: string, b: string): boolean {
  try {
    return getAddress(a) === getAddress(b);
  } catch {
    return false;
  }
}

/**
 * The listed rail whose network, chain, escrow, token and token domain all match the
 * requirement. A hub cannot invent a rail by changing any one of them.
 */
export function knownRailFor(req: PaymentRequirements, known: KnownRail[]): KnownRail | undefined {
  const extra = req.extra as Partial<CountersignExtra> | undefined;
  if (!extra || typeof extra !== "object") return undefined;
  if (
    typeof extra.escrow !== "string" ||
    typeof extra.chainId !== "number" ||
    typeof extra.tokenName !== "string" ||
    typeof extra.tokenVersion !== "string"
  ) {
    return undefined;
  }
  return known.find(
    (rail) =>
      rail.network === req.network &&
      rail.chainId === extra.chainId &&
      sameAddress(rail.escrow, extra.escrow as string) &&
      sameAddress(rail.token, req.asset) &&
      rail.tokenName === extra.tokenName &&
      rail.tokenVersion === extra.tokenVersion,
  );
}
