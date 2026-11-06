import { type Address, getAddress, type Hex, recoverTypedDataAddress, type TypedDataDomain } from "viem";
import { canonicalHash } from "./canonical.ts";
import { ESCROW_DOMAIN_NAME, ESCROW_DOMAIN_VERSION, RELEASE_TYPES } from "./countersign.ts";
import type { Slip, SlipBody } from "./types.ts";

export function slipHash(body: SlipBody): Hex {
  return canonicalHash(body);
}

/**
 * Domain of the seller's Release signature. On escrow rails it is the escrow's own domain,
 * so the same signature the contract checks is the one a verifier checks.
 */
export function slipDomain(body: SlipBody): TypedDataDomain {
  if (body.escrow !== undefined && body.chainId !== undefined) {
    return {
      name: ESCROW_DOMAIN_NAME,
      version: ESCROW_DOMAIN_VERSION,
      chainId: body.chainId,
      verifyingContract: getAddress(body.escrow),
    };
  }
  return { name: ESCROW_DOMAIN_NAME, version: ESCROW_DOMAIN_VERSION };
}

export function slipTypedData(body: SlipBody) {
  return {
    domain: slipDomain(body),
    types: RELEASE_TYPES,
    primaryType: "Release" as const,
    message: { jobId: body.jobId, slipHash: slipHash(body) },
  };
}

/** Recover the address that signed this slip's Release message. */
export async function slipSigner(slip: Slip): Promise<Address> {
  return recoverTypedDataAddress({ ...slipTypedData(slip.body), signature: slip.sellerSig });
}
