/**
 * Shared plumbing for the ERC-8004 ops scripts: arguments, chain selection, clients and
 * keys. Keys come from CS_*_KEY only; a key flag is refused and nothing here prints one.
 */

import {
  type Address,
  type Chain,
  createPublicClient,
  createWalletClient,
  defineChain,
  type Hex,
  http,
  isAddress,
  privateKeyToAccount,
} from "../../packages/identity/src/clients.ts";
import {
  ARC_TESTNET_REGISTRIES,
  HEDERA_TESTNET_REGISTRIES,
  type IdentityPublicClient,
  type IdentityWallet,
} from "../../packages/identity/src/index.ts";

export const ARC_CHAIN_ID = 5042002;
export const ARC_RPC_URL = "https://rpc.testnet.arc.network";
export const HEDERA_CHAIN_ID = 296;
export const HEDERA_RPC_URL = "https://testnet.hashio.io/api";

export interface Args {
  flags: Map<string, string[]>;
  positionals: string[];
}

const SECRET_FLAGS = new Set(["key", "private-key", "seller-key", "buyer-key", "pk"]);

export function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string[]>();
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const name = arg.slice(2);
    if (SECRET_FLAGS.has(name)) throw new Error(`keys are read from CS_*_KEY, not --${name}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`--${name} needs a value`);
    const values = flags.get(name) ?? [];
    values.push(value);
    flags.set(name, values);
    i++;
  }
  return { flags, positionals };
}

export function flag(args: Args, name: string): string | undefined {
  return args.flags.get(name)?.at(-1);
}

export function allFlags(args: Args, name: string): string[] {
  return args.flags.get(name) ?? [];
}

export function requiredFlag(args: Args, name: string): string {
  const value = flag(args, name);
  if (value === undefined || value === "") throw new Error(`--${name} is required`);
  return value;
}

export function addressFlag(args: Args, name: string): Address | undefined {
  const value = flag(args, name);
  if (value === undefined) return undefined;
  if (!isAddress(value)) throw new Error(`--${name} is not an address`);
  return value;
}

export function bigintFlag(args: Args, name: string, fallback?: bigint): bigint {
  const value = flag(args, name);
  if (value === undefined) {
    if (fallback !== undefined) return fallback;
    throw new Error(`--${name} is required`);
  }
  if (!/^(0x[0-9a-fA-F]+|[0-9]+)$/.test(value)) throw new Error(`--${name} is not an integer`);
  const parsed = BigInt(value);
  if (parsed < 0n) throw new Error(`--${name} must not be negative`);
  return parsed;
}

export interface ChainChoice {
  chainId: number;
  rpcUrl: string;
  chain: Chain;
  publicClient: IdentityPublicClient;
  registries: typeof ARC_TESTNET_REGISTRIES;
}

/** Defaults to Arc testnet. --chain-id 296 defaults the RPC to Hedera testnet. */
export function chainChoice(args: Args): ChainChoice {
  const chainId = Number(flag(args, "chain-id") ?? ARC_CHAIN_ID);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error("--chain-id must be a positive integer");
  const rpcUrl = flag(args, "rpc") ?? (chainId === HEDERA_CHAIN_ID ? HEDERA_RPC_URL : ARC_RPC_URL);
  const chain = defineChain({
    id: chainId,
    name: `chain ${chainId}`,
    nativeCurrency: { name: "native", symbol: "NATIVE", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  return {
    chainId,
    rpcUrl,
    chain,
    publicClient: createPublicClient({ chain, transport: http(rpcUrl) }),
    registries: chainId === HEDERA_CHAIN_ID ? HEDERA_TESTNET_REGISTRIES : ARC_TESTNET_REGISTRIES,
  };
}

/** Read a 32-byte hex key from the environment. The error names the variable, never the value. */
export function keyFromEnv(name: string, chain: Chain, rpcUrl: string): IdentityWallet {
  const raw = process.env[name];
  if (raw === undefined || raw === "") throw new Error(`${name} is not set`);
  const hex = (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) throw new Error(`${name} is not a 32-byte hex key`);
  const account = privateKeyToAccount(hex);
  return createWalletClient({ chain, transport: http(rpcUrl), account });
}

export function accountOf(wallet: IdentityWallet): Address {
  return wallet.account.address;
}
