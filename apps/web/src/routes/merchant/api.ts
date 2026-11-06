import type { Order, ReceiptOrder, RefundReply, RelayStatus } from "./model.ts";
import { normalizeRefundReply } from "./model.ts";

interface MerchantEnv {
  readonly VITE_MERCHANT_URL?: string;
  readonly VITE_RELAY_URL?: string;
  readonly VITE_HUB_URL?: string;
  readonly VITE_MERCHANT_TOKEN?: string;
}

const env = import.meta.env as unknown as MerchantEnv;

function baseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

// Same-origin paths by default: the dev and preview servers proxy them, so one origin serves the page.
export const MERCHANT_URL = baseUrl(env.VITE_MERCHANT_URL ?? "/merchant-api");
export const RELAY_URL = baseUrl(env.VITE_RELAY_URL ?? "/relay");
export const HUB_URL = baseUrl(env.VITE_HUB_URL ?? "/hub");
const TOKEN = env.VITE_MERCHANT_TOKEN?.trim() ?? "";

export const TOKEN_MISSING = "The merchant console needs its token. Set VITE_MERCHANT_TOKEN.";
export const TOKEN_REFUSED = "The merchant service refused the token.";

export type RefundResult = RefundReply;

function unreachable(base: string): Error {
  return new Error(`The merchant service is not running on ${base}.`);
}

/** The merchant's own backend: every route but /me carries the bearer token. */
async function merchantFetch(path: string, init: RequestInit = {}, base = MERCHANT_URL): Promise<Response> {
  if (!TOKEN) throw new Error(TOKEN_MISSING);
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${TOKEN}` },
    });
  } catch {
    throw unreachable(base);
  }
  if (response.status === 401) throw new Error(TOKEN_REFUSED);
  return response;
}

async function readJson<T>(response: Response, what: string): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new Error(`${what} did not answer with JSON.`);
  }
}

export async function fetchMerchant(base = MERCHANT_URL): Promise<{ address: string }> {
  let response: Response;
  try {
    response = await fetch(`${base}/me`);
  } catch {
    throw unreachable(base);
  }
  if (!response.ok) throw new Error(`The merchant service answered ${response.status}.`);
  return readJson(response, "The merchant service");
}

export async function fetchOrders(base = MERCHANT_URL): Promise<{ orders: Order[] }> {
  const response = await merchantFetch("/orders", {}, base);
  if (!response.ok) throw new Error(`The merchant service answered ${response.status}.`);
  return readJson(response, "The merchant service");
}

export async function refundOrder(id: string, base = MERCHANT_URL): Promise<RefundResult> {
  const response = await merchantFetch(`/orders/${encodeURIComponent(id)}/refund`, { method: "POST" }, base);
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text.trim() === "" ? null : JSON.parse(text);
  } catch {
    throw new Error("The merchant service did not answer with JSON.");
  }
  const reply = normalizeRefundReply(body, response.status);
  if (!reply) throw new Error(`The merchant service answered ${response.status}.`);
  return reply;
}

export async function fetchOrdersCsv(base = MERCHANT_URL): Promise<string> {
  const response = await merchantFetch("/orders.csv", {}, base);
  if (!response.ok) throw new Error(`The merchant service answered ${response.status}.`);
  return response.text();
}

/** The relayer's gas status, through the merchant service so the page needs one origin. */
export async function fetchRelayStatus(base = MERCHANT_URL): Promise<RelayStatus> {
  const response = await merchantFetch("/status", {}, base);
  if (!response.ok) throw new Error(`The relay answered ${response.status}.`);
  return readJson(response, "The relay");
}

/** A single order, public: this is the receipt anyone can check. */
export async function fetchRelayOrder(id: string, base = RELAY_URL): Promise<ReceiptOrder | null> {
  let response: Response;
  try {
    response = await fetch(`${base}/orders/${encodeURIComponent(id)}`);
  } catch {
    throw new Error(`The relay is not running on ${base}.`);
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`The relay answered ${response.status}.`);
  return readJson(response, "The relay");
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
