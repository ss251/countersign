import {
  approvalDecisionBody,
  approvalDecisionMessage,
  approvalRequestHash,
  canonicalJson,
  type ApprovalDecision,
  type ApprovalRequest,
} from "@countersign/core";
import type { Approval } from "./types.ts";

/*
 * This phone's approver key and the version 2 decision it signs (docs/spec/envelope.md,
 * "Approving a held call from another device").
 *
 * The key is made once in this browser and never leaves it; only its address is shown, to be named
 * as `approver` in the agent's envelope. Before it signs, the phone checks that the agent signed
 * exactly the request it shows. Then it signs the body core defines, which the hub and the agent
 * both rebuild from their own copies. viem's signing code loads only when a phone makes a key or
 * decides, so no other screen pays for it.
 */

const KEY = "countersign.approver-key";
const ADDRESS = "countersign.approver-address";

type Hex = `0x${string}`;

export type SigningProblem = "no-key" | "no-request" | "not-the-agents" | "not-what-you-see";

/** Why this phone would not sign. Each leaves nothing signed and nothing sent. */
export class SigningError extends Error {
  override name = "SigningError";
  constructor(
    readonly problem: SigningProblem,
    message: string,
  ) {
    super(message);
  }
}

function readKey(): Hex | null {
  try {
    const v = window.localStorage.getItem(KEY);
    return v && /^0x[0-9a-fA-F]{64}$/.test(v) ? (v as Hex) : null;
  } catch {
    return null;
  }
}

/** This phone's approver address, once it has made a key; null before. */
export function approverAddress(): string | null {
  try {
    const address = window.localStorage.getItem(ADDRESS);
    return address && readKey() ? address : null;
  } catch {
    return null;
  }
}

/** Make this phone's approver key, once. Asked again, it returns the same address. */
export async function makeApprover(): Promise<string> {
  const { generatePrivateKey, privateKeyToAccount } = await import("viem/accounts");
  const key = readKey() ?? generatePrivateKey();
  const { address } = privateKeyToAccount(key);
  window.localStorage.setItem(KEY, key);
  window.localStorage.setItem(ADDRESS, address);
  return address;
}

/**
 * The agent signed exactly what this phone shows. Its signature over the canonical request
 * recovers the agent, and the request's offer, amount, rail and title are the ones on screen.
 */
export async function checkRequest(approval: Approval): Promise<ApprovalRequest> {
  const held = approval.signing;
  if (!held?.request || !held.requestSig) {
    throw new SigningError("no-request", "The hub holds no signed request for this call, so there is nothing to countersign.");
  }
  const request = held.request;
  const agent = (approval.agent ?? "").toLowerCase();
  const { recoverMessageAddress } = await import("viem");
  let signer: string | null = null;
  try {
    signer = await recoverMessageAddress({ message: canonicalJson(request), signature: held.requestSig as Hex });
  } catch {
    signer = null;
  }
  if (!agent || !signer || signer.toLowerCase() !== agent || request.agent.toLowerCase() !== agent) {
    throw new SigningError("not-the-agents", "This request is not signed by your agent, so this phone will not countersign it.");
  }
  const same =
    request.offerHash.toLowerCase() === held.offerHash.toLowerCase() &&
    request.amount === approval.amount &&
    request.rail === approval.rail &&
    request.title === approval.listing.offer.title;
  if (!same) {
    throw new SigningError("not-what-you-see", "Your agent signed a different offer or amount from the one shown here, so this phone will not countersign it.");
  }
  return request;
}

/**
 * Sign one version 2 decision with this phone's key. It is bound to this request by its hash, so it
 * cannot clear any other call, even one for the same offer and amount.
 */
export async function signDecision(
  approval: Approval,
  decision: ApprovalDecision,
  now: number = Math.floor(Date.now() / 1000),
): Promise<{ decidedAt: number; sig: string }> {
  const key = readKey();
  if (!key) throw new SigningError("no-key", "This phone has no approver key yet.");
  const request = await checkRequest(approval);
  const { privateKeyToAccount } = await import("viem/accounts");
  const body = approvalDecisionBody({
    approvalId: approval.id,
    agent: request.agent,
    offerHash: request.offerHash,
    amount: request.amount,
    rail: request.rail,
    terms: request.terms,
    requestHash: approvalRequestHash(request),
    decision,
    decidedAt: now,
  });
  const sig = await privateKeyToAccount(key).signMessage({ message: approvalDecisionMessage(body) });
  return { decidedAt: now, sig };
}
