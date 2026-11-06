/**
 * The human's signed decision on a held call.
 *
 * The agent does not trust the hub's word that a person approved a spend. The phone signs
 * this body with the envelope's `approver` key, and the agent verifies that signature over
 * the values it posted before it signs any payment.
 */

import { keccak256, recoverMessageAddress, toBytes, type Address, type Hex } from "viem";
import { canonicalJson } from "./canonical.ts";

export type ApprovalDecision = "countersign" | "decline";

export interface ApprovalDecisionInput {
  approvalId: string;
  agent: string;
  offerHash: string;
  amount: string;
  rail: string;
  terms: unknown;
  decision: ApprovalDecision;
  decidedAt: number;
}

export interface ApprovalDecisionBody {
  kind: "countersign-approval-decision";
  v: 1;
  approvalId: string;
  /** Lowercase hex. */
  agent: Address;
  /** Lowercase hex. */
  offerHash: Hex;
  amount: string;
  rail: string;
  /** keccak256 of the canonical JSON terms, lowercase hex. */
  termsHash: Hex;
  decision: ApprovalDecision;
  /** Unix seconds. */
  decidedAt: number;
}

/** keccak256 over the canonical JSON of the terms. Independent of key order. */
export function termsHashOf(terms: unknown): Hex {
  return keccak256(toBytes(canonicalJson(terms)));
}

/** Build the exact body the approver signs and the agent later rebuilds. */
export function approvalDecisionBody(input: ApprovalDecisionInput): ApprovalDecisionBody {
  return {
    kind: "countersign-approval-decision",
    v: 1,
    approvalId: input.approvalId,
    agent: input.agent.toLowerCase() as Address,
    offerHash: input.offerHash.toLowerCase() as Hex,
    amount: input.amount,
    rail: input.rail,
    termsHash: termsHashOf(input.terms),
    decision: input.decision,
    decidedAt: input.decidedAt,
  };
}

/** The EIP-191 personal_sign message: canonical JSON of the body. */
export function approvalDecisionMessage(body: ApprovalDecisionBody): string {
  return canonicalJson(body);
}

/** Recover the approver's address, or null when the signature does not parse. */
export async function approvalDecisionSigner(body: ApprovalDecisionBody, sig: string): Promise<Address | null> {
  try {
    return await recoverMessageAddress({ message: approvalDecisionMessage(body), signature: sig as Hex });
  } catch {
    return null;
  }
}
