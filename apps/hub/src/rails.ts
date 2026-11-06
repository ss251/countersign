import { privateKeyToAccount } from "viem/accounts";
import { escrowRail, gatewayRail, type Rail } from "@countersign/rail";
import { createHederaRail } from "@countersign/rail/hedera";
import type { Address, Hex } from "viem";

const ARC_USDC: Address = "0x3600000000000000000000000000000000000000";

/**
 * The rails this hub settles on, from the environment. Keys arrive only by environment.
 *   ARC_ESCROW, ARC_RPC_URL, CS_RELAYER_KEY  -> rail "escrow" (CountersignedEscrow on Arc testnet, USDC)
 *   GATEWAY_RAIL=1                           -> rail "gateway" (Circle Gateway nanopayments on Arc testnet;
 *                                               Gateway debits the buyer at once and credits the seller in a batch)
 *   HEDERA_RAIL=1                            -> rail "hedera" (HTS USDC on Hedera testnet through an x402
 *                                               facilitator; the hub holds no Hedera key)
 * Rails from other lanes are added here as they integrate.
 */
export async function railsFromEnv(env: Record<string, string | undefined>): Promise<Rail[]> {
  const rails: Rail[] = [];
  if (env.ARC_ESCROW && env.ARC_RPC_URL) {
    rails.push(
      escrowRail({
        id: "escrow",
        chainId: 5042002,
        rpcUrl: env.ARC_RPC_URL,
        escrow: env.ARC_ESCROW as Address,
        token: (env.ARC_USDC as Address | undefined) ?? ARC_USDC,
        tokenName: "USDC",
        tokenVersion: "2",
        symbol: "USDC",
        decimals: 6,
        explorerTx: "https://explorer.testnet.arc.io/tx/{tx}",
        finality: "Final in the Arc block that includes the release.",
        gasPaidBy: "hub",
        ...(env.CS_RELAYER_KEY ? { submitter: privateKeyToAccount(env.CS_RELAYER_KEY as Hex) } : {}),
      }),
    );
  }
  if (env.GATEWAY_RAIL === "1") {
    rails.push(await gatewayRail({}));
  }
  if (env.HEDERA_RAIL === "1") {
    rails.push(await createHederaRail());
  }
  return rails;
}
