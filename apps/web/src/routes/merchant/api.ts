import type { Order, ReceiptOrder, RelayStatus } from "./model.ts";

interface MerchantEnv {
  readonly VITE_MERCHANT_URL?: string;
  readonly VITE_RELAY_URL?: string;
}

const env = import.meta.env as unknown as MerchantEnv;

function baseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export const MERCHANT_URL = baseUrl(env.VITE_MERCHANT_URL ?? "http://127.0.0.1:8403");
export const RELAY_URL = baseUrl(env.VITE_RELAY_URL ?? "http://127.0.0.1:8402");

export interface RefundSuccess {
  ok: true;
  txHash: string;
  txUrl: string;
  refunded: string;
  remaining: string;
}

export interface RefundFailure {
  ok: false;
  reason: string;
}

export type RefundResult = RefundSuccess | RefundFailure;

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

async function getJson<T>(url: string, missing: Error): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw missing;
  }
  if (!response.ok) throw new Error(`${url} answered ${response.status}.`);
  return (await readJson(response, url)) as T;
}

export async function fetchMerchant(base = MERCHANT_URL): Promise<{ address: string }> {
  return getJson<{ address: string }>(`${base}/me`, unreachable(base));
}

export async function fetchOrders(base = MERCHANT_URL): Promise<{ orders: Order[] }> {
  return getJson<{ orders: Order[] }>(`${base}/orders`, unreachable(base));
}

export async function refundOrder(id: string, base = MERCHANT_URL): Promise<RefundResult> {
  const url = `${base}/orders/${encodeURIComponent(id)}/refund`;
  let response: Response;
  try {
    response = await fetch(url, { method: "POST" });
  } catch {
    throw unreachable(base);
  }

  const text = await response.text();
  if (text.trim() === "") throw new Error(`${url} answered ${response.status} with no body.`);

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${url} did not return JSON.`);
  }

  if (body && typeof body === "object" && "ok" in body) {
    const result = body as RefundResult;
    if (result.ok === false) {
      return { ok: false, reason: typeof result.reason === "string" ? result.reason : `http_${response.status}` };
    }
    if (result.ok === true && typeof result.txHash === "string") return result;
  }

  throw new Error(`${url} answered ${response.status}.`);
}

export async function fetchOrdersCsv(base = MERCHANT_URL): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${base}/orders.csv`);
  } catch {
    throw unreachable(base);
  }
  if (!response.ok) throw new Error(`The merchant service answered ${response.status}.`);
  return await response.text();
}

export async function fetchRelayStatus(base = RELAY_URL): Promise<RelayStatus> {
  return getJson<RelayStatus>(
    `${base}/status`,
    new Error(`The relay is not running on ${base}.`),
  );
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
