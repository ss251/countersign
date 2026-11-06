import { FOREIGN_HUB, HubError } from "../../lib/hub.ts";

export const CODE = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;

/** The code as the terminal printed it, ready to compare; null when the query holds no usable code. */
export function readCode(query: URLSearchParams): string | null {
  const raw = query.get("code");
  if (raw === null) return null;
  const code = raw.trim().toUpperCase();
  return CODE.test(code) ? code : null;
}

export type ApproveOutcome =
  | { kind: "approved"; address: string | null }
  | { kind: "signed-out" }
  | { kind: "expired" }
  | { kind: "error"; message: string };

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** The person's server wallet, when the hub names one. */
function addressOf(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const answer = value as { address?: unknown };
  return typeof answer.address === "string" && ADDRESS.test(answer.address) ? answer.address : null;
}

/**
 * Approve the code the terminal printed. The Privy access token goes in the header and nowhere else:
 * no message carries it, and no answer body becomes one.
 */
export async function approveCliLogin(deps: {
  post: (path: string, body: unknown, headers: Record<string, string>) => Promise<unknown>;
  privyToken: string;
  code: string;
}): Promise<ApproveOutcome> {
  let value: unknown;
  try {
    value = await deps.post("/cli/login/approve", { code: deps.code }, { "x-privy-token": deps.privyToken });
  } catch (e) {
    if (e instanceof HubError) {
      if (e.code === "foreign-hub") return { kind: "error", message: FOREIGN_HUB };
      if (e.status === 401) return { kind: "signed-out" };
      if (e.status === 404 || e.status === 410) return { kind: "expired" };
      if (e.status === 0) return { kind: "error", message: "The hub did not answer. Try again in a moment." };
    }
    return { kind: "error", message: "The hub could not connect this CLI." };
  }
  return { kind: "approved", address: addressOf(value) };
}
