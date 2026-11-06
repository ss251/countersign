import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Address, Hex } from "viem";
import { USDT, WHITECHAIN_RPC_URL } from "./chain.ts";
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
};

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
    },
  };
}

export function loadMerchantConfig(env: Env): MerchantConfig {
  return {
    merchantPrivateKey: requiredPrivateKey(env, "WC_MERCHANT_PRIVATE_KEY"),
    relayUrl: env.RELAY_URL?.trim() || "http://localhost:8402",
    port: intEnv(env, "MERCHANT_PORT", 8403),
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
