import { canonicalJson } from "@countersign/core";
import type { SigningAccount } from "./mirror.ts";

export type ApprovalOutcome = "countersign" | "decline" | "expired" | "timeout";

export interface ApprovalHub {
  readonly url: string;
}

type HubRef = string | ApprovalHub;

function hubUrl(hub: HubRef): string {
  return typeof hub === "string" ? hub.replace(/\/+$/, "") : hub.url;
}

/**
 * Ask the hub for a human countersignature on a held call, then poll until the phone
 * decides or the wait times out. The signature names the agent and every term shown
 * to the human, so a decision is bound to this exact call.
 */
export async function requestApproval(args: {
  hub: HubRef;
  account: SigningAccount;
  offerHash: string;
  title: string;
  amount: string;
  rail: string;
  terms: unknown;
  now: number;
  timeoutMs?: number;
  pollMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<ApprovalOutcome> {
  const load = args.fetchImpl ?? fetch;
  const base = hubUrl(args.hub);
  const timeoutMs = args.timeoutMs ?? 120_000;
  const pollMs = args.pollMs ?? 2_000;
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
    const status = await readStatus(load, `${base}/approvals/${body.id}`);
    if (status === "countersign" || status === "decline" || status === "expired") return status;
    const left = deadline - Date.now();
    if (left <= 0) return "timeout";
    await sleep(Math.min(pollMs, left));
  }
}

async function readStatus(load: typeof fetch, url: string): Promise<ApprovalOutcome | "pending"> {
  try {
    const response = await load(url);
    if (!response.ok) return "pending";
    const body = (await response.json()) as { status?: unknown };
    if (body.status === "countersign" || body.status === "decline" || body.status === "expired") {
      return body.status;
    }
    return "pending";
  } catch {
    return "pending";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
