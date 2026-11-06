import { privateKeyToAccount } from "viem/accounts";
import { eip3009Rail, escrowRail, gatewayRail, whitechainRail, type Rail } from "@countersign/rail";
import { createHederaHeldRail, createHederaRail } from "@countersign/rail/hedera";
import type { Address, Hex } from "viem";

const ARC_USDC: Address = "0x3600000000000000000000000000000000000000";

/**
 * The rails this hub settles on, from the environment. Keys arrive only by environment.
 *   ARC_ESCROW, ARC_RPC_URL, CS_RELAYER_KEY  -> rail "escrow" (CountersignedEscrow on Arc testnet, USDC);
 *                                               ARC_ESCROW_VERSION=2 turns on delivery review
 *   ERC8183_ESCROW, ARC_RPC_URL, CS_RELAYER_KEY -> rail "erc8183" (CountersignedEscrow8183, the same
 *                                               escrow holding its money in an ERC-8183 job on Arc's
 *                                               shared core; a JobHook emits the slip hash)
 *   WC_RELAY_URL                             -> rail "whitechain" (CountersignedEscrow on Whitechain Sepolia, USDT;
 *                                               the relay holds the WBT gas key and its guards; the hub holds none)
 *   EIP3009_RAIL=1, ARC_RPC_URL, CS_RELAYER_KEY -> rail "eip3009" (direct USDC on Arc testnet; the buyer
 *                                               signs TransferWithAuthorization, the hub's relayer submits it)
 *   GATEWAY_RAIL=1                           -> rail "gateway" (Circle Gateway nanopayments on Arc testnet;
 *                                               Gateway debits the buyer at once and credits the seller in a batch)
 *   HEDERA_RAIL=1                            -> rail "hedera" (HTS USDC on Hedera testnet through an x402
 *                                               facilitator; the hub holds no Hedera key)
 *   HEDERA_SCHEDULED_RAIL=1, HEDERA_HELD_HUB_KEY -> rail "hedera-scheduled" (a held Hedera payment: the
 *                                               payee is a 2-of-2 account of the seller and this hub, so the
 *                                               buyer's schedule moves USDC only when both sign; this hub
 *                                               co-signs only after a checked delivery)
 * Rails from other lanes are added here as they integrate.
 *
 * Gateway and Hedera ask their facilitator what it supports while they start. If a facilitator is
 * unreachable then, that rail stays off with one log line and the hub boots with the rest.
 */
export interface RailMakers {
  gateway?: () => Promise<Rail>;
  hedera?: () => Promise<Rail>;
  hederaScheduled?: () => Promise<Rail>;
}

/** One environment switch that turns a rail on. */
export interface RailSwitch {
  id: string;
  /** The variables that switch this rail on. */
  vars: readonly string[];
  requested(env: Record<string, string | undefined>): boolean;
}

/**
 * Every rail switch railsFromEnv reads. It is the one list the mainnet guard (network.ts)
 * reads too, so a rail added here is a rail the guard has to know before mainnet can boot.
 */
export const RAIL_SWITCHES = [
  { id: "escrow", vars: ["ARC_ESCROW"], requested: (env) => Boolean(env.ARC_ESCROW) },
  { id: "erc8183", vars: ["ERC8183_ESCROW"], requested: (env) => Boolean(env.ERC8183_ESCROW) },
  { id: "eip3009", vars: ["EIP3009_RAIL"], requested: (env) => env.EIP3009_RAIL === "1" },
  { id: "whitechain", vars: ["WC_RELAY_URL"], requested: (env) => Boolean(env.WC_RELAY_URL) },
  { id: "gateway", vars: ["GATEWAY_RAIL"], requested: (env) => env.GATEWAY_RAIL === "1" },
  { id: "hedera", vars: ["HEDERA_RAIL"], requested: (env) => env.HEDERA_RAIL === "1" },
  {
    id: "hedera-scheduled",
    vars: ["HEDERA_SCHEDULED_RAIL"],
    requested: (env) => env.HEDERA_SCHEDULED_RAIL === "1",
  },
] as const satisfies readonly RailSwitch[];

export type SwitchedRail = (typeof RAIL_SWITCHES)[number]["id"];

/** Variables railsFromEnv reads that configure a switched-on rail but never switch one on. */
export const RAIL_CONFIG_VARS = [
  "ARC_RPC_URL",
  "ARC_USDC",
  "ARC_ESCROW_VERSION",
  "CS_RELAYER_KEY",
  "HEDERA_HELD_HUB_KEY",
] as const;

/** Whether the environment asks for this rail. */
export function railRequested(id: SwitchedRail, env: Record<string, string | undefined>): boolean {
  const entry = RAIL_SWITCHES.find((s) => s.id === id);
  return entry !== undefined && entry.requested(env);
}

export async function railsFromEnv(
  env: Record<string, string | undefined>,
  makers: RailMakers = {},
  log: (line: string) => void = (line) => console.error(line),
): Promise<Rail[]> {
  const rails: Rail[] = [];
  if (railRequested("escrow", env) && env.ARC_RPC_URL) {
    rails.push(
      escrowRail({
        id: "escrow",
        chainId: 5042002,
        rpcUrl: env.ARC_RPC_URL,
        escrow: env.ARC_ESCROW as Address,
        version: env.ARC_ESCROW_VERSION === "2" ? 2 : 1,
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
  if (railRequested("erc8183", env) && env.ARC_RPC_URL) {
    rails.push(
      escrowRail({
        id: "erc8183",
        chainId: 5042002,
        rpcUrl: env.ARC_RPC_URL,
        escrow: env.ERC8183_ESCROW as Address,
        version: 1,
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
  if (railRequested("eip3009", env)) {
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
  if (railRequested("whitechain", env) && env.WC_RELAY_URL) {
    rails.push(whitechainRail({ relayUrl: env.WC_RELAY_URL }));
  }
  if (railRequested("gateway", env)) {
    await startOptional(rails, "gateway", makers.gateway ?? (() => gatewayRail({})), log);
  }
  if (railRequested("hedera", env)) {
    await startOptional(rails, "hedera", makers.hedera ?? (() => createHederaRail()), log);
  }
  if (railRequested("hedera-scheduled", env)) {
    await startOptional(
      rails,
      "hedera-scheduled",
      makers.hederaScheduled ??
        (() => {
          const value = env.HEDERA_HELD_HUB_KEY;
          if (!value) throw new Error("HEDERA_HELD_HUB_KEY is not set");
          return createHederaHeldRail({ hubKey: value });
        }),
      log,
    );
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
