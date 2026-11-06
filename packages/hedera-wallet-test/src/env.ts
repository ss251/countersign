// The wallet's account key and the WalletConnect project id.
// Nothing in this module prints a key or a value read from either file.
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PrivateKey } from "@hiero-ledger/sdk";

export const WALLET_ENV_FILE = join(homedir(), ".config", "countersign", "hedera-wallet.env");
export const WALLETCONNECT_ENV_FILE = join(homedir(), ".config", "countersign", "walletconnect.env");

export interface WalletEnv {
  accountId: string;
  key: PrivateKey;
}

function values(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.replace(/\r$/, "");
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) out[match[1]!] = match[2]!;
  }
  return out;
}

/** The wallet's account and key from a 0600 env file. Throws before reading a value when the file is unsafe. */
export function readWalletEnv(path = WALLET_ENV_FILE): WalletEnv {
  if (!existsSync(path)) throw new Error(`Refused. ${path} is missing.`);
  if ((statSync(path).mode & 0o777) !== 0o600) {
    throw new Error(`Refused. ${path} must have mode 0600.`);
  }

  const file = values(path);
  const accountId = file.WALLET_ACCOUNT_ID;
  const rawKey = file.WALLET_KEY;
  const keyType = file.WALLET_KEY_TYPE;
  if (!accountId) throw new Error(`Refused. ${path} has no WALLET_ACCOUNT_ID.`);
  if (!rawKey) throw new Error(`Refused. ${path} has no WALLET_KEY.`);
  if (keyType !== "ed25519" && keyType !== "ecdsa") {
    throw new Error(`Refused. ${path} has no WALLET_KEY_TYPE of ed25519 or ecdsa.`);
  }

  let key: PrivateKey;
  try {
    key = keyType === "ed25519" ? PrivateKey.fromStringED25519(rawKey) : PrivateKey.fromStringECDSA(rawKey);
  } catch {
    throw new Error(`Refused. ${path} has an invalid WALLET_KEY.`);
  }
  return { accountId, key };
}

/** WC_PROJECT_ID from the environment, else the 0600-style config file. The environment wins. */
export function readProjectId(path = WALLETCONNECT_ENV_FILE): string {
  const fromEnvironment = process.env.WC_PROJECT_ID;
  if (fromEnvironment) return fromEnvironment;
  if (!existsSync(path)) throw new Error(`Refused. ${path} is missing.`);
  const projectId = values(path).WC_PROJECT_ID;
  if (!projectId) throw new Error(`Refused. ${path} has no WC_PROJECT_ID.`);
  return projectId;
}
