/**
 * Test-only access to viem, resolved through @countersign/core's dependency
 * because the runner package does not declare viem itself.
 */

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type { Address, Hex, RunnerAccount } from "../src/account.ts";

export interface Viem {
  privateKeyToAccount(key: Hex): RunnerAccount;
  recoverMessageAddress(args: { message: string; signature: Hex }): Promise<Address>;
  recoverTypedDataAddress(args: {
    domain: unknown;
    types: unknown;
    primaryType: string;
    message: unknown;
    signature: Hex;
  }): Promise<Address>;
}

export async function loadViem(): Promise<Viem> {
  const require = createRequire(import.meta.resolve("@countersign/core"));
  const main = (await import(pathToFileURL(require.resolve("viem")).href)) as {
    recoverMessageAddress: Viem["recoverMessageAddress"];
    recoverTypedDataAddress: Viem["recoverTypedDataAddress"];
  };
  const accounts = (await import(pathToFileURL(require.resolve("viem/accounts")).href)) as {
    privateKeyToAccount: Viem["privateKeyToAccount"];
  };
  return { ...main, ...accounts };
}
