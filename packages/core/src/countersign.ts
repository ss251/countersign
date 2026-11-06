/**
 * The countersignature, computed off chain exactly as CountersignedEscrow computes it on chain.
 *
 * jobId  = EIP-712 hash of Countersign(offerHash, buyer, payee, amount, deadline, salt)
 *          under the escrow's domain {name "Countersign", version "1", chainId, escrow}.
 *          Escrow v2 appends (bond, reviewWindow) to the struct; terms carrying either field are v2.
 * The buyer signs one message: the token's EIP-3009 ReceiveWithAuthorization
 *          {from: buyer, to: escrow, value: amount, validAfter, validBefore, nonce: jobId}.
 * A settlement at any other amount, payee, deadline or offer derives another jobId,
 * so the signature no longer matches and the chain refuses it.
 */

import {
  type Address,
  type Hex,
  getAddress,
  hashTypedData,
  recoverTypedDataAddress,
  type TypedDataDomain,
} from "viem";
import { parseAtomic } from "./amount.ts";
import type { CountersignPayload, CountersignTerms } from "./types.ts";

export const ESCROW_DOMAIN_NAME = "Countersign";
export const ESCROW_DOMAIN_VERSION = "1";

export const COUNTERSIGN_TYPES = {
  Countersign: [
    { name: "offerHash", type: "bytes32" },
    { name: "buyer", type: "address" },
    { name: "payee", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "deadline", type: "uint64" },
    { name: "salt", type: "uint256" },
  ],
} as const;

/** Escrow v2 (D16): the offer's bond and review window are countersigned inside jobId. */
export const COUNTERSIGN_V2_TYPES = {
  Countersign: [
    { name: "offerHash", type: "bytes32" },
    { name: "buyer", type: "address" },
    { name: "payee", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "deadline", type: "uint64" },
    { name: "salt", type: "uint256" },
    { name: "bond", type: "uint256" },
    { name: "reviewWindow", type: "uint64" },
  ],
} as const;

/** True for escrow v2 terms: they carry bond and reviewWindow (both, even when zero). */
export function isV2Terms(terms: CountersignTerms): boolean {
  return terms.bond !== undefined || terms.reviewWindow !== undefined;
}

export const RELEASE_TYPES = {
  Release: [
    { name: "jobId", type: "bytes32" },
    { name: "slipHash", type: "bytes32" },
  ],
} as const;

export const CANCEL_TYPES = {
  Cancel: [{ name: "jobId", type: "bytes32" }],
} as const;

/** Escrow v2: the payee accepts a bonded job, unlocking its bond before the escrow takes it. */
export const LOCK_TYPES = {
  Lock: [{ name: "jobId", type: "bytes32" }],
} as const;

/** Escrow v2: the buyer accepts a delivered job, paying the seller before the review window ends. */
export const ACCEPT_TYPES = {
  Accept: [
    { name: "jobId", type: "bytes32" },
    { name: "slipHash", type: "bytes32" },
  ],
} as const;

/** Escrow v2: the buyer disputes a funded or delivered job, refunding itself at once. */
export const DISPUTE_TYPES = {
  Dispute: [
    { name: "jobId", type: "bytes32" },
    { name: "status", type: "uint8" },
  ],
} as const;

export const RECEIVE_WITH_AUTHORIZATION_TYPES = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export function escrowDomain(chainId: number, escrow: Address): TypedDataDomain {
  return { name: ESCROW_DOMAIN_NAME, version: ESCROW_DOMAIN_VERSION, chainId, verifyingContract: getAddress(escrow) };
}

/** Domain of the token (USDC on Arc: name "USDC", version "2"). */
export function tokenDomain(chainId: number, token: Address, name: string, version: string): TypedDataDomain {
  return { name, version, chainId, verifyingContract: getAddress(token) };
}

export function jobIdOf(terms: CountersignTerms, chainId: number, escrow: Address): Hex {
  if (isV2Terms(terms)) {
    return hashTypedData({
      domain: escrowDomain(chainId, escrow),
      types: COUNTERSIGN_V2_TYPES,
      primaryType: "Countersign",
      message: {
        offerHash: terms.offerHash,
        buyer: getAddress(terms.buyer),
        payee: getAddress(terms.payee),
        amount: parseAtomic(terms.amount),
        deadline: BigInt(terms.deadline),
        salt: parseAtomic(terms.salt),
        bond: parseAtomic(terms.bond ?? "0"),
        reviewWindow: BigInt(terms.reviewWindow ?? 0),
      },
    });
  }
  return hashTypedData({
    domain: escrowDomain(chainId, escrow),
    types: COUNTERSIGN_TYPES,
    primaryType: "Countersign",
    message: {
      offerHash: terms.offerHash,
      buyer: getAddress(terms.buyer),
      payee: getAddress(terms.payee),
      amount: parseAtomic(terms.amount),
      deadline: BigInt(terms.deadline),
      salt: parseAtomic(terms.salt),
    },
  });
}

export interface AuthorizationInput {
  terms: CountersignTerms;
  chainId: number;
  escrow: Address;
  token: Address;
  tokenName: string;
  tokenVersion: string;
  validAfter: number;
  validBefore: number;
}

/** The typed data the buyer signs. Pass it to a viem account's signTypedData. */
export function authorizationTypedData(input: AuthorizationInput) {
  const jobId = jobIdOf(input.terms, input.chainId, input.escrow);
  return {
    domain: tokenDomain(input.chainId, input.token, input.tokenName, input.tokenVersion),
    types: RECEIVE_WITH_AUTHORIZATION_TYPES,
    primaryType: "ReceiveWithAuthorization" as const,
    message: {
      from: getAddress(input.terms.buyer),
      to: getAddress(input.escrow),
      value: parseAtomic(input.terms.amount),
      validAfter: BigInt(input.validAfter),
      validBefore: BigInt(input.validBefore),
      nonce: jobId,
    },
  };
}

/** Assemble the wire payload once the buyer has signed. */
export function countersignPayload(input: AuthorizationInput, signature: Hex): CountersignPayload {
  const td = authorizationTypedData(input);
  return {
    terms: input.terms,
    authorization: {
      from: td.message.from,
      to: td.message.to,
      value: td.message.value.toString(10),
      validAfter: td.message.validAfter.toString(10),
      validBefore: td.message.validBefore.toString(10),
      nonce: td.message.nonce,
    },
    signature,
  };
}

export type CountersignCheck =
  | { ok: true; jobId: Hex; buyer: Address }
  | { ok: false; reason: "terms-mismatch" | "bad-signature" | "expired" | "not-yet-valid"; message: string };

/**
 * Check a payload without touching the chain: the authorisation must carry exactly the
 * terms' amount, buyer and escrow, its nonce must be the jobId those terms derive, and
 * the signature must recover to the buyer.
 */
export async function checkCountersign(
  p: CountersignPayload,
  ctx: { chainId: number; escrow: Address; token: Address; tokenName: string; tokenVersion: string; now: number },
): Promise<CountersignCheck> {
  const jobId = jobIdOf(p.terms, ctx.chainId, ctx.escrow);
  const a = p.authorization;
  if (
    getAddress(a.from) !== getAddress(p.terms.buyer) ||
    getAddress(a.to) !== getAddress(ctx.escrow) ||
    a.value !== p.terms.amount ||
    a.nonce.toLowerCase() !== jobId.toLowerCase()
  ) {
    return { ok: false, reason: "terms-mismatch", message: "Refused. The authorisation does not match the countersigned terms." };
  }
  if (ctx.now <= Number(a.validAfter)) {
    return { ok: false, reason: "not-yet-valid", message: "Refused. The countersignature is not valid yet." };
  }
  if (ctx.now >= Number(a.validBefore)) {
    return { ok: false, reason: "expired", message: "Refused. The countersignature has expired." };
  }
  const td = authorizationTypedData({
    terms: p.terms,
    chainId: ctx.chainId,
    escrow: ctx.escrow,
    token: ctx.token,
    tokenName: ctx.tokenName,
    tokenVersion: ctx.tokenVersion,
    validAfter: Number(a.validAfter),
    validBefore: Number(a.validBefore),
  });
  let signer: Address;
  try {
    signer = await recoverTypedDataAddress({ ...td, signature: p.signature });
  } catch {
    return { ok: false, reason: "bad-signature", message: "Refused. The countersignature does not parse." };
  }
  if (signer !== getAddress(p.terms.buyer)) {
    return { ok: false, reason: "bad-signature", message: "Refused. The countersignature is not the buyer's." };
  }
  return { ok: true, jobId, buyer: signer };
}

/** Typed data the seller signs to release a job against a slip. */
export function releaseTypedData(chainId: number, escrow: Address, jobId: Hex, slipHash: Hex) {
  return {
    domain: escrowDomain(chainId, escrow),
    types: RELEASE_TYPES,
    primaryType: "Release" as const,
    message: { jobId, slipHash },
  };
}

/** Typed data the seller signs to hand a job's money back before the deadline. */
export function cancelTypedData(chainId: number, escrow: Address, jobId: Hex) {
  return {
    domain: escrowDomain(chainId, escrow),
    types: CANCEL_TYPES,
    primaryType: "Cancel" as const,
    message: { jobId },
  };
}

/**
 * Typed data the payee signs to accept a bonded job. Escrow v2 requires it before the bond
 * moves, so the payee consents to the lock. Sign it under the escrow of a pinned rail.
 */
export function lockTypedData(chainId: number, escrow: Address, jobId: Hex) {
  return {
    domain: escrowDomain(chainId, escrow),
    types: LOCK_TYPES,
    primaryType: "Lock" as const,
    message: { jobId },
  };
}

/**
 * Typed data the buyer signs to accept a delivered job against the slip it received.
 * Escrow v2. Sign it under the escrow of a pinned rail, never one a hub names.
 */
export function acceptTypedData(chainId: number, escrow: Address, jobId: Hex, slipHash: Hex) {
  return {
    domain: escrowDomain(chainId, escrow),
    types: ACCEPT_TYPES,
    primaryType: "Accept" as const,
    message: { jobId, slipHash },
  };
}

/**
 * Typed data the buyer signs to dispute a job: before delivery up to the deadline, or
 * while its review window is open. Escrow v2. `status` is the job's status when it is
 * signed: Funded (1) or Delivered (5). Sign it under the escrow of a pinned rail.
 */
export function disputeTypedData(chainId: number, escrow: Address, jobId: Hex, status: number) {
  return {
    domain: escrowDomain(chainId, escrow),
    types: DISPUTE_TYPES,
    primaryType: "Dispute" as const,
    message: { jobId, status },
  };
}
