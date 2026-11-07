/**
 * The console's Hedera account and payments. Both calls carry the person's Privy access token, and the
 * hub signs with the Hedera key it holds server-side: this console never sees a Hedera key and opens no
 * wallet. The hub provisions the account on first use.
 */

export interface HederaAccount {
  accountId: string;
  /** USDC as a decimal string, exactly as the hub reports it. */
  usdc: string;
}

export interface HederaStep {
  label: string;
  /** ISO time. */
  at: string;
  url?: string;
}

export interface HederaPurchase {
  steps: HederaStep[];
  slipHash: string;
  hashscanUrl: string;
  output: unknown;
}

export class HederaError extends Error {
  override name = "HederaError";
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

/** How many times a 409 "provisioning" answer is retried, and how long between tries. */
const PROVISIONING_RETRIES = 5;
const PROVISIONING_DELAY_MS = 3000;
const ACCOUNT_TIMEOUT_MS = 10_000;
const BUY_TIMEOUT_MS = 30_000;
const NO_ANSWER = "The hub did not answer.";

export interface HederaOptions {
  /** Milliseconds between 409 answers; tests pass 0 rather than wait. */
  retryDelayMs?: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function hubBaseOf(hub: string): string {
  return hub.replace(/\/+$/, "");
}

async function jsonOf(res: Response): Promise<unknown> {
  return await res.json().catch(() => null);
}

function recordOf(body: unknown): { code?: string; message?: string } {
  if (body === null || typeof body !== "object") return {};
  const b = body as Record<string, unknown>;
  return {
    ...(typeof b.code === "string" ? { code: b.code } : {}),
    ...(typeof b.message === "string" ? { message: b.message } : {}),
  };
}

function errorOf(res: Response, body: unknown): HederaError {
  const { code, message } = recordOf(body);
  return new HederaError(res.status, message ?? `The hub answered ${res.status}.`, code);
}

async function request(hub: string, path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${hubBaseOf(hub)}${path}`, { ...init, signal: controller.signal });
  } catch {
    throw new HederaError(0, NO_ANSWER);
  } finally {
    clearTimeout(timer);
  }
}

function accountOf(body: unknown): HederaAccount {
  if (body !== null && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (typeof b.accountId === "string" && typeof b.usdc === "string") {
      return { accountId: b.accountId, usdc: b.usdc };
    }
  }
  throw new HederaError(200, "The hub's answer named no Hedera account.");
}

function purchaseOf(body: unknown): HederaPurchase {
  if (body !== null && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (Array.isArray(b.steps) && typeof b.slipHash === "string" && typeof b.hashscanUrl === "string") {
      return {
        steps: b.steps as HederaStep[],
        slipHash: b.slipHash,
        hashscanUrl: b.hashscanUrl,
        output: b.output,
      };
    }
  }
  throw new HederaError(200, "The hub's answer was not a Hedera purchase.");
}

/** The signed-in person's Hedera account, or null when this hub has the feature off. */
export async function getHederaAccount(hub: string, token: string, options: HederaOptions = {}): Promise<HederaAccount | null> {
  const delay = options.retryDelayMs ?? PROVISIONING_DELAY_MS;
  for (let attempt = 0; ; attempt += 1) {
    const res = await request(
      hub,
      "/me/hedera",
      { headers: { accept: "application/json", "x-privy-token": token } },
      ACCOUNT_TIMEOUT_MS,
    );
    const body = await jsonOf(res);
    if (res.ok) return accountOf(body);
    // Off on this hub: the console shows nothing new at all.
    if (res.status === 404) return null;
    // The hub is making the account now; it asks for about three seconds.
    if (res.status === 409 && attempt < PROVISIONING_RETRIES) {
      await sleep(delay);
      continue;
    }
    throw errorOf(res, body);
  }
}

/** Pay an offer from the signed-in person's Hedera account, with the hub signing server-side. */
export async function buyOnHedera(
  hub: string,
  token: string,
  offerHash: string,
  input: unknown,
): Promise<HederaPurchase> {
  const res = await request(
    hub,
    "/me/hedera/buy",
    {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", "x-privy-token": token },
      body: JSON.stringify({ offerHash, input }),
    },
    BUY_TIMEOUT_MS,
  );
  const body = await jsonOf(res);
  if (!res.ok) throw errorOf(res, body);
  return purchaseOf(body);
}

/** The event the console's account line listens for: a purchase finished, so the balance moved. */
export const HEDERA_BUY_EVENT = "countersign:hedera-buy";

export function announceHederaBuy(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(HEDERA_BUY_EVENT));
}
