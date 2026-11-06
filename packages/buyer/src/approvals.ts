import type { Address } from "viem";
import { approvalDecisionBody, approvalDecisionSigner, canonicalJson } from "@countersign/core";
import type { SigningAccount } from "./mirror.ts";

export type ApprovalOutcome = "countersign" | "decline" | "expired" | "timeout" | "unverified";

export interface ApprovalHub {
  readonly url: string;
}

type HubRef = string | ApprovalHub;

function hubUrl(hub: HubRef): string {
  return typeof hub === "string" ? hub.replace(/\/+$/, "") : hub.url;
}

/**
 * Ask the hub for a human countersignature on a held call, then poll until the phone
 * decides or the wait times out. A `countersign` answer only counts when it carries a
 * signature by `approver` over the agent's own request values; the hub's word alone is
 * never enough.
 */
export async function requestApproval(args: {
  hub: HubRef;
  account: SigningAccount;
  approver: Address;
  offerHash: string;
  title: string;
  amount: string;
  rail: string;
  terms: unknown;
  now: number;
  timeoutMs?: number;
  pollMs?: number;
  fetchTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<ApprovalOutcome> {
  const load = args.fetchImpl ?? fetch;
  const base = hubUrl(args.hub);
  const timeoutMs = args.timeoutMs ?? 120_000;
  const pollMs = args.pollMs ?? 2_000;
  const fetchTimeoutMs = args.fetchTimeoutMs ?? 10_000;
  const request = {
    agent: args.account.address,
    offerHash: args.offerHash,
    title: args.title,
    amount: args.amount,
    rail: args.rail,
    terms: args.terms,
    requestedAt: args.now,
  };
  const sig = await args.account.signMessage({ message: canonicalJson(request) });

  const created = await load(`${base}/approvals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...request, sig }),
    signal: AbortSignal.timeout(fetchTimeoutMs),
  });
  if (!created.ok) {
    throw new Error(`The hub refused the approval request with ${created.status}.`);
  }
  const body = (await created.json()) as { id?: unknown };
  if (typeof body.id !== "string") {
    throw new Error("The hub did not return an approval id.");
  }

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await readStatus(load, `${base}/approvals/${body.id}`, fetchTimeoutMs);
    if (status.status === "decline" || status.status === "expired") return status.status;
    if (status.status === "countersign") {
      if (typeof status.decidedAt !== "number" || typeof status.decisionSig !== "string") {
        return "unverified";
      }
      const decidedAt = status.decidedAt;
      if (!Number.isSafeInteger(decidedAt)) return "unverified";
      const nowSec = Math.floor(Date.now() / 1000);
      if (decidedAt < args.now - 30 || decidedAt > args.now + 900 || decidedAt > nowSec + 30) {
        return "unverified";
      }
      const expected = approvalDecisionBody({
        approvalId: body.id,
        agent: args.account.address,
        offerHash: args.offerHash,
        amount: args.amount,
        rail: args.rail,
        terms: args.terms,
        decision: "countersign",
        decidedAt,
      });
      const signer = await approvalDecisionSigner(expected, status.decisionSig);
      if (signer === null || signer.toLowerCase() !== args.approver.toLowerCase()) {
        return "unverified";
      }
      return "countersign";
    }
    const left = deadline - Date.now();
    if (left <= 0) return "timeout";
    await sleep(Math.min(pollMs, left));
  }
}

type PollResult =
  | { status: "pending" }
  | { status: "decline" }
  | { status: "expired" }
  | { status: "countersign"; decidedAt: unknown; decisionSig: unknown };

async function readStatus(load: typeof fetch, url: string, timeoutMs: number): Promise<PollResult> {
  try {
    const response = await load(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return { status: "pending" };
    const body = (await response.json()) as {
      status?: unknown;
      decidedAt?: unknown;
      decisionSig?: unknown;
    };
    if (body.status === "countersign") {
      return { status: "countersign", decidedAt: body.decidedAt, decisionSig: body.decisionSig };
    }
    if (body.status === "decline" || body.status === "expired") return { status: body.status };
    return { status: "pending" };
  } catch {
    return { status: "pending" };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
