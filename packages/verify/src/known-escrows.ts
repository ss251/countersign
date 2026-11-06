/**
 * The escrow deployments this verifier trusts. A slip names its own escrow address, so the
 * chain read alone cannot tell a real CountersignedEscrow from a contract a seller deployed.
 * Pin (chainId, escrow) the way the buyer pins KNOWN_RAILS.
 */

import type { Address } from "viem";

export interface KnownEscrow {
  chainId: number;
  escrow: Address;
  name: string;
}

export const KNOWN_ESCROWS: Array<{ chainId: number; escrow: Address; name: string }> = [
  { chainId: 5042002, escrow: "0x19c27d770969291e6a0a305dc1be1a845e7c1b76", name: "Arc testnet, deployed through Arc Studio" },
  { chainId: 5042002, escrow: "0x44d11b8909485e3f575F6628b689383E4420f54a", name: "Arc testnet, forge deployment" },
  { chainId: 1874, escrow: "0x9279D3edeef4c3738a0b200D762e2985Ff3B7eb4", name: "Whitechain Sepolia" },
];
