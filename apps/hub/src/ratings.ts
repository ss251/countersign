import type { Hex } from "viem";
import { slipHash, slipSigner, type RailId, type Slip } from "./deps.ts";
import type { RatingJob, Store } from "./store.ts";

/**
 * Ratings are derived from the hub's own ledger, never reported by anyone. See docs/ratings.md.
 *
 * A job counts as delivered only when the hub holds a slip for it that
 *  - hashes to its own body,
 *  - names this job, this offer, this buyer, this seller and this amount, and
 *  - carries a Release signature that recovers to the offer's seller.
 * A failed delivery or a refund counts against the seller only when the hub recorded the
 * failure as the seller's. A job still in flight counts for nothing yet. A job the seller
 * bought from itself counts for nothing at all.
 */

export interface RatingCounts {
  /** Closed with a slip that verifies. */
  delivered: number;
  /** The seller's runner refused the job, answered badly or ran past the offer's deadline; money not back yet. */
  failed: number;
  /** As `failed`, and the money has gone back to the buyer. */
  refunded: number;
  /** Failed or refunded, but not on the seller: the runner was gone, the link dropped, or the hub cut the job short. */
  excused: number;
  /** Paid or funded, not closed yet. */
  open: number;
  /** Closed as released or settled, but the stored slip is missing or does not verify. Not counted. */
  unverified: number;
  /** The buyer is the seller or the seller's payee. Not counted. */
  selfDealt: number;
}

export interface Rating extends RatingCounts {
  /** delivered + failed + refunded. */
  closed: number;
  /** delivered / closed, to four places. `null` until something has closed. */
  score: number | null;
  /** Distinct buyers behind the delivered jobs. */
  buyers: number;
  /**
   * Share of delivered jobs bought by the single busiest buyer, to four places. `null` with
   * nothing delivered. Close to 1 means one wallet carries the record: read it as a wash-trading flag.
   */
  topBuyerShare: number | null;
  /** Sum of delivered amounts, atomic units (6-decimal USD stablecoins), as a string. */
  volume: string;
  /** `deliveredAt` of the newest delivered slip, unix seconds. */
  lastDeliveredAt: number | null;
}

export interface SellerRating extends Rating {
  seller: string;
}

export interface SellerRatingDetail extends SellerRating {
  offers: Array<{ offerHash: Hex; title: string; listed: boolean } & Rating>;
}

export interface HubStats extends RatingCounts {
  offers: { listed: number; delisted: number };
  sellers: number;
  /** Distinct buyers behind delivered jobs. */
  buyers: number;
  /** Every job the hub has opened. */
  calls: number;
  closed: number;
  score: number | null;
  volume: string;
  byRail: Record<string, { calls: number; delivered: number; volume: string }>;
  runnersOnline: number;
  /** Unix seconds at which these numbers were computed; they may be up to the cache window old. */
  asOf: number;
}

export interface RatingsOptions {
  /** Unix seconds. */
  now: () => number;
  /** How long one computed snapshot serves every request. Default 5 seconds; 0 recomputes every time. */
  cacheSeconds?: number;
}

type Outcome = keyof RatingCounts;

interface Judged {
  job: RatingJob;
  outcome: Outcome;
  deliveredAt: number | null;
}

class Tally {
  readonly counts: RatingCounts = {
    delivered: 0,
    failed: 0,
    refunded: 0,
    excused: 0,
    open: 0,
    unverified: 0,
    selfDealt: 0,
  };
  private readonly byBuyer = new Map<string, number>();
  private volumeAtomic = 0n;
  private last: number | null = null;

  add(judged: Judged): void {
    this.counts[judged.outcome] += 1;
    if (judged.outcome !== "delivered") return;
    const buyer = judged.job.buyer.toLowerCase();
    this.byBuyer.set(buyer, (this.byBuyer.get(buyer) ?? 0) + 1);
    this.volumeAtomic += atomic(judged.job.amount);
    if (judged.deliveredAt !== null && (this.last === null || judged.deliveredAt > this.last)) {
      this.last = judged.deliveredAt;
    }
  }

  get volume(): bigint {
    return this.volumeAtomic;
  }

  rating(): Rating {
    const { delivered, failed, refunded } = this.counts;
    const closed = delivered + failed + refunded;
    const top = Math.max(0, ...this.byBuyer.values());
    return {
      ...this.counts,
      closed,
      score: closed === 0 ? null : round4(delivered / closed),
      buyers: this.byBuyer.size,
      topBuyerShare: delivered === 0 ? null : round4(top / delivered),
      volume: this.volumeAtomic.toString(),
      lastDeliveredAt: this.last,
    };
  }
}

interface OfferTally {
  offerHash: Hex;
  title: string;
  listed: boolean;
  tally: Tally;
}

interface Snapshot {
  at: number;
  /** Keyed by the seller's lowercase address. */
  sellers: Map<string, { name: string; tally: Tally; offers: OfferTally[] }>;
  ranked: SellerRating[];
  stats: Omit<HubStats, "runnersOnline">;
}

export class Ratings {
  /** Signature recovery is the costliest step, and a slip's signer never changes. */
  private readonly signers = new Map<string, string | null>();
  private snapshot: Snapshot | null = null;
  private building: Promise<Snapshot> | null = null;
  private readonly cacheSeconds: number;

  constructor(
    private readonly store: Store,
    private readonly options: RatingsOptions,
  ) {
    this.cacheSeconds = options.cacheSeconds ?? 5;
  }

  async all(): Promise<SellerRating[]> {
    return (await this.current()).ranked;
  }

  /** `null` when the seller has never published an offer here. */
  async seller(address: string): Promise<SellerRatingDetail | null> {
    const entry = (await this.current()).sellers.get(address.toLowerCase());
    if (!entry) return null;
    const offers = entry.offers.map((offer) => ({
      offerHash: offer.offerHash,
      title: offer.title,
      listed: offer.listed,
      ...offer.tally.rating(),
    }));
    return { seller: entry.name, ...entry.tally.rating(), offers };
  }

  async stats(runnersOnline: number): Promise<HubStats> {
    return { ...(await this.current()).stats, runnersOnline };
  }

  /**
   * One snapshot serves every route for `cacheSeconds`, so a burst of requests reads the
   * ledger once. Concurrent requests during a rebuild share the same build.
   */
  private async current(): Promise<Snapshot> {
    const now = this.options.now();
    if (this.snapshot && now - this.snapshot.at < this.cacheSeconds) return this.snapshot;
    if (!this.building) {
      this.building = this.build(now).finally(() => {
        this.building = null;
      });
    }
    this.snapshot = await this.building;
    return this.snapshot;
  }

  private async build(at: number): Promise<Snapshot> {
    const stored = this.store.listOffers(true);
    const sellers: Snapshot["sellers"] = new Map();
    const byOffer = new Map<string, Tally>();

    // Oldest first, so a seller keeps the spelling of their first offer.
    for (const offer of [...stored].reverse()) {
      const key = offer.seller.toLowerCase();
      const entry = sellers.get(key) ?? { name: offer.seller, tally: new Tally(), offers: [] };
      const tally = new Tally();
      entry.offers.unshift({
        offerHash: offer.offerHash,
        title: offer.offer.title,
        listed: offer.delistedAt === null,
        tally,
      });
      byOffer.set(offer.offerHash.toLowerCase(), tally);
      sellers.set(key, entry);
    }

    const total = new Tally();
    const byRail = new Map<RailId, { calls: number; tally: Tally }>();
    const jobs = this.store.ratingJobs();
    for (const job of jobs) {
      const judged = await this.judge(job);
      total.add(judged);
      const rail = byRail.get(job.rail) ?? { calls: 0, tally: new Tally() };
      rail.calls += 1;
      rail.tally.add(judged);
      byRail.set(job.rail, rail);
      sellers.get(job.seller.toLowerCase())?.tally.add(judged);
      byOffer.get(job.offerHash.toLowerCase())?.add(judged);
    }

    const ranked = [...sellers.values()]
      .map((entry) => ({ seller: entry.name, ...entry.tally.rating() }))
      .sort(compareRatings);

    const rating = total.rating();
    const rails: HubStats["byRail"] = {};
    for (const [id, rail] of [...byRail.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      rails[id] = { calls: rail.calls, delivered: rail.tally.counts.delivered, volume: rail.tally.volume.toString() };
    }

    return {
      at,
      sellers,
      ranked,
      stats: {
        offers: {
          listed: stored.filter((offer) => offer.delistedAt === null).length,
          delisted: stored.filter((offer) => offer.delistedAt !== null).length,
        },
        sellers: sellers.size,
        buyers: rating.buyers,
        calls: jobs.length,
        ...total.counts,
        closed: rating.closed,
        score: rating.score,
        volume: rating.volume,
        byRail: rails,
        asOf: at,
      },
    };
  }

  private async judge(job: RatingJob): Promise<Judged> {
    if (selfDealt(job)) return { job, outcome: "selfDealt", deliveredAt: null };
    switch (job.status) {
      case "funded":
      case "verified":
      case "paid":
        return { job, outcome: "open", deliveredAt: null };
      case "failed":
        return { job, outcome: job.fault === "seller" ? "failed" : "excused", deliveredAt: null };
      case "refunded":
        return { job, outcome: job.fault === "seller" ? "refunded" : "excused", deliveredAt: null };
      case "released":
      case "settled": {
        const slip = job.slip;
        if (!slip || !(await this.slipHolds(job, slip))) {
          return { job, outcome: "unverified", deliveredAt: null };
        }
        return { job, outcome: "delivered", deliveredAt: slip.body.deliveredAt };
      }
    }
  }

  private async slipHolds(job: RatingJob, slip: Slip): Promise<boolean> {
    const body = slip.body;
    if (!same(slip.hash, job.slipHash ?? "")) return false;
    if (!same(slipHash(body), slip.hash)) return false;
    if (!same(body.jobId, job.jobId) || !same(body.offerHash, job.offerHash)) return false;
    if (!same(body.seller, job.seller) || !same(body.buyer, job.buyer)) return false;
    if (body.amount !== job.amount) return false;
    const signer = await this.signerOf(slip);
    return signer !== null && same(signer, job.seller);
  }

  private async signerOf(slip: Slip): Promise<string | null> {
    const key = `${slip.hash.toLowerCase()}:${slip.sellerSig.toLowerCase()}`;
    if (this.signers.has(key)) return this.signers.get(key) ?? null;
    let signer: string | null;
    try {
      signer = await slipSigner(slip);
    } catch {
      signer = null;
    }
    this.signers.set(key, signer);
    return signer;
  }
}

function selfDealt(job: RatingJob): boolean {
  if (job.buyer === "") return false;
  if (same(job.buyer, job.seller)) return true;
  return job.slip !== null && same(job.buyer, job.slip.body.payTo);
}

function compareRatings(a: SellerRating, b: SellerRating): number {
  if (a.score !== b.score) {
    if (a.score === null) return 1;
    if (b.score === null) return -1;
    return b.score - a.score;
  }
  if (a.delivered !== b.delivered) return b.delivered - a.delivered;
  return a.seller.toLowerCase().localeCompare(b.seller.toLowerCase());
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function same(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function atomic(amount: string): bigint {
  return /^\d+$/.test(amount) ? BigInt(amount) : 0n;
}
