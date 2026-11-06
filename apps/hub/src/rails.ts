import { privateKeyToAccount } from "viem/accounts";
import { eip3009Rail, escrowRail, gatewayRail, whitechainRail, type Rail } from "@countersign/rail";
import { createHederaRail } from "@countersign/rail/hedera";
import type { Address, Hex } from "viem";

const ARC_USDC: Address = "0x3600000000000000000000000000000000000000";

/**
 * The rails this hub settles on, from the environment. Keys arrive only by environment.
 *   ARC_ESCROW, ARC_RPC_URL, CS_RELAYER_KEY  -> rail "escrow" (CountersignedEscrow on Arc testnet, USDC)
 *   WC_RELAY_URL                             -> rail "whitechain" (CountersignedEscrow on Whitechain Sepolia, USDT;
 *                                               the relay holds the WBT gas key and its guards; the hub holds none)
 *   EIP3009_RAIL=1, ARC_RPC_URL, CS_RELAYER_KEY -> rail "eip3009" (direct USDC on Arc testnet; the buyer
 *                                               signs TransferWithAuthorization, the hub's relayer submits it)
 *   GATEWAY_RAIL=1                           -> rail "gateway" (Circle Gateway nanopayments on Arc testnet;
 *                                               Gateway debits the buyer at once and credits the seller in a batch)
 *   HEDERA_RAIL=1                            -> rail "hedera" (HTS USDC on Hedera testnet through an x402
 *                                               facilitator; the hub holds no Hedera key)
 * Rails from other lanes are added here as they integrate.
 *
 * Gateway and Hedera ask their facilitator what it supports while they start. If a facilitator is
 * unreachable then, that rail stays off with one log line and the hub boots with the rest.
 */
export interface RailMakers {
  gateway?: () => Promise<Rail>;
  hedera?: () => Promise<Rail>;
}

export async function railsFromEnv(
  env: Record<string, string | undefined>,
  makers: RailMakers = {},
  log: (line: string) => void = (line) => console.error(line),
): Promise<Rail[]> {
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
  if (env.EIP3009_RAIL === "1") {
    if (!env.ARC_RPC_URL || !env.CS_RELAYER_KEY) {
      log("[hub] rail eip3009 is off: ARC_RPC_URL and CS_RELAYER_KEY are required");
    } else {
      try {
        rails.push(
          eip3009Rail({
            id: "eip3009",
            chainId: 5042002,
            rpcUrl: env.ARC_RPC_URL,
            token: ARC_USDC,
            tokenName: "USDC",
            tokenVersion: "2",
            symbol: "USDC",
            decimals: 6,
            explorerTx: "https://explorer.testnet.arc.io/tx/{tx}",
            submitter: privateKeyToAccount(env.CS_RELAYER_KEY as Hex),
          }),
        );
      } catch (error) {
        const reason = error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error);
        log(`[hub] rail eip3009 is off: ${reason}`);
      }
    }
  }
  if (env.WC_RELAY_URL) {
    rails.push(whitechainRail({ relayUrl: env.WC_RELAY_URL }));
  }
  if (env.GATEWAY_RAIL === "1") {
    await startOptional(rails, "gateway", makers.gateway ?? (() => gatewayRail({})), log);
  }
  if (env.HEDERA_RAIL === "1") {
    await startOptional(rails, "hedera", makers.hedera ?? (() => createHederaRail()), log);
  }
  return rails;
}

async function startOptional(
  rails: Rail[],
  id: string,
  make: () => Promise<Rail>,
  log: (line: string) => void,
): Promise<void> {
  try {
    rails.push(await make());
  } catch (error) {
    const reason = error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error);
    log(`[hub] rail ${id} is off: ${reason}`);
  }
}
