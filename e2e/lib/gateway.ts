/**
 * The buyer's Circle Gateway balance, read through Circle's own client. Used by the Gateway flows
 * and by the budget guard.
 */

import type { Address } from "viem";
import { GatewayClient } from "../../packages/rail/src/gateway/client.ts";
import type { Wallet } from "./budget.ts";
import { readWithRetry } from "./http.ts";
import type { RunEnv } from "./flow.ts";
import type { Secrets } from "./secrets.ts";

/** A read: a transport failure, where Circle's API never answered, is retried (`readWithRetry`). */
export async function gatewayAvailable(s: Secrets, address: Address, onRetry?: (why: string) => void): Promise<bigint> {
  const client = new GatewayClient({ chain: "arcTestnet", privateKey: s.key("CS_BUYER_KEY") });
  return readWithRetry(async () => (await client.getBalances(address)).gateway.available, onRetry);
}

export function gatewayWallet(env: RunEnv): Wallet {
  const s = env.secrets;
  const address = s.address("CS_BUYER_ADDRESS");
  return {
    id: "arc.buyer.gateway",
    label: "Arc buyer's Gateway balance",
    network: "arc",
    asset: "USDC",
    address,
    decimals: 6,
    topUp: (amount) => `WAITING orch-cs deposit ${amount} USDC into the buyer's Circle Gateway balance (${address}, scripts/gateway/deposit.ts)`,
    read: () => gatewayAvailable(s, address),
  };
}
