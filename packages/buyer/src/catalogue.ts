/**
 * Reading an x402 Bazaar catalogue: Circle's public one, a countersign hub's, or any other
 * that answers in the same shape. Everything here is untrusted listing data. A listing
 * never authorises a payment: `buy` re-reads the offer from its hub and checks its hash,
 * and only a rail pinned in `known-rails.ts` is ever signed for.
 */

import type { Hex } from "viem";
import type { PaymentRequirements } from "@countersign/core";
import { knownGatewayFor, knownRailFor, type KnownGateway, type KnownRail } from "./known-rails.ts";

/** Circle's public x402 catalogue. It needs no key. */
export const CIRCLE_CATALOGUE = "https://api.circle.com/v2/x402/discovery/resources";

export interface CatalogueItem {
  resource: string;
  type: string;
  accepts: PaymentRequirements[];
  metadata: {
    provider?: { name?: string; category?: string };
    description?: string;
    method?: string;
    /** Present on a countersign hub's items. */
    offerHash?: string;
  };
}

export interface CataloguePage {
  items: CatalogueItem[];
  total: number;
}

export interface CatalogueQuery {
  query?: string;
  category?: string;
  limit?: number;
  offset?: number;
}

type FetchLike = (url: string) => Promise<Response>;

export async function readCatalogue(
  url: string,
  q: CatalogueQuery = {},
  fetchImpl: FetchLike = (u) => fetch(u, { signal: AbortSignal.timeout(15_000) }),
): Promise<CataloguePage> {
  const params = new URLSearchParams();
  if (q.query) params.set("query", q.query);
  if (q.category) params.set("category", q.category);
  if (q.limit !== undefined) params.set("limit", String(q.limit));
  if (q.offset !== undefined) params.set("offset", String(q.offset));
  params.set("siwx", "false");
  const res = await fetchImpl(`${url}?${params.toString()}`);
  if (!res.ok) throw new Error(`Refused. The catalogue answered HTTP ${res.status}.`);
  return parseCatalogue(await res.json());
}

/** Circle's flat `{x402Version, items, pagination}`, or the `data`-wrapped form older hubs served. */
export function parseCatalogue(body: unknown): CataloguePage {
  const root = isRecord(body) && isRecord(body.data) ? body.data : body;
  if (!isRecord(root) || !Array.isArray(root.items)) {
    throw new Error("Refused. That is not an x402 catalogue.");
  }
  const items = root.items.filter(isItem);
  const pagination = isRecord(root.pagination) ? root.pagination : {};
  const total = typeof pagination.total === "number" ? pagination.total : items.length;
  return { items, total };
}

export type PayableVia =
  | { kind: "escrow"; req: PaymentRequirements; rail: KnownRail }
  | { kind: "gateway"; req: PaymentRequirements; gateway: KnownGateway };

/** The first of the item's options this agent would sign for, or undefined. */
export function payableVia(item: CatalogueItem, known: KnownRail[]): PayableVia | undefined {
  for (const req of item.accepts) {
    if (req.scheme === "countersign") {
      const rail = knownRailFor(req, known);
      if (rail) return { kind: "escrow", req, rail };
    }
    const gateway = knownGatewayFor(req);
    if (gateway) return { kind: "gateway", req, gateway };
  }
  return undefined;
}

/** A countersign hub's call URL split into the hub and the offer hash, or undefined. */
export function hubCallOf(resource: string): { hub: string; offerHash: Hex } | undefined {
  const match = /^(https?:\/\/.+?)\/offers\/(0x[0-9a-fA-F]{64})\/call\/?$/.exec(resource.trim());
  if (!match) return undefined;
  return { hub: match[1] as string, offerHash: match[2] as Hex };
}

function isItem(value: unknown): value is CatalogueItem {
  if (!isRecord(value) || typeof value.resource !== "string" || !Array.isArray(value.accepts)) {
    return false;
  }
  if (value.metadata !== undefined && !isRecord(value.metadata)) return false;
  if (value.metadata === undefined) value.metadata = {};
  return value.accepts.every(
    (a) =>
      isRecord(a) &&
      typeof a.scheme === "string" &&
      typeof a.network === "string" &&
      typeof a.amount === "string" &&
      typeof a.asset === "string" &&
      typeof a.payTo === "string",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
