import { getAddress } from "viem";
import type { Address } from "viem";
import { escrowRail } from "@countersign/rail";
import type { EscrowRailConfig } from "@countersign/rail";
import { USDT, WHITECHAIN_CHAIN_ID, WHITECHAIN_RPC_URL } from "./chain.ts";

export const WHITECHAIN_ESCROW: Address = getAddress("0x9279D3edeef4c3738a0b200D762e2985Ff3B7eb4");

/** The escrow rail's Whitechain configuration, without a submitter. */
export function whitechainEscrowConfig(overrides: Partial<EscrowRailConfig> = {}): EscrowRailConfig {
  return {
    id: "whitechain",
    chainId: WHITECHAIN_CHAIN_ID,
    rpcUrl: WHITECHAIN_RPC_URL,
    escrow: WHITECHAIN_ESCROW,
    token: USDT.address,
    tokenName: USDT.name,
    tokenVersion: USDT.version,
    symbol: "USDT",
    decimals: USDT.decimals,
    explorerTx: "https://explorer.testnet.whitechain.io/tx/{tx}",
    finality: "Final one Whitechain block, about a second, after release.",
    gasPaidBy: "relayer",
    ...overrides,
  };
}

export function whitechainRailFor(overrides: Partial<EscrowRailConfig> = {}) {
  return escrowRail(whitechainEscrowConfig(overrides));
}
