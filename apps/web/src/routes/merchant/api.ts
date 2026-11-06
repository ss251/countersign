import { hubBase } from "../../lib/hub.ts";
import type { Order, ReceiptOrder, RefundReply, RelayStatus } from "./model.ts";
import { fromHubOrder, fromHubRecord, normalizeRefundReply } from "./model.ts";

interface MerchantEnv {
  readonly VITE_MERCHANT_URL?: string;
  readonly VITE_RELAY_URL?: string;
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

/** Whose desk this is: the page's ?merchant=, the hosted build's address, or the merchant's own service. */
export async function resolveMerchant(query: string | null): Promise<string | null> {
  const wanted = query?.trim() || CONFIGURED_MERCHANT;
  if (/^0x[0-9a-fA-F]{40}$/.test(wanted)) return wanted;
  return probeMerchantService();
}

/**
 * The merchant's own service: the one place a refund can be signed, because the merchant's key
 * lives there and nowhere else. Answers the address it signs for, or null when this console cannot
 * reach it (a hosted console never can).
 */
export async function probeMerchantService(): Promise<string | null> {
  try {
    const response = await fetch(`${MERCHANT_URL}/me`);
    if (!response.ok) return null;
    const me = (await response.json()) as { address?: unknown };
    return typeof me.address === "string" && /^0x[0-9a-fA-F]{40}$/.test(me.address) ? me.address : null;
  } catch {
    return null;
  }
}

/** The hub this console reads: the shared choice (?hub=, VITE_HUB_URL), else this server's /hub. */
export function deskHub(): string {
  return hubBase() ?? "/hub";
}

/**
 * The sample ledger is shown only when ?hub=off is chosen: in this URL, or remembered from an
 * earlier one by the shared resolver (lib/hub.ts keeps "off" until ?hub=default). Anything else,
 * including no choice at all, reads live.
 */
export function hubOff(query: URLSearchParams): boolean {
  if (query.get("hub") === "off") return true;
  if (hubBase() !== null) return false;
  try {
    return window.localStorage.getItem("countersign.hub") === "off";
  } catch {
    return false;
  }
}

/** Where the desk's orders came from, said on the page so nobody mistakes one source for another. */
export type OrdersSource =
  | { kind: "hub"; base: string }
  /** The hub could not give orders (`why`), so the Whitechain relay's own live records were read. */
  | { kind: "relay"; base: string; why: "not_served" | "down" };

export const NOT_SERVED = "This hub does not serve merchant orders yet.";
export const HUB_DOWN = "The hub did not answer.";

/** A hub without the route answers 404; a hub that is away answers nothing, or its gateway does. */
function hubCannotSay(status: number): "not_served" | "down" | null {
  if (status === 404) return "not_served";
  if (status === 0 || status === 502 || status === 503 || status === 504) return "down";
  return null;
}

async function getJson(url: string): Promise<{ status: number; body: unknown }> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { accept: "application/json" } });
  } catch {
    return { status: 0, body: null };
  }
  const body: unknown = await response.json().catch(() => null);
  return { status: response.status, body };
}

function listOf(body: unknown): Order[] {
  const raw = (body as { orders?: unknown } | null)?.orders;
  return Array.isArray(raw) ? raw.map(fromHubOrder).filter((order): order is Order => order !== null) : [];
}

/**
 * The seller's orders from the chosen hub. A hub that predates /orders answers 404; then the
 * Whitechain relay's own records are the next live source, and the page says which one it read.
 * Never fixtures.
 */
export async function fetchOrders(merchant: string): Promise<{ orders: Order[]; source: OrdersSource }> {
  const hub = deskHub();
  const seller = encodeURIComponent(merchant);
  const fromHub = await getJson(`${hub}/orders?seller=${seller}&limit=200`);
  if (fromHub.status === 200) return { orders: listOf(fromHub.body), source: { kind: "hub", base: hub } };
  const why = hubCannotSay(fromHub.status);
  if (why) {
    const fromRelay = await getJson(`${RELAY_URL}/orders?merchant=${seller}`);
    if (fromRelay.status === 200) {
      return { orders: listOf(fromRelay.body), source: { kind: "relay", base: RELAY_URL, why } };
    }
    throw new Error(why === "down" ? HUB_DOWN : NOT_SERVED);
  }
  throw new Error(`The hub answered ${fromHub.status}.`);
}

/** One order with its refunds: the receipt anyone can check. Null when no such order exists. */
export async function fetchOrder(id: string): Promise<ReceiptOrder | null> {
  const hub = deskHub();
  const key = encodeURIComponent(id);
  const fromHub = await getJson(`${hub}/orders/${key}`);
  if (fromHub.status === 200) return fromHubRecord(fromHub.body);
  const code = (fromHub.body as { code?: unknown } | null)?.code;
  if (fromHub.status === 404 && code === "not_found") return null;
  const why = hubCannotSay(fromHub.status);
  if (why) {
    const fromRelay = await getJson(`${RELAY_URL}/orders/${key}`);
    if (fromRelay.status === 200) return fromHubRecord(fromRelay.body);
    if (fromRelay.status === 404) return null;
    throw new Error(why === "down" ? HUB_DOWN : NOT_SERVED);
  }
  throw new Error(`The hub answered ${fromHub.status}.`);
}

/** The Whitechain relayer's gas, read from the relay when this console can reach it. */
export async function fetchRelayStatus(): Promise<RelayStatus> {
  const response = await relayGet("/status");
  if (!response.ok) throw new Error(`The relay answered ${response.status}.`);
  return readJson(response, "relay");
}

export interface RefundRequest {
  /** Atomic USDT. Leave it out to send back everything that is left. */
  amount?: bigint;
}

export async function refundOrder(id: string, request: RefundRequest = {}): Promise<RefundResult> {
  const body: { amount?: string } = {};
  if (request.amount !== undefined) body.amount = request.amount.toString();
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
export function fetchOfferTitle(offerHash: string, base = deskHub()): Promise<string | null> {
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
