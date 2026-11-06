import type { Order, ReceiptOrder, RefundReply, RelayStatus } from "./model.ts";
import { normaliseRefundReply, tokenProblem } from "./model.ts";

interface MerchantEnv {
  readonly VITE_MERCHANT_URL?: string;
  readonly VITE_RELAY_URL?: string;
  readonly VITE_MERCHANT_TOKEN?: string;
  readonly VITE_HUB_URL?: string;
}

const env = import.meta.env as unknown as MerchantEnv;

function baseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export const MERCHANT_URL = baseUrl(env.VITE_MERCHANT_URL ?? "/merchant-api");
export const RELAY_URL = baseUrl(env.VITE_RELAY_URL ?? "/relay");
export const HUB_URL = baseUrl(env.VITE_HUB_URL ?? "/hub");

const MERCHANT_TOKEN = (env.VITE_MERCHANT_TOKEN ?? "").trim();

export function merchantTokenMissing(): boolean {
  return tokenProblem(MERCHANT_TOKEN) !== null;
}

function unreachable(base: string): Error {
  return new Error(`The merchant service is not running on ${base}.`);
}

async function readJson(response: Response, url: string): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new Error(`${url} did not return JSON.`);
  }
}

async function relayGetJson<T>(url: string, missing: Error): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw missing;
  }
  if (!response.ok) throw new Error(`${url} answered ${response.status}.`);
  return (await readJson(response, url)) as T;
}

/** Every merchant call except /me carries the bearer token and names auth failures. */
async function merchantFetch(url: string, base: string, init?: RequestInit): Promise<Response> {
  const problem = tokenProblem(MERCHANT_TOKEN);
  if (problem) throw new Error(problem);
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${MERCHANT_TOKEN}` },
    });
  } catch {
    throw unreachable(base);
  }
  const refused = tokenProblem(MERCHANT_TOKEN, response.status);
  if (refused) throw new Error(refused);
  return response;
}

async function merchantGetJson<T>(url: string, base: string): Promise<T> {
  const response = await merchantFetch(url, base);
  if (!response.ok) throw new Error(`${url} answered ${response.status}.`);
  return (await readJson(response, url)) as T;
}

export async function fetchMerchant(base = MERCHANT_URL): Promise<{ address: string }> {
  return relayGetJson<{ address: string }>(`${base}/me`, unreachable(base));
}

export async function fetchOrders(base = MERCHANT_URL): Promise<{ orders: Order[] }> {
  return merchantGetJson<{ orders: Order[] }>(`${base}/orders`, base);
}

export async function refundOrder(id: string, base = MERCHANT_URL): Promise<RefundReply> {
  const url = `${base}/orders/${encodeURIComponent(id)}/refund`;
  const response = await merchantFetch(url, base, { method: "POST" });

  const text = await response.text();
  if (text.trim() === "") throw new Error(`${url} answered ${response.status} with no body.`);

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${url} did not return JSON.`);
  }

  const reply = normaliseRefundReply(body, response.status);
  if (reply) return reply;
  throw new Error(`${url} answered ${response.status}.`);
}

export async function fetchOrdersCsv(base = MERCHANT_URL): Promise<string> {
  const response = await merchantFetch(`${base}/orders.csv`, base);
  if (!response.ok) throw new Error(`The merchant service answered ${response.status}.`);
  return await response.text();
}

export async function fetchMerchantStatus(base = MERCHANT_URL): Promise<RelayStatus> {
  return merchantGetJson<RelayStatus>(`${base}/status`, base);
}

export async function fetchOfferTitle(
  offerHash: string,
  base = HUB_URL,
): Promise<string | null> {
  try {
    const response = await fetch(`${base}/offers/${encodeURIComponent(offerHash)}`);
    if (!response.ok) return null;
    const body = (await response.json()) as { offer?: { title?: unknown } };
    const title = body?.offer?.title;
    return typeof title === "string" && title.trim() !== "" ? title : null;
  } catch {
    return null;
  }
}

export async function fetchRelayOrder(id: string, base = RELAY_URL): Promise<ReceiptOrder | null> {
  let response: Response;
  try {
    response = await fetch(`${base}/orders/${encodeURIComponent(id)}`);
  } catch {
    throw new Error(`The relay is not running on ${base}.`);
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`The relay answered ${response.status}.`);
  return (await readJson(response, `${base}/orders/${id}`)) as ReceiptOrder;
}
