/**
 * Which network the hub settles on, and the guard that keeps a mainnet hub from booting
 * on anything that is not ready.
 *
 *   CS_NETWORK=testnet (or unset) -> the testnet rails in rails.ts, unchanged.
 *   CS_NETWORK=mainnet            -> every rail the environment asks for must be fully
 *                                    configured for mainnet in MAINNET below. One pending
 *                                    value, or one rail with no mainnet at all, refuses boot.
 *   anything else                 -> refuses boot.
 *
 * Testnet tolerates a facilitator that is away at boot (that rail stays off). Mainnet does
 * not: it refuses rather than start with less than it was asked for. See docs/mainnet.md.
 */

export type NetworkName = "testnet" | "mainnet";

/** A value nobody has confirmed yet. Its reason says what has to happen first. */
export interface Pending {
  pending: string;
}

export type Setting<T> = T | Pending;

export const pending = (reason: string): Pending => ({ pending: reason });

export function isPending(value: unknown): value is Pending {
  return typeof value === "object" && value !== null && "pending" in value;
}

export interface MainnetEscrowProfile {
  chainId: Setting<number>;
  escrow: Setting<string>;
  token: Setting<string>;
  explorerTx: Setting<string>;
}

export interface MainnetGatewayProfile {
  network: Setting<string>;
  facilitatorUrl: Setting<string>;
}

/** A rail that has no mainnet in this repository, and why. */
export interface NoMainnet {
  none: string;
}

export interface MainnetProfile {
  escrow: MainnetEscrowProfile;
  gateway: MainnetGatewayProfile;
  whitechain: NoMainnet;
  hedera: NoMainnet;
}

/**
 * The mainnet profile. A value is filled in only once it has been checked against its
 * source, as docs/mainnet.md describes; until then it stays pending and boot refuses.
 */
export const MAINNET: MainnetProfile = {
  escrow: {
    chainId: pending("Arc mainnet's chain id, confirmed from Circle's Arc network page."),
    escrow: pending("CountersignedEscrow is not deployed on Arc mainnet. Deploy it after review, then record the address."),
    token: pending("Arc mainnet USDC, confirmed from Circle's USDC contract addresses page."),
    explorerTx: pending("Arc mainnet's explorer transaction URL, confirmed from Circle's Arc network page."),
  },
  gateway: {
    network: pending("The CAIP-2 network Circle Gateway serves for Arc mainnet."),
    facilitatorUrl: pending("Circle's mainnet batch facilitator URL, from Circle's Gateway docs."),
  },
  whitechain: { none: "The Whitechain rail and its relay are built for Whitechain Sepolia only." },
  hedera: { none: "The hedera rail is testnet-only by construction: network, token, mirror node and facilitators." },
};

export class BootRefused extends Error {
  override name = "BootRefused";
  constructor(readonly problems: string[]) {
    super(`Refused to boot. ${problems.join(" ")}`);
  }
}

/** The network named by CS_NETWORK. Throws BootRefused for any value it does not know. */
export function networkFromEnv(env: Record<string, string | undefined>): NetworkName {
  const value = env.CS_NETWORK;
  if (value === undefined || value === "" || value === "testnet") return "testnet";
  if (value === "mainnet") return "mainnet";
  throw new BootRefused([`CS_NETWORK must be testnet or mainnet, not ${JSON.stringify(value)}.`]);
}

/** The rails this environment asks for, using the same switches as railsFromEnv. */
export function requestedRails(env: Record<string, string | undefined>): Array<keyof MainnetProfile> {
  const rails: Array<keyof MainnetProfile> = [];
  if (env.ARC_ESCROW || env.ARC_RPC_URL) rails.push("escrow");
  if (env.WC_RELAY_URL) rails.push("whitechain");
  if (env.GATEWAY_RAIL === "1") rails.push("gateway");
  if (env.HEDERA_RAIL === "1") rails.push("hedera");
  return rails;
}

/** Every reason a mainnet hub must not boot with this environment and profile. Empty means ready. */
export function mainnetProblems(
  env: Record<string, string | undefined>,
  profile: MainnetProfile = MAINNET,
): string[] {
  const rails = requestedRails(env);
  if (rails.length === 0) return ["No rail is configured for mainnet."];

  const problems: string[] = [];
  for (const rail of rails) {
    const entry = profile[rail];
    if ("none" in entry) {
      problems.push(`Rail ${rail} has no mainnet: ${entry.none}`);
      continue;
    }
    for (const [field, value] of Object.entries(entry)) {
      if (isPending(value)) problems.push(`Rail ${rail} ${field} is pending: ${value.pending}`);
    }
  }
  // The testnet escrow switch must not point a mainnet hub at an address nobody recorded.
  if (rails.includes("escrow") && !isPending(profile.escrow.escrow) && env.ARC_ESCROW !== undefined) {
    if (env.ARC_ESCROW.toLowerCase() !== String(profile.escrow.escrow).toLowerCase()) {
      problems.push("ARC_ESCROW is not the escrow recorded in the mainnet profile.");
    }
  }
  if (rails.includes("escrow") && !env.ARC_RPC_URL) problems.push("ARC_RPC_URL is not set.");
  return problems;
}

/**
 * Throws BootRefused unless the hub may boot. A testnet hub always may. A mainnet hub
 * may only when nothing it is asked to run is pending.
 */
export function assertBootable(
  env: Record<string, string | undefined>,
  profile: MainnetProfile = MAINNET,
): NetworkName {
  const network = networkFromEnv(env);
  if (network === "testnet") return network;
  const problems = mainnetProblems(env, profile);
  if (problems.length > 0) throw new BootRefused(problems);
  // No mainnet rail builder exists yet: a profile with nothing pending still has no code path
  // that constructs mainnet rails, so refuse rather than fall through to the testnet ones.
  throw new BootRefused(["Mainnet rails are not wired into the hub yet; see docs/mainnet.md, step 5."]);
}
