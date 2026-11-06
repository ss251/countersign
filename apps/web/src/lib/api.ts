import { useCallback, useEffect, useRef, useState } from "react";
import * as fx from "../fixtures/index.ts";
import { explorerTemplate, shortHex, symbolFor } from "./format.ts";
import { HubError, hubBase, hubGet, hubOffer, hubOffers, hubRails, hubSlip, type HubListing } from "./hub.ts";
import type {
  Approval,
  EnvelopeView,
  Listing,
  Purchase,
  RailDeclaration,
  SearchResult,
  SellerRecord,
  Settlement,
  Slip,
  SlipView,
  TreeView,
} from "./types.ts";

/**
 * Every read the screens make goes through here. With a hub chosen (see hub.ts) the
 * answer is live and its failures surface as errors. With none, or for reads the hub
 * does not serve yet, the answer comes from src/fixtures and says so
 * (source: "fixtures"), so a screen never passes stand-in numbers off as live ones.
 */

export type Source = "hub" | "fixtures";

export interface Loaded<T> {
  data: T;
  source: Source;
}

/** Fixtures answer at once: no artificial latency, so a recording never waits on a placeholder. */
const settle = <T,>(data: T): Promise<Loaded<T>> => Promise.resolve({ data, source: "fixtures" });

const live = <T,>(data: T): Loaded<T> => ({ data, source: "hub" });

function fixtureSettlements(limit: number): Settlement[] {
  return fx.purchases
    .filter((p) => p.status === "released" || p.status === "refunded")
    .slice(0, limit)
    .map((p) => {
      const slip = p.slipHash ? fx.slipByHash(p.slipHash) : undefined;
      return {
        jobId: p.jobId,
        offerHash: p.offerHash,
        title: p.title,
        seller: p.seller.address,
        amount: p.amount,
        rail: p.rail,
        network: fx.rails[p.rail].network,
        kind: p.status === "released" ? "released" : "refunded",
        tx: slip?.slip.settlement.transaction ?? "",
        explorer: undefined,
        slipHash: p.slipHash,
        at: p.at,
      } satisfies Settlement;
    });
}

/** undefined for a 404, so "no such thing" and "hub down" stay different. */
async function orMissing<T>(p: Promise<T>): Promise<T | undefined> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof HubError && e.status === 404) return undefined;
    throw e;
  }
}

function toListing(l: HubListing): Listing {
  return { hash: l.offerHash, offer: l.offer, seller: { name: shortHex(l.offer.seller), named: false }, status: l.status, online: l.online };
}

/** What a slip itself says about its rail, for a hub that does not declare it. */
function declarationFromSlip(slip: Slip): RailDeclaration {
  const { body } = slip;
  return {
    id: body.rail,
    network: body.network,
    scheme: slip.payment.accepted.scheme,
    asset: { network: body.network, address: body.asset, symbol: symbolFor(body.rail), decimals: 6 },
    kind: body.escrow ? "escrow" : "direct",
    escrow: body.escrow,
    gasPaidBy: "hub",
    finality: "Not declared by this hub.",
    explorerTx: explorerTemplate(body.network),
  };
}

async function slipView(hash: string): Promise<SlipView | undefined> {
  const slip = await orMissing(hubSlip(hash));
  if (!slip) return undefined;
  const [listing, rails] = await Promise.all([
    hubOffer(slip.body.offerHash).catch(() => undefined),
    hubRails().catch(() => [] as RailDeclaration[]),
  ]);
  return {
    slip,
    title: listing?.offer.title ?? `offer ${shortHex(slip.body.offerHash)}`,
    sellerName: shortHex(slip.body.seller),
    declaration: rails.find((r) => r.id === slip.body.rail) ?? declarationFromSlip(slip),
  };
}

async function treeView(root: string): Promise<TreeView> {
  const nodes: TreeView["nodes"] = {};
  const visit = async (hash: string, depth: number): Promise<void> => {
    if (depth > 8 || nodes[hash]) return;
    const v = await slipView(hash);
    if (!v) return;
    nodes[hash] = { slip: v.slip, title: v.title, sellerName: v.sellerName };
    await Promise.all(v.slip.body.children.map((c) => visit(c, depth + 1)));
  };
  await visit(root, 0);
  return { root: root as TreeView["root"], nodes };
}

export const api = {
  listings: async (): Promise<Loaded<Listing[]>> =>
    hubBase() ? live((await hubOffers()).map(toListing)) : settle(fx.listings),
  listing: async (hash: string): Promise<Loaded<Listing | undefined>> => {
    if (!hubBase()) return settle(fx.listingByHash(hash) ?? fx.listingByTitle(hash));
    const l = await orMissing(hubOffer(hash));
    return live(l ? toListing(l) : undefined);
  },
  rails: async (): Promise<Loaded<RailDeclaration[]>> => (hubBase() ? live(await hubRails()) : settle(Object.values(fx.rails))),
  slip: async (hash: string): Promise<Loaded<SlipView | undefined>> => (hubBase() ? live(await slipView(hash)) : settle(fx.slipByHash(hash))),
  tree: async (root: string): Promise<Loaded<TreeView>> => (hubBase() ? live(await treeView(root)) : settle(fx.tree)),
  /**
   * Recent releases and refunds, newest first. null means the hub does not serve them yet,
   * which the overview says plainly instead of inventing rows.
   */
  settlements: async (limit = 6): Promise<Loaded<Settlement[] | null>> => {
    if (!hubBase()) return settle(fixtureSettlements(limit));
    const rows = await orMissing(hubGet<{ settlements: Settlement[] } | Settlement[]>(`/settlements?limit=${limit}`));
    if (!rows) return live(null);
    return live(Array.isArray(rows) ? rows : rows.settlements);
  },
  /** The hub's sellers with slip-derived counts and identity; null until the hub serves /sellers. */
  sellers: async (): Promise<Loaded<SellerRecord[] | null>> => {
    if (!hubBase()) return settle(null);
    const r = await orMissing(hubGet<{ sellers: SellerRecord[] }>("/sellers"));
    return live(r ? r.sellers : null);
  },
  /** The hub's ranked offer search; null until the hub serves it, so the caller ranks /offers itself. */
  search: async (q: string, limit = 5): Promise<Loaded<SearchResult[] | null>> => {
    if (!hubBase()) return settle(null);
    const r = await orMissing(hubGet<{ results: SearchResult[] }>(`/offers/search?q=${encodeURIComponent(q)}&limit=${limit}`));
    return live(r ? r.results : null);
  },
  // The phone reads the buyer agent's own state, which no hub endpoint serves yet.
  envelope: () => settle<EnvelopeView>(structuredClone(fx.envelope)),
  approvals: () => settle<Approval[]>(fx.approvals),
  purchases: () => settle<Purchase[]>(fx.purchases),
};

/* A job as the phone sees it after the hold. */

export type JobStep = "countersigned" | "funding" | "held" | "delivered" | "released" | "refused" | "refunded";

export interface JobView {
  step: JobStep;
  /** Unix seconds each step was reached. */
  times: Partial<Record<JobStep, number>>;
  fundTx?: string;
  slipHash?: string;
  /** For a refusal: the atomic amount the settlement tried to move. */
  asked?: string;
  /** Unix seconds. */
  deadline?: number;
}

export type Scenario = "release" | "moved" | "deadline";

/**
 * Plays a job forward with fixture timings. The hub replaces this with the job's
 * real events; the screens only ever see JobView.
 */
export function playJob(approval: Approval, scenario: Scenario, onChange: (job: JobView) => void): () => void {
  const timers: number[] = [];
  const now = () => Math.floor(Date.now() / 1000);
  let job: JobView = { step: "countersigned", times: { countersigned: now() } };
  const push = (patch: Partial<JobView>, step: JobStep) => {
    job = { ...job, ...patch, step, times: { ...job.times, [step]: now() } };
    onChange(job);
  };
  onChange(job);
  const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));
  const deadline = now() + approval.listing.offer.deadline;

  if (scenario === "moved") {
    const asked = ((BigInt(approval.amount) * 6n) / 5n).toString();
    at(700, () => push({}, "funding"));
    at(1900, () => push({ asked }, "refused"));
  } else {
    at(700, () => push({}, "funding"));
    at(1700, () => push({ fundTx: fx.fakeHex(`fund:${approval.id}`), deadline }, "held"));
    if (scenario === "release") {
      at(3300, () => push({}, "delivered"));
      at(4300, () => push({ slipHash: fx.demoSlipHash }, "released"));
    } else {
      at(4300, () => push({}, "refunded"));
    }
  }
  return () => timers.forEach((t) => window.clearTimeout(t));
}

/* Loading state for one read. */

export interface Resource<T> {
  data: T | undefined;
  source: Source | undefined;
  error: Error | undefined;
  loading: boolean;
  reload: () => void;
  set: (next: T) => void;
}

export function useResource<T>(load: () => Promise<Loaded<T>>, deps: unknown[]): Resource<T> {
  const [state, setState] = useState<{ data?: T; source?: Source; error?: Error; loading: boolean }>({ loading: true });
  const [nonce, setNonce] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    loadRef.current().then(
      (r) => live && setState({ data: r.data, source: r.source, loading: false }),
      (e: unknown) => live && setState({ loading: false, error: e instanceof Error ? e : new Error(String(e)) }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const set = useCallback((next: T) => setState((s) => ({ ...s, data: next })), []);
  return { ...state, data: state.data, source: state.source, error: state.error, loading: state.loading, reload, set };
}
