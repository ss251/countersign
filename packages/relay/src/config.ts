import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { getAddress, isAddress } from "viem";
import type { Address, Hex } from "viem";
import { USDT, WHITECHAIN_RPC_URL } from "./chain.ts";
import { WHITECHAIN_ESCROW } from "./whitechain-config.ts";
import type { SpendCeilingConfig } from "./ceiling.ts";
import type { RelayerPolicy } from "./relayer.ts";

export type Env = Record<string, string | undefined>;

export type RelayConfig = {
  relayerPrivateKey: Hex;
  rpcUrl: string;
  dbPath: string;
  port: number;
  relayUrl: string;
  ceiling: SpendCeilingConfig;
  policy: RelayerPolicy;
};

export type MerchantConfig = {
  merchantPrivateKey: Hex;
  relayUrl: string;
  port: number;
  token: string;
  origins: string[];
};

export const DEFAULT_MERCHANT_ORIGINS = [
  "http://127.0.0.1:5173",
  "http://localhost:5173",
];

export const DEFAULT_PAYEE: Address = getAddress("0xd5882dBC7D41fBcf8ae0B05E9eAc1cbe93d6C71c");

const HOUR_MS = 3_600_000;
const GWEI = 1_000_000_000n;

export function loadRelayConfig(env: Env): RelayConfig {
  const relayerPrivateKey = requiredPrivateKey(env, "WC_RELAYER_PRIVATE_KEY");
  const dbPath = env.RELAY_DB?.trim() || "packages/relay/.data/relay.sqlite";
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const capWei = bigintEnv(env, "RELAY_CAP_WEI_PER_HOUR", 50_000_000_000_000_000n);
  const maxFeeGwei = bigintEnv(env, "RELAY_MAX_FEE_GWEI", 50n);
  const minBalanceWei = bigintEnv(env, "RELAY_MIN_BALANCE_WEI", 20_000_000_000_000_000n);
  const allowedTokens: Address[] = [USDT.address];
  const escrowRaw = env.RELAY_ESCROW?.trim();
  if (escrowRaw && !isAddress(escrowRaw)) throw new Error("RELAY_ESCROW must be an address");
  const allowedEscrows: Address[] = [escrowRaw ? getAddress(escrowRaw) : WHITECHAIN_ESCROW];
  const allowedPayees = addressListEnv(env, "RELAY_PAYEES", [DEFAULT_PAYEE]);
  return {
    relayerPrivateKey,
    rpcUrl: env.WHITECHAIN_RPC_URL?.trim() || WHITECHAIN_RPC_URL,
    dbPath,
    port: intEnv(env, "RELAY_PORT", 8402),
    relayUrl: env.RELAY_URL?.trim() || "http://localhost:8402",
    ceiling: {
      windowMs: HOUR_MS,
      capWei,
      maxTx: intEnv(env, "RELAY_MAX_TX_PER_HOUR", 200),
      maxTxPerPayer: intEnv(env, "RELAY_MAX_TX_PER_PAYER_PER_HOUR", 30),
    },
    policy: {
      maxFeePerGasWei: maxFeeGwei * GWEI,
      minBalanceWei,
      gasHeadroomPct: 20,
      receiptTimeoutMs: 60_000,
      allowedTokens,
      allowedEscrows,
      allowedPayees,
      minAmount: bigintEnv(env, "RELAY_MIN_AMOUNT", 10_000n),
    },
  };
}

export function loadMerchantConfig(env: Env): MerchantConfig {
  const token = env.MERCHANT_TOKEN?.trim();
  if (!token || token.length < 24) {
    throw new Error("MERCHANT_TOKEN must be at least 24 characters");
  }
  return {
    merchantPrivateKey: requiredPrivateKey(env, "WC_MERCHANT_PRIVATE_KEY"),
    relayUrl: env.RELAY_URL?.trim() || "http://localhost:8402",
    port: intEnv(env, "MERCHANT_PORT", 8403),
    token,
    origins: originsEnv(env),
  };
}

function requiredPrivateKey(env: Env, name: string): Hex {
  const value = env[name]?.trim();
  if (!value || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${name} must be a 0x-prefixed 32-byte hex string`);
  }
  return value as Hex;
}

function intEnv(env: Env, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  if (!/^[0-9]+$/.test(raw)) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return Number(raw);
}

function bigintEnv(env: Env, name: string, fallback: bigint): bigint {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  if (!/^[0-9]+$/.test(raw)) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return BigInt(raw);
}

function addressListEnv(env: Env, name: string, fallback: Address[]): Address[] {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const values = raw.split(",").map((value) => value.trim()).filter(Boolean);
  if (values.length === 0) {
    throw new Error(`${name} must list at least one address`);
  }
  return values.map((value) => {
    if (!isAddress(value)) throw new Error(`${name} must be comma-separated addresses`);
    return getAddress(value);
  });
}

function originsEnv(env: Env): string[] {
  const raw = env.MERCHANT_ORIGINS?.trim();
  if (!raw) return [...DEFAULT_MERCHANT_ORIGINS];
  const origins = raw.split(",").map((value) => value.trim()).filter(Boolean);
  if (origins.length === 0) {
    throw new Error("MERCHANT_ORIGINS must list at least one origin");
  }
  return origins;
}
