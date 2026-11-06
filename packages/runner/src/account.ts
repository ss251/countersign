/**
 * The part of a viem LocalAccount the runner needs, stated structurally so the
 * runner package does not need its own viem dependency.
 */

import type { lockTypedData, Offer, slipTypedData } from "@countersign/core";

export type Address = Offer["seller"];
export type Hex = `0x${string}`;
export type ReleaseTypedData = ReturnType<typeof slipTypedData>;
export type LockTypedData = ReturnType<typeof lockTypedData>;

export interface RunnerTypedDataField {
  readonly name: string;
  readonly type: string;
}

/** Every typed data the runner signs: the slip's Release and a bonded job's Lock. */
export interface RunnerTypedData {
  domain?: Record<string, unknown>;
  types: Record<string, readonly RunnerTypedDataField[]>;
  primaryType: string;
  message: Record<string, unknown>;
}

export interface RunnerAccount {
  address: Address;
  kind?: "local" | "remote";
  signMessage(args: { message: string }): Promise<Hex>;
  signTypedData(args: RunnerTypedData): Promise<Hex>;
}
