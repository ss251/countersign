/**
 * The part of a viem LocalAccount the runner needs, stated structurally so the
 * runner package does not need its own viem dependency.
 */

import type { Offer, slipTypedData } from "@countersign/core";

export type Address = Offer["seller"];
export type Hex = `0x${string}`;
export type ReleaseTypedData = ReturnType<typeof slipTypedData>;

export interface RunnerAccount {
  address: Address;
  signMessage(args: { message: string }): Promise<Hex>;
  signTypedData(args: ReleaseTypedData): Promise<Hex>;
}
