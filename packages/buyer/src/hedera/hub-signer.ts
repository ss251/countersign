// The remote hedera signer: the frozen transfer goes to the hub, which adds the user's Privy
// key's signature and sends the same transfer back. The token stays on the session's own hub.
import { NOT_SIGNED_IN, assertHubOrigin } from "../remote-signer.ts";
import type { RemoteHederaSigner } from "./signer.ts";

export interface HubSession {
  hub: string;
  token: string;
}

export interface HederaAccount {
  accountId: string;
}

export interface HubSignerOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const NO_NETWORK = "The hub could not be reached.";
const NO_TRANSFER = "The hub could not sign (200).";

interface Reply {
  status: number;
  body: unknown;
}

function baseOf(session: HubSession): string {
  assertHubOrigin(session.hub);
  return session.hub.replace(/\/+$/, "");
}

function messageOf(body: unknown): string | undefined {
  if (body === null || typeof body !== "object") return undefined;
  const message = (body as { message?: unknown }).message;
  return typeof message === "string" ? message : undefined;
}

async function request(
  fetchImpl: typeof fetch,
  timeoutMs: number,
  url: string,
  init: RequestInit,
): Promise<Reply> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    return { status: response.status, body: await response.json().catch(() => undefined) };
  } catch {
    throw new Error(NO_NETWORK);
  } finally {
    clearTimeout(timer);
  }
}

export function hubHederaSigner(session: HubSession, opts: HubSignerOptions = {}): RemoteHederaSigner {
  const base = baseOf(session);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    remote: true,
    async signTransfer(transactionBytes: string, offerHash: string): Promise<string> {
      const reply = await request(fetchImpl, timeoutMs, `${base}/cli/sign/hedera`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${session.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ offerHash, transactionBytes }),
      });
      if (reply.status === 200) {
        const signed = (reply.body as { transactionBytes?: unknown } | undefined)?.transactionBytes;
        if (typeof signed !== "string") throw new Error(NO_TRANSFER);
        return signed;
      }
      if (reply.status === 401) throw new Error(NOT_SIGNED_IN);
      if (reply.status === 403) throw new Error(messageOf(reply.body) ?? "The hub refused the request.");
      if (reply.status === 404) throw new Error("This hub does not sign Hedera payments yet.");
      if (reply.status === 409) throw new Error("No Hedera account yet. Run: countersign whoami");
      throw new Error(`The hub could not sign (${reply.status}).`);
    },
  };
}

/** The user's Hedera account id, provisioning one when the session has none yet. */
export async function hubHederaAccount(
  session: HubSession,
  opts: HubSignerOptions = {},
): Promise<HederaAccount | null> {
  const base = baseOf(session);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const authorization = `Bearer ${session.token}`;

  const read = await request(fetchImpl, timeoutMs, `${base}/cli/session`, {
    method: "GET",
    headers: { authorization },
  });
  if (read.status === 401) throw new Error(NOT_SIGNED_IN);
  if (read.status !== 200) throw new Error(`Could not read the countersign session (${read.status}).`);
  const hedera = (read.body as { hedera?: { accountId?: unknown } | null } | undefined)?.hedera;
  if (hedera !== null && typeof hedera === "object" && typeof hedera.accountId === "string") {
    return { accountId: hedera.accountId };
  }

  const created = await request(fetchImpl, timeoutMs, `${base}/cli/hedera/account`, {
    method: "POST",
    headers: { authorization },
  });
  if (created.status === 200) {
    const accountId = (created.body as { accountId?: unknown } | undefined)?.accountId;
    if (typeof accountId !== "string") throw new Error("The hub returned no Hedera account.");
    return { accountId };
  }
  if (created.status === 404) return null;
  if (created.status === 401) throw new Error(NOT_SIGNED_IN);
  throw new Error(`The hub could not provision a Hedera account (${created.status}).`);
}
