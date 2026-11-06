import type { Address, Hex } from "viem";
import { canonicalJson, type Envelope, type EnvelopeSpend } from "@countersign/core";

/** The agent key: it signs envelope mirrors and approval requests. */
export interface SigningAccount {
  readonly address: Address;
  signMessage(args: { message: string }): Promise<Hex>;
}

export interface EnvelopeMirrorHub {
  readonly url: string;
}

type HubRef = string | EnvelopeMirrorHub;

function hubUrl(hub: HubRef): string {
  return typeof hub === "string" ? hub.replace(/\/+$/, "") : hub.url;
}

/** The process-local high-water mark per agent, so every mirror in one buy is strictly newer. */
const lastSignedAt = new Map<string, number>();

/**
 * Publish the agent's signed view of its envelope and spend to the hub. The hub stores
 * only what verifies, so nothing there can loosen the human's limits. Never throws: a
 * mirror failure is a logged line, not a failed buy.
 */
export async function publishEnvelope(args: {
  hub: HubRef;
  account: SigningAccount;
  envelope: Envelope;
  spent: EnvelopeSpend;
  now: number;
  /** Abort the PUT after this many milliseconds. Default 5000. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<boolean> {
  try {
    const load = args.fetchImpl ?? fetch;
    const key = args.account.address.toLowerCase();
    const base = Math.floor(args.now);
    const previous = lastSignedAt.get(key);
    const signedAt = previous === undefined ? base : Math.max(base, previous + 1);
    lastSignedAt.set(key, signedAt);
    const message = canonicalJson({ envelope: args.envelope, spent: args.spent, signedAt });
    const sig = await args.account.signMessage({ message });
    const response = await load(`${hubUrl(args.hub)}/envelopes/${args.account.address}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ envelope: args.envelope, spent: args.spent, signedAt, sig }),
      signal: AbortSignal.timeout(args.timeoutMs ?? 5_000),
    });
    if (!response.ok) {
      console.warn(`[buyer] envelope mirror refused with ${response.status}`);
      return false;
    }
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    console.warn(`[buyer] envelope mirror failed: ${message}`);
    return false;
  }
}
