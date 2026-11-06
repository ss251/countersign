import type { Hex } from "viem";
import { explorerUrl, type Network, type Offer, type Rail, type RailId } from "./deps.ts";
import type { IdentityLookup } from "./identity.ts";
import type { JobRecord, StoredOffer, Store } from "./store.ts";
import { isRecord } from "./util.ts";

export interface FrontdoorDeps {
  store: Store;
  rails: Rail[];
  isOnline(offerHash: string): boolean;
  identity?: IdentityLookup;
}

export interface SearchParams {
  q?: string | undefined;
  limit?: string | undefined;
  rail?: string | undefined;
  maxPrice?: string | undefined;
}

export interface SearchHit {
  offerHash: Hex;
  offer: Offer;
  online: boolean;
  score: number;
  why: string[];
}

export interface SearchResponse {
  query: string;
  results: SearchHit[];
}

export interface SellerOffer {
  offerHash: Hex;
  title: string;
  price: string;
  rails: RailId[];
  online: boolean;
}

export interface SellerErc8004 {
  agentId: string;
  identityRegistry: string;
  reputation: null;
}

export interface SellerSummary {
  address: string;
  name: null;
  payees: Record<string, string>;
  offers: SellerOffer[];
  calls: number;
  released: number;
  settled: number;
  refunded: number;
  failed: number;
  volume: string;
  erc8004: SellerErc8004 | null;
}

export interface SellersResponse {
  sellers: SellerSummary[];
}

export interface SettlementParams {
  limit?: string | undefined;
}

export type SettlementKind = "released" | "settled" | "refunded";

export interface SettlementEntry {
  jobId: Hex;
  offerHash: Hex;
  title: string;
  seller: string;
  buyer: string;
  amount: string;
  asset: string;
  rail: RailId;
  network: Network;
  kind: SettlementKind;
  tx: string;
  explorer: string | null;
  slipHash: Hex | null;
  at: number;
}

export interface SettlementsResponse {
  settlements: SettlementEntry[];
}

interface Group {
  address: string;
  offers: StoredOffer[];
}

interface SellerStats {
  calls: number;
  released: number;
  settled: number;
  refunded: number;
  failed: number;
  volume: bigint;
}

const MAX_SEARCH_LIMIT = 50;
const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SETTLEMENT_LIMIT = 100;
const DEFAULT_SETTLEMENT_LIMIT = 20;

export function searchOffers(deps: FrontdoorDeps, params: SearchParams): SearchResponse {
  const query = (params.q ?? "").trim();
  const tokens = tokenise(query);
  if (tokens.length === 0) return { query: "", results: [] };

  const limit = intParam(params.limit, DEFAULT_SEARCH_LIMIT, 1, MAX_SEARCH_LIMIT);
  const rail = (params.rail ?? "").trim();
  const maxPrice = (params.maxPrice ?? "").trim();
  const hits: Array<{ stored: StoredOffer; hit: SearchHit }> = [];

  for (const stored of deps.store.listOffers()) {
    const offer = stored.offer;
    if (rail !== "" && !offer.rails.some((id) => id === rail)) continue;
    if (/^\d+$/.test(maxPrice) && atomic(offer.price) > BigInt(maxPrice)) continue;

    const online = deps.isOnline(stored.offerHash);
    const { score, why } = scoreOffer(offer, tokens, online);
    if (score === 0) continue;
    hits.push({
      stored,
      hit: { offerHash: stored.offerHash, offer, online, score, why },
    });
  }

  hits.sort((a, b) => {
    if (b.hit.score !== a.hit.score) return b.hit.score - a.hit.score;
    const priceOrder = compareAtomic(a.hit.offer.price, b.hit.offer.price);
    if (priceOrder !== 0) return priceOrder;
    if (b.hit.offer.issuedAt !== a.hit.offer.issuedAt) {
      return b.hit.offer.issuedAt - a.hit.offer.issuedAt;
    }
    if (b.stored.publishedAt !== a.stored.publishedAt) {
      return b.stored.publishedAt - a.stored.publishedAt;
    }
    return a.hit.offerHash.localeCompare(b.hit.offerHash);
  });

  return { query, results: hits.slice(0, limit).map((entry) => entry.hit) };
}

export async function listSellers(deps: FrontdoorDeps): Promise<SellersResponse> {
  const groups = new Map<string, Group>();
  const sellerForOffer = new Map<string, string>();

  for (const stored of deps.store.listOffers()) {
    const key = stored.offer.seller.toLowerCase();
    sellerForOffer.set(stored.offerHash, key);
    const group = groups.get(key);
    if (group) group.offers.push(stored);
    else groups.set(key, { address: stored.offer.seller, offers: [stored] });
  }

  const stats = new Map<string, SellerStats>();
  for (const key of groups.keys()) {
    stats.set(key, { calls: 0, released: 0, settled: 0, refunded: 0, failed: 0, volume: 0n });
  }

  for (const job of deps.store.listJobs()) {
    const key = sellerForOffer.get(job.offerHash);
    if (key === undefined) continue;
    const stat = stats.get(key);
    if (!stat) continue;

    stat.calls += 1;
    if (job.status === "released" || job.status === "settled") {
      if (job.slipHash !== null && deps.store.getSlip(job.slipHash) !== null) {
        if (job.status === "released") stat.released += 1;
        else stat.settled += 1;
        stat.volume += atomic(job.amount);
      }
    } else if (job.status === "refunded") {
      stat.refunded += 1;
    } else if (job.status === "failed") {
      stat.failed += 1;
    }
  }

  const sellers = await Promise.all(
    Array.from(groups, async ([key, group]) => {
      const stat = stats.get(key) ?? {
        calls: 0,
        released: 0,
        settled: 0,
        refunded: 0,
        failed: 0,
        volume: 0n,
      };
      return {
        address: group.address,
        name: null,
        payees: payeesOf(group.offers),
        offers: group.offers.map((stored) => ({
          offerHash: stored.offerHash,
          title: stored.offer.title,
          price: stored.offer.price,
          rails: stored.offer.rails,
          online: deps.isOnline(stored.offerHash),
        })),
        calls: stat.calls,
        released: stat.released,
        settled: stat.settled,
        refunded: stat.refunded,
        failed: stat.failed,
        volume: stat.volume.toString(),
        erc8004: await identityFor(deps, group.address),
      } satisfies SellerSummary;
    }),
  );

  sellers.sort(
    (a, b) =>
      b.released - a.released ||
      b.offers.length - a.offers.length ||
      a.address.localeCompare(b.address),
  );
  return { sellers };
}

export function listSettlements(deps: FrontdoorDeps, params: SettlementParams): SettlementsResponse {
  const limit = intParam(params.limit, DEFAULT_SETTLEMENT_LIMIT, 1, MAX_SETTLEMENT_LIMIT);
  const settlements: SettlementEntry[] = [];

  for (const job of deps.store.listClosedJobs(limit)) {
    if (job.closeTx === null) continue;
    const kind = kindOf(job);
    if (kind === null) continue;

    const stored = deps.store.getOffer(job.offerHash);
    const rail = deps.rails.find((candidate) => candidate.declaration.id === job.rail);
    const slip =
      job.slipHash === null ? null : deps.store.getSlip(job.slipHash);

    settlements.push({
      jobId: job.jobId,
      offerHash: job.offerHash,
      title: stored?.offer.title ?? "",
      seller: stored?.offer.seller ?? "",
      buyer: job.buyer,
      amount: job.amount,
      asset: rail?.declaration.asset.address ?? job.payment.accepted.asset,
      rail: job.rail,
      network: rail?.declaration.network ?? job.payment.accepted.network,
      kind,
      tx: job.closeTx,
      explorer: explorerFor(rail, slip, job.closeTx),
      slipHash: kind === "refunded" ? null : job.slipHash,
      at: job.closedAt ?? job.createdAt,
    });
  }

  return { settlements };
}

function scoreOffer(
  offer: Offer,
  tokens: string[],
  online: boolean,
): { score: number; why: string[] } {
  const title = offer.title.toLowerCase();
  const summary = offer.summary.toLowerCase();
  const adapter = offer.adapter.toLowerCase();
  const upstream = offer.upstream?.url.toLowerCase() ?? "";
  const inputs = propertyNames(offer.input);
  const outputs = propertyNames(offer.output);
  const seen = new Set<string>();
  const why: string[] = [];
  let score = 0;

  const add = (points: number, sentence: string): void => {
    score += points;
    if (seen.has(sentence)) return;
    seen.add(sentence);
    why.push(sentence);
  };

  for (const token of tokens) {
    if (title.includes(token)) add(3, `title has "${token}"`);
    if (summary.includes(token)) add(1, `summary has "${token}"`);
    if (adapter.includes(token)) add(2, `served by ${article(offer.adapter)}`);
    if (upstream.includes(token)) add(1, `upstream has "${token}"`);
    if (inputs.some((name) => name.toLowerCase().includes(token))) add(2, `takes "${token}"`);
    if (outputs.some((name) => name.toLowerCase().includes(token))) add(2, `returns "${token}"`);
  }
  if (online) add(1, "seller is online");

  return { score, why };
}

function tokenise(query: string): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const token of query.toLowerCase().split(/[^a-z0-9]+/)) {
    if (token.length < 2 || seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
  }
  return tokens;
}

function propertyNames(schema: { [key: string]: unknown }): string[] {
  const properties = schema.properties;
  if (!isRecord(properties)) return [];
  return Object.keys(properties);
}

function article(adapter: string): string {
  return adapter === "skill" ? "a skill" : `an ${adapter}`;
}

function payeesOf(offers: StoredOffer[]): Record<string, string> {
  const payees: Record<string, string> = {};
  for (const stored of offers) {
    for (const [rail, payee] of Object.entries(stored.offer.payTo ?? {})) {
      if (typeof payee === "string") payees[rail] = payee;
    }
  }
  return payees;
}

async function identityFor(
  deps: FrontdoorDeps,
  seller: string,
): Promise<SellerErc8004 | null> {
  if (!deps.identity) return null;
  try {
    const found = await deps.identity(seller);
    if (found === null) return null;
    return {
      agentId: found.agentId,
      identityRegistry: found.identityRegistry,
      reputation: null,
    };
  } catch {
    return null;
  }
}

function kindOf(job: JobRecord): SettlementKind | null {
  if (job.status === "released" || job.status === "settled" || job.status === "refunded") {
    return job.status;
  }
  return null;
}

function explorerFor(
  rail: Rail | undefined,
  slip: { settlement: { url?: string } } | null,
  tx: string,
): string | null {
  if (slip !== null) return slip.settlement.url ?? null;
  if (!rail || rail.declaration.explorerTx === "") return null;
  return explorerUrl(rail.declaration, tx);
}

function compareAtomic(a: string, b: string): number {
  const left = atomic(a);
  const right = atomic(b);
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function atomic(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function intParam(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
