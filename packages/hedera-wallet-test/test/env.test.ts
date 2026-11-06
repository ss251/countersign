import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrivateKey } from "@hiero-ledger/sdk";
import { readWalletEnv } from "../src/env.ts";

const dir = mkdtempSync(join(tmpdir(), "countersign-wallet-env-"));
const key = PrivateKey.generateED25519().toStringDer();

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function envFile(name: string, mode: number): string {
  const path = join(dir, name);
  writeFileSync(
    path,
    `WALLET_ACCOUNT_ID=0.0.5005\nWALLET_KEY=${key}\nWALLET_KEY_TYPE=ed25519\n`,
    { mode },
  );
  chmodSync(path, mode);
  return path;
}

describe("readWalletEnv", () => {
  test("refuses a file whose mode is not 0600", () => {
    const path = envFile("wide.env", 0o644);
    expect(() => readWalletEnv(path)).toThrow("must have mode 0600");
  });

  test("reads a 0600 file without printing its values", () => {
    const path = envFile("safe.env", 0o600);
    const wallet = readWalletEnv(path);
    expect(wallet.accountId).toBe("0.0.5005");
    expect(wallet.key.publicKey.toString()).toBe(PrivateKey.fromStringED25519(key).publicKey.toString());
  });
});
