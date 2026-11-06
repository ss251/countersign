// Shared helpers for the Hedera lane scripts.
// Keys live only in ~/.config/countersign/hd.env (mode 0600). Nothing here prints a key.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AccountId, Client, PrivateKey } from "../../packages/rail/src/hedera/sdk.ts";

export const ENV_DIR = join(homedir(), ".config", "countersign");
export const ENV_FILE = join(ENV_DIR, "hd.env");

export type Env = Record<string, string>;

export function readEnv(): Env {
  if (!existsSync(ENV_FILE)) return {};
  const out: Env = {};
  for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

// Merge keys into the env file, keeping the file 0600 and its directory 0700.
export function writeEnv(updates: Env): void {
  mkdirSync(ENV_DIR, { recursive: true, mode: 0o700 });
  chmodSync(ENV_DIR, 0o700);
  const next = { ...readEnv(), ...updates };
  const body = Object.entries(next)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  writeFileSync(ENV_FILE, body + "\n", { mode: 0o600 });
  chmodSync(ENV_FILE, 0o600);
}

export function need(env: Env, name: string): string {
  const v = env[name];
  if (!v) throw new Error(`missing ${name} in ${ENV_FILE}`);
  return v;
}

export function key(env: Env, name: string): PrivateKey {
  return PrivateKey.fromStringECDSA(need(env, name));
}

export function testnetClient(accountId: string, accountKey: PrivateKey): Client {
  const c = Client.forTestnet();
  c.setOperator(AccountId.fromString(accountId), accountKey);
  return c;
}
