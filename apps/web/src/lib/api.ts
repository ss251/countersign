import { useCallback, useEffect, useRef, useState } from "react";
import type { ApprovalRequest } from "@countersign/core";
import { ESCROW_RAILS, explorerTemplate, nowUnix, shortHex, symbolFor } from "./format.ts";
import {
  approvalToken,
  chosenAgent,
  HubError,
  hubBase,
  hubGet,
  hubOffer,
  hubOffers,
  hubPost,
  hubRails,
  hubSlip,
  type HubListing,
} from "./hub.ts";
import type {
  Approval,
  EnvelopeView,
  HubStats,
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
 * Every read the screens make goes through here, and the answer always says where it came from.
 * "hub": live. "absent": the hub does not serve this read, or holds nothing for it yet, with the
 * sentence a person reads and a retry; never a stand-in in its place. "fixtures": only with
 * ?hub=off, loaded on demand, so the default bundle carries no stand-in values at all.
 */

export type Source = "hub" | "fixtures" | "absent";

export interface Loaded<T> {
  data: T;
  source: Source;
  /** For "absent": what is missing, in a sentence. */
  reason?: string;
  /** For "absent": the hub holds this behind the approval token, which this device does not have. */
  needsToken?: boolean;
}

type Fixtures = typeof import("../fixtures/index.ts");
let fixtureModule: Promise<Fixtures> | null = null;
/** The stand-in catalogue, fetched only when someone asks for it with ?hub=off. */
const fixtures = (): Promise<Fixtures> => (fixtureModule ??= import("../fixtures/index.ts"));

const settle = <T,>(data: T): Loaded<T> => ({ data, source: "fixtures" });

const live = <T,>(data: T): Loaded<T> => ({ data, source: "hub" });

const absent = <T,>(reason: string, needsToken = false): Loaded<T | null> => ({ data: null, source: "absent", reason, needsToken });

/** The honest sentence for a read the hub could not give, by what was asked for and why it failed. */
function absence<T>(e: unknown, what: string, missing: string): Loaded<T | null> {
  if (e instanceof HubError) {
    if (e.status === 404 && e.code === "unknown-agent") return absent(missing);
    if (e.status === 404) return absent(`This hub does not serve ${what} yet.`);
    if (e.status === 401) return absent(`This hub shows ${what} only with the approval token.`, true);
    if (e.status === 503) return absent(`This hub has no approver set, so it keeps ${what} private.`);
    if (e.status === 0) return absent(`The hub did not answer, so ${what} cannot be read right now.`);
  }
  return absent(`The hub could not give ${what} right now.`);
}

/** The approval token, for the reads the hub keeps behind it. Sent only to this hub. */
function tokenHeader(): Record<string, string> {
  const token = approvalToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

function fixtureSettlements(fx: Fixtures, limit: number): Settlement[] {
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

interface HubTree {
  root: TreeView["root"];
  nodes: Record<string, { slip: Slip; title: string; seller: string }>;
}

/** The hub's receipt tree. The slip view asks for this only when a slip names children. */
async function treeView(root: string): Promise<TreeView> {
  const tree = await hubGet<HubTree>(`/trees/${encodeURIComponent(root)}`);
  const nodes: TreeView["nodes"] = {};
  for (const [hash, node] of Object.entries(tree.nodes)) {
    nodes[hash] = { slip: node.slip, title: node.title, sellerName: shortHex(node.seller) };
  }
  return { root: tree.root, nodes };
}

export const api = {
  listings: async (): Promise<Loaded<Listing[]>> =>
    hubBase() ? live((await hubOffers()).map(toListing)) : settle((await fixtures()).listings),
  listing: async (hash: string): Promise<Loaded<Listing | undefined>> => {
    if (!hubBase()) {
      const fx = await fixtures();
      return settle(fx.listingByHash(hash) ?? fx.listingByTitle(hash));
    }
    const l = await orMissing(hubOffer(hash));
    return live(l ? toListing(l) : undefined);
  },
  rails: async (): Promise<Loaded<RailDeclaration[]>> =>
    hubBase() ? live(await hubRails()) : settle(Object.values((await fixtures()).rails)),
  slip: async (hash: string): Promise<Loaded<SlipView | undefined>> =>
    hubBase() ? live(await slipView(hash)) : settle((await fixtures()).slipByHash(hash)),
  tree: async (root: string): Promise<Loaded<TreeView | null>> => {
    if (!hubBase()) return absent("No hub is connected, so this receipt tree cannot be read.");
    try {
      return live(await treeView(root));
    } catch (e) {
      if (e instanceof HubError && e.status === 404) return { data: null, source: "hub" };
      return absence(e, "receipt trees", "This hub has no receipt tree for that slip.");
    }
  },
  /**
   * Recent releases and refunds, newest first. null means the hub does not serve them yet,
   * which the overview says plainly instead of inventing rows.
   */
  settlements: async (limit = 6): Promise<Loaded<Settlement[] | null>> => {
    if (!hubBase()) return settle(fixtureSettlements(await fixtures(), limit));
    const rows = await orMissing(hubGet<{ settlements: Settlement[] } | Settlement[]>(`/settlements?limit=${limit}`));
    if (!rows) return live(null);
    return live(Array.isArray(rows) ? rows : rows.settlements);
  },
  /** The hub's own totals. Never fixtures: without a hub there is nothing to count, and the landing says so. */
  stats: async (): Promise<Loaded<HubStats | null>> => {
    if (!hubBase()) return absent("No hub is connected, so there is nothing live to count. Open the page without ?hub=off.");
    try {
      return live(await hubGet<HubStats>("/stats"));
    } catch (e) {
      return absence(e, "totals", "This hub has no totals yet.");
    }
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
  /*
   * The phone: the agent's signed envelope mirror, its pending approvals and its jobs. Each falls
   * back to labelled fixtures until the hub serves it, so the phone always says which it shows.
   */
  envelope: async (): Promise<Loaded<EnvelopeView | null>> => {
    if (!hubBase()) return settle(structuredClone((await fixtures()).envelope));
    const agent = await resolveAgent();
    if (!agent) return absent("No agent has bought through this hub yet, so there is no envelope to show.");
    try {
      const m = await hubGet<EnvelopeMirror>(`/envelopes/${agent}`, 5000, tokenHeader());
      return live({
        envelope: m.envelope,
        spent: m.spent,
        agentName: shortHex(agent),
        // No askAbove in the agent's envelope means it never asks: every call inside the limits goes through.
        askAbove: m.envelope.askAbove ?? null,
        names: {},
        mirror: { signedAt: toUnix(m.signedAt), agent },
      });
    } catch (e) {
      return absence(e, "envelopes", "Your agent has not published its signed envelope to this hub yet.");
    }
  },
  approvals: async (): Promise<Loaded<Approval[] | null>> => {
    if (!hubBase()) return settle((await fixtures()).approvals);
    const agent = await resolveAgent();
    if (!agent) return absent("No agent has bought through this hub yet, so nothing can be waiting for you.");
    let r: { approvals: HubApproval[] };
    try {
      r = await hubGet<{ approvals: HubApproval[] }>(`/approvals?agent=${agent}&status=pending`, 5000, tokenHeader());
    } catch (e) {
      return absence(e, "approvals", "This hub holds no approvals for your agent.");
    }
    const pending = r.approvals.filter((a) => a.status === "pending");
    const found = await Promise.all(pending.map((a) => offerOnce(a.offerHash)));
    return live(
      pending.flatMap((a, i): Approval[] => {
        const l = found[i];
        // Without the offer the phone cannot show what would be signed, so it does not offer the hold.
        if (!l) return [];
        return [
          {
            id: a.id,
            agent: a.agent,
            agentName: shortHex(a.agent),
            listing: toListing(l),
            amount: a.amount,
            rail: a.rail,
            discoveredVia: "registry",
            requestedAt: toUnix(a.requestedAt ?? a.createdAt ?? nowUnix()),
            signing: { offerHash: a.offerHash, terms: a.terms, request: a.request ?? null, requestSig: a.requestSig ?? null },
          },
        ];
      }),
    );
  },
  purchases: async (): Promise<Loaded<Purchase[] | null>> => {
    if (!hubBase()) return settle((await fixtures()).purchases);
    const agent = await resolveAgent();
    if (!agent) return absent("No agent has bought through this hub yet.");
    let r: { jobs: HubBuyerJob[] };
    try {
      r = await hubGet<{ jobs: HubBuyerJob[] }>(`/jobs?buyer=${agent}&limit=50`);
    } catch (e) {
      return absence(e, "an agent’s purchases", "This hub has no purchases for your agent.");
    }
    const [listings, decided] = await Promise.all([
      hubOffers().catch(() => [] as HubListing[]),
      hubGet<{ approvals: HubApproval[] }>(`/approvals?agent=${agent}&status=decided`, 5000, tokenHeader()).then(
        (d) => d.approvals,
        () => [] as HubApproval[],
      ),
    ]);
    return live(r.jobs.map((j) => toPurchase(j, listings, decided)));
  },
  /** One seller's sales, newest first, for the seller's desk. */
  sales: async (seller: string | undefined): Promise<Loaded<Purchase[] | null>> => {
    if (!hubBase()) {
      const fx = await fixtures();
      return settle(fx.purchases.filter((p) => !seller || p.seller.address.toLowerCase() === seller.toLowerCase()));
    }
    if (!seller) return absent("This hub has no sellers yet.");
    let r: { jobs: HubBuyerJob[] };
    try {
      r = await hubGet<{ jobs: HubBuyerJob[] }>(`/jobs?seller=${seller}&limit=50`);
    } catch (e) {
      return absence(e, "a seller’s sales", "This hub has no sales for this seller.");
    }
    const listings = await hubOffers().catch(() => [] as HubListing[]);
    return live(r.jobs.map((j) => toPurchase(j, listings, [])));
  },
  /**
   * The human's decision on a held call, signed on this phone as a version 2 decision: bound to the
   * agent's own request, checked against the agent's signature first. The token and the key stay on
   * this device; the token goes only to this hub, and the key goes nowhere.
   */
  decide: async (approval: Approval, decision: "countersign" | "decline"): Promise<void> => {
    const token = approvalToken();
    if (!token) throw new HubError(401, "This phone has no approval token yet.", "no-token");
    const { signDecision } = await import("./approver.ts");
    const { decidedAt, sig } = await signDecision(approval, decision);
    await hubPost(`/approvals/${approval.id}/decision`, { decision, decidedAt, sig }, { authorization: `Bearer ${token}` });
  },
  /** The agent's jobs right now, so a countersigned call is matched to the job it starts and not an older one. */
  jobIds: async (agent: string): Promise<Set<string>> => {
    const r = await orMissing(hubGet<{ jobs: HubBuyerJob[] }>(`/jobs?buyer=${agent}&limit=20`)).catch(() => undefined);
    return new Set((r?.jobs ?? []).map((j) => j.jobId));
  },
};

/* Wire shapes of the buyer plumbing. */

interface EnvelopeMirror {
  envelope: EnvelopeView["envelope"];
  spent: EnvelopeView["spent"];
  signedAt: number;
  sig: string;
  verified: boolean;
}

interface HubApproval {
  id: string;
  agent: string;
  offerHash: string;
  title: string;
  amount: string;
  rail: Purchase["rail"];
  status: "pending" | "countersign" | "decline" | "expired";
  requestedAt?: number;
  createdAt?: number;
  decidedAt?: number | null;
  /** The terms the agent asked under, and its signed request: what a version 2 decision binds to. */
  terms?: unknown;
  request?: ApprovalRequest | null;
  requestSig?: string | null;
}

interface HubBuyerJob {
  jobId: string;
  offerHash: string;
  title: string;
  amount: string;
  rail: Purchase["rail"];
  network: string;
  status: "funded" | "paid" | "released" | "settled" | "failed" | "refunded";
  at: number;
  settleTx: string | null;
  closeTx: string | null;
  slipHash: string | null;
  explorer: string | null;
}

/** The hub speaks unix seconds; milliseconds are tolerated so a unit slip never shows a date in the year 57000. */
const toUnix = (t: number) => (t > 1e12 ? Math.floor(t / 1000) : t);

let agentFound: string | null = null;

/** The agent to follow: the one chosen with ?agent=, otherwise the hub's most recent buyer. */
async function resolveAgent(): Promise<string | null> {
  if (!hubBase()) return null;
  const chosen = chosenAgent();
  if (chosen) return chosen;
  if (agentFound) return agentFound;
  const s = await orMissing(hubGet<{ settlements: Array<{ buyer?: string }> }>("/settlements?limit=1")).catch(() => undefined);
  agentFound = s?.settlements?.[0]?.buyer || null;
  return agentFound;
}

/** Offers are fixed by their hash (any change makes a new hash), so one read per page load is exact. */
const offerReads = new Map<string, Promise<HubListing | undefined>>();
function offerOnce(hash: string): Promise<HubListing | undefined> {
  const key = hash.toLowerCase();
  let read = offerReads.get(key);
  if (!read) {
    read = orMissing(hubOffer(hash)).catch(() => {
      offerReads.delete(key);
      return undefined;
    });
    offerReads.set(key, read);
  }
  return read;
}

/** What a failed delivery means for the buyer's money depends on whether the rail holds it in escrow. */
export function failedReason(rail: Purchase["rail"]): string {
  return ESCROW_RAILS.has(rail)
    ? "The output did not match the offer, so the money stays in escrow and returns to your agent at the deadline."
    : "The output did not match the offer. This rail settles before delivery, so the payment is not returned automatically; the slip records the failure.";
}

function toPurchase(j: HubBuyerJob, listings: HubListing[], decided: HubApproval[]): Purchase {
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const l = listings.find((x) => same(x.offerHash, j.offerHash));
  const at = toUnix(j.at);
  // A call the human countersigned follows a countersign decision on the same offer and amount.
  const you = decided.some(
    (a) =>
      a.status === "countersign" &&
      same(a.offerHash, j.offerHash) &&
      a.amount === j.amount &&
      Math.abs(at - toUnix(a.decidedAt ?? a.requestedAt ?? a.createdAt ?? 0)) < 900,
  );
  const status: Purchase["status"] =
    j.status === "funded" || j.status === "paid"
      ? "held"
      : j.status === "released" || j.status === "settled"
        ? "released"
        : j.status === "refunded"
          ? "refunded"
          : "refused";
  return {
    jobId: j.jobId as Purchase["jobId"],
    offerHash: j.offerHash as Purchase["offerHash"],
    title: j.title || l?.offer.title || "Untitled offer",
    adapter: l?.offer.adapter ?? "skill",
    seller: {
      name: l ? shortHex(l.offer.seller) : "Unlisted seller",
      address: (l?.offer.seller ?? "0x0000000000000000000000000000000000000000") as Purchase["seller"]["address"],
    },
    amount: j.amount,
    rail: j.rail,
    status,
    at,
    slipHash: (j.slipHash ?? undefined) as Purchase["slipHash"],
    approvedBy: you ? "you" : "envelope",
    reason:
      j.status === "failed" ? `Not released. ${failedReason(j.rail)}` : j.status === "refunded" ? "Refunded. The deadline passed." : undefined,
  };
}

/* A job as the phone sees it after the hold. */

export type JobStep = "countersigned" | "funding" | "held" | "delivered" | "released" | "refused" | "refunded" | "failed";

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
  /** For a failed delivery: what happens to the money, in a sentence. */
  reason?: string;
  /** No payment long after the countersignature: the agent may have stopped waiting. */
  slow?: boolean;
}

/** The steps a job passes in order; a poll that sees a later one fills in the times of those it skipped. */
const LINE: JobStep[] = ["countersigned", "funding", "held", "delivered", "released"];

/**
 * Follows a countersigned approval to the job it starts. The agent pays once it reads the
 * countersignature and the hub records the job under the agent's address, so this polls that list
 * until the job is final. Jobs in `known` existed before the decision and are never this one.
 */
export function followJob(approval: Approval, known: Set<string>, onChange: (job: JobView) => void): () => void {
  const started = Math.floor(Date.now() / 1000);
  let job: JobView = { step: "countersigned", times: { countersigned: started } };
  let timer = 0;
  let stopped = false;
  const now = () => Math.floor(Date.now() / 1000);
  const push = (patch: Partial<JobView>, step: JobStep) => {
    const times = { ...job.times };
    const upto = LINE.indexOf(step);
    for (const s of upto >= 0 ? LINE.slice(0, upto + 1) : [step]) times[s] ??= now();
    job = { ...job, ...patch, step, times };
    onChange(job);
  };
  const tick = async () => {
    const r = await orMissing(hubGet<{ jobs: HubBuyerJob[] }>(`/jobs?buyer=${approval.agent}&limit=20`)).catch(() => undefined);
    if (stopped) return;
    const j = r?.jobs.find((x) => !known.has(x.jobId) && x.offerHash.toLowerCase() === approval.listing.hash.toLowerCase());
    if (!j) {
      if (job.step === "countersigned") push({}, "funding");
      else if (!job.slow && now() - started > 90) {
        job = { ...job, slow: true };
        onChange(job);
      }
    } else if (j.status === "funded" || j.status === "paid") {
      if (job.step !== "held") push({ fundTx: j.settleTx ?? undefined }, "held");
    } else if (j.status === "released" || j.status === "settled") {
      push({ fundTx: j.settleTx ?? job.fundTx, slipHash: j.slipHash ?? undefined }, "released");
      return;
    } else if (j.status === "refunded") {
      push({}, "refunded");
      return;
    } else {
      push({ reason: failedReason(j.rail) }, "failed");
      return;
    }
    if (now() - started < 600) timer = window.setTimeout(tick, 2000);
  };
  onChange(job);
  void tick();
  return () => {
    stopped = true;
    window.clearTimeout(timer);
  };
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

  // Fixture approvals only exist under ?hub=off, so the catalogue is already loaded by now.
  const fx = fixtures();
  if (scenario === "moved") {
    const asked = ((BigInt(approval.amount) * 6n) / 5n).toString();
    at(700, () => push({}, "funding"));
    at(1900, () => push({ asked }, "refused"));
  } else {
    at(700, () => push({}, "funding"));
    at(1700, () => void fx.then((f) => push({ fundTx: f.fakeHex(`fund:${approval.id}`), deadline }, "held")));
    if (scenario === "release") {
      at(3300, () => push({}, "delivered"));
      at(4300, () => void fx.then((f) => push({ slipHash: f.demoSlipHash }, "released")));
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
  /** For "absent": what is missing, in a sentence a person reads. */
  reason: string | undefined;
  needsToken: boolean;
  error: Error | undefined;
  loading: boolean;
  reload: () => void;
  set: (next: T) => void;
}

export function useResource<T>(load: () => Promise<Loaded<T>>, deps: unknown[]): Resource<T> {
  const [state, setState] = useState<{ data?: T; source?: Source; reason?: string; needsToken?: boolean; error?: Error; loading: boolean }>({
    loading: true,
  });
  const [nonce, setNonce] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    loadRef.current().then(
      (r) => live && setState({ data: r.data, source: r.source, reason: r.reason, needsToken: r.needsToken, loading: false }),
      (e: unknown) => live && setState({ loading: false, error: e instanceof Error ? e : new Error(String(e)) }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const set = useCallback((next: T) => setState((s) => ({ ...s, data: next })), []);
  return {
    ...state,
    data: state.data,
    source: state.source,
    reason: state.reason,
    needsToken: state.needsToken ?? false,
    error: state.error,
    loading: state.loading,
    reload,
    set,
  };
}
