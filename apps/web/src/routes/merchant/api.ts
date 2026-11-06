import type { Order, ReceiptOrder, RefundReason, RefundReply, RelayStatus } from "./model.ts";
import { normalizeRefundReply } from "./model.ts";

interface MerchantEnv {
  readonly VITE_MERCHANT_URL?: string;
  readonly VITE_RELAY_URL?: string;
  readonly VITE_HUB_URL?: string;
  readonly VITE_MERCHANT_TOKEN?: string;
  readonly VITE_MERCHANT_ADDRESS?: string;
}

const env = import.meta.env as unknown as MerchantEnv;

function baseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

// Same-origin paths by default: the dev and preview servers proxy them, so one origin serves the page.
export const MERCHANT_URL = baseUrl(env.VITE_MERCHANT_URL ?? "/merchant-api");
export const RELAY_URL = baseUrl(env.VITE_RELAY_URL ?? "/relay");
export const HUB_URL = baseUrl(env.VITE_HUB_URL ?? "/hub");
/** A hosted console names its merchant here. It is an address, public, never a secret. */
export const CONFIGURED_MERCHANT = env.VITE_MERCHANT_ADDRESS?.trim() ?? "";

/*
 * The token signs refunds and nothing else. A local build may carry it; a hosted build never
 * does. There the merchant types it in, and it lives in this module for the life of the tab:
 * never in storage, never in the URL.
 */
const BUILD_TOKEN = env.VITE_MERCHANT_TOKEN?.trim() ?? "";
let sessionToken = "";

export function canSignRefunds(): boolean {
  return (sessionToken || BUILD_TOKEN) !== "";
}

export const TOKEN_REFUSED = "The merchant service refused the token.";

export type RefundResult = RefundReply;

function unreachable(what: string, base: string): Error {
  return new Error(`The ${what} is not running on ${base}.`);
}

async function readJson<T>(response: Response, what: string): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new Error(`The ${what} did not answer with JSON.`);
  }
}

/** The relay's public reads: the same records any customer can check. */
async function relayGet(path: string, base = RELAY_URL): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${base}${path}`);
  } catch {
    throw unreachable("relay", base);
  }
  return response;
}

/** The merchant's own service, which holds the signing key. Every call carries the token. */
async function merchantFetch(path: string, init: RequestInit = {}, token = sessionToken || BUILD_TOKEN): Promise<Response> {
  if (!token) throw new Error("Refunds need the merchant token.");
  let response: Response;
  try {
    response = await fetch(`${MERCHANT_URL}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
    });
  } catch {
    throw unreachable("merchant service", MERCHANT_URL);
  }
  if (response.status === 401) throw new Error(TOKEN_REFUSED);
  return response;
}

/**
 * Checks a typed token against the merchant service and keeps it for this tab if it is good.
 * The service answers /orders only to its own token, so a 200 proves it.
 */
export async function unlockRefunds(token: string): Promise<void> {
  const trimmed = token.trim();
  if (!trimmed) throw new Error("Enter the merchant token.");
  const response = await merchantFetch("/orders", {}, trimmed);
  if (!response.ok) throw new Error(`The merchant service answered ${response.status}.`);
  sessionToken = trimmed;
}

/** Whose desk this is: the page's ?merchant=, the hosted build's address, or the merchant service. */
export async function resolveMerchant(query: string | null): Promise<string> {
  const wanted = query?.trim() || CONFIGURED_MERCHANT;
  if (/^0x[0-9a-fA-F]{40}$/.test(wanted)) return wanted;
  let response: Response;
  try {
    response = await fetch(`${MERCHANT_URL}/me`);
  } catch {
    throw new Error("No merchant to show. Open this page with ?merchant=0x… or run the merchant service.");
  }
  if (!response.ok) throw new Error(`The merchant service answered ${response.status}.`);
  const me = await readJson<{ address?: unknown }>(response, "merchant service");
  if (typeof me.address !== "string") throw new Error("The merchant service did not name its address.");
  return me.address;
}

export async function fetchOrders(merchant: string): Promise<Order[]> {
  const response = await relayGet(`/orders?merchant=${encodeURIComponent(merchant)}`);
  if (!response.ok) throw new Error(`The relay answered ${response.status}.`);
  const body = await readJson<{ orders?: Order[] }>(response, "relay");
  return body.orders ?? [];
}

export async function fetchOrdersCsv(merchant: string): Promise<string> {
  const response = await relayGet(`/orders.csv?merchant=${encodeURIComponent(merchant)}`);
  if (!response.ok) throw new Error(`The relay answered ${response.status}.`);
  return response.text();
}

/** The relayer's gas: its balance and this hour's ceiling. */
export async function fetchRelayStatus(): Promise<RelayStatus> {
  const response = await relayGet("/status");
  if (!response.ok) throw new Error(`The relay answered ${response.status}.`);
  return readJson(response, "relay");
}

/** A single order with every refund, public: this is the receipt anyone can check. */
export async function fetchRelayOrder(id: string, base = RELAY_URL): Promise<ReceiptOrder | null> {
  const response = await relayGet(`/orders/${encodeURIComponent(id)}`, base);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`The relay answered ${response.status}.`);
  return readJson(response, "relay");
}

export interface RefundRequest {
  /** Atomic USDT. Leave it out to send back everything that is left. */
  amount?: bigint;
  reason?: RefundReason;
}

export async function refundOrder(id: string, request: RefundRequest = {}): Promise<RefundResult> {
  const body: { amount?: string; reason?: RefundReason } = {};
  if (request.amount !== undefined) body.amount = request.amount.toString();
  if (request.reason) body.reason = request.reason;
  const response = await merchantFetch(`/orders/${encodeURIComponent(id)}/refund`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text.trim() === "" ? null : JSON.parse(text);
  } catch {
    throw new Error("The merchant service did not answer with JSON.");
  }
  const reply = normalizeRefundReply(parsed, response.status);
  if (!reply) throw new Error(`The merchant service answered ${response.status}.`);
  return reply;
}

const titles = new Map<string, Promise<string | null>>();

/** The offer's title from the hub, cached per offer for the page's lifetime. A failure is cached as no title. */
export function fetchOfferTitle(offerHash: string, base = HUB_URL): Promise<string | null> {
  const key = offerHash.toLowerCase();
  let pending = titles.get(key);
  if (!pending) {
    pending = fetch(`${base}/offers/${encodeURIComponent(offerHash)}`)
      .then(async (response) => {
        if (!response.ok) return null;
        const listing = (await response.json()) as { offer?: { title?: unknown } };
        return typeof listing.offer?.title === "string" ? listing.offer.title : null;
      })
      .catch(() => null);
    titles.set(key, pending);
  }
  return pending;
}
