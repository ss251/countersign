import { type Address, getAddress, type Hex, recoverTypedDataAddress, type TypedDataDomain } from "viem";
import { canonicalHash } from "./canonical.ts";
import { ESCROW_DOMAIN_NAME, ESCROW_DOMAIN_VERSION, RELEASE_TYPES } from "./countersign.ts";
import type { Slip, SlipBody } from "./types.ts";

export function slipHash(body: SlipBody): Hex {
  return canonicalHash(body);
}

/**
 * The hash the release commits on chain (D9): keccak256(canonicalJson(slip.body)).
 *
 * The body holds everything known at delivery and nothing known only after the release,
 * so the settlement transaction, payment payload, seller signature and receipt are never
 * part of it. The release path must never commit this as ZERO_HASH, and the hash it
 * commits is exactly the `hash` of the slip the buyer receives.
 */
export function slipCommitHash(body: SlipBody): Hex {
  return slipHash(body);
}

/** The all-zero bytes32 the escrow stores for a job that has not released a slip. */
export const ZERO_HASH: Hex = ("0x" + "00".repeat(32)) as Hex;

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
