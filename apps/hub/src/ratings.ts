import type { Hex } from "viem";
import { slipHash, slipSigner, type RailId, type Slip } from "./deps.ts";
import type { RatingJob, Store } from "./store.ts";

/**
 * Ratings are derived from the hub's own ledger, never reported by anyone.
 *
 * A job counts as delivered only when the hub holds a slip for it that
 *  - hashes to its own body,
 *  - names this job, this offer, this buyer, this seller and this amount, and
 *  - carries a Release signature that recovers to the offer's seller.
 * A failed delivery or a refund counts against the seller. A job still in flight
 * counts for nothing yet. A job the seller bought from itself counts for nothing at all.
 */

export interface RatingCounts {
  /** Closed with a slip that verifies. */
  delivered: number;
  /** The seller's output did not pass, and the money has not come back yet. */
  failed: number;
  /** The money went back to the buyer. */
  refunded: number;
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
}

type Outcome = keyof RatingCounts;

interface Judged {
  job: RatingJob;
  outcome: Outcome;
  deliveredAt: number | null;
}

class Tally {
  readonly counts: RatingCounts = { delivered: 0, failed: 0, refunded: 0, open: 0, unverified: 0, selfDealt: 0 };
  private readonly buyerSet = new Set<string>();
  private volumeAtomic = 0n;
  private last: number | null = null;

  add(judged: Judged): void {
    this.counts[judged.outcome] += 1;
    if (judged.outcome !== "delivered") return;
    this.buyerSet.add(judged.job.buyer.toLowerCase());
    this.volumeAtomic += atomic(judged.job.amount);
    if (judged.deliveredAt !== null && (this.last === null || judged.deliveredAt > this.last)) {
      this.last = judged.deliveredAt;
    }
  }

  get buyers(): Set<string> {
    return this.buyerSet;
  }

  get volume(): bigint {
    return this.volumeAtomic;
  }

  rating(): Rating {
    const { delivered, failed, refunded } = this.counts;
    const closed = delivered + failed + refunded;
    return {
      ...this.counts,
      closed,
      score: closed === 0 ? null : Math.round((delivered / closed) * 10_000) / 10_000,
      buyers: this.buyerSet.size,
      volume: this.volumeAtomic.toString(),
      lastDeliveredAt: this.last,
    };
  }
}

export class Ratings {
  /** Signature recovery is the only costly step, and a slip's signer never changes. */
  private readonly signers = new Map<string, string | null>();

  constructor(private readonly store: Store) {}

  async all(): Promise<SellerRating[]> {
    const bySeller = await this.tallies();
    const ratings = [...bySeller.entries()].map(([seller, tally]) => ({ seller, ...tally.seller.rating() }));
    return ratings.sort(compareRatings);
  }

  /** `null` when the seller has never published an offer here. */
  async seller(address: string): Promise<SellerRatingDetail | null> {
    const bySeller = await this.tallies();
    const entry = bySeller.get(this.sellerKey(address) ?? "");
    if (!entry) return null;
    const offers = entry.offers.map((offer) => ({
      offerHash: offer.offerHash,
      title: offer.title,
      listed: offer.listed,
      ...offer.tally.rating(),
    }));
    return { seller: this.sellerKey(address) ?? address, ...entry.seller.rating(), offers };
  }

  async stats(runnersOnline: number): Promise<HubStats> {
    const stored = this.store.listOffers(true);
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
    }
    const rating = total.rating();
    const rails: HubStats["byRail"] = {};
    for (const [id, rail] of [...byRail.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      rails[id] = { calls: rail.calls, delivered: rail.tally.counts.delivered, volume: rail.tally.volume.toString() };
    }
    return {
      offers: {
        listed: stored.filter((offer) => offer.delistedAt === null).length,
        delisted: stored.filter((offer) => offer.delistedAt !== null).length,
      },
      sellers: new Set(stored.map((offer) => offer.seller.toLowerCase())).size,
      buyers: rating.buyers,
      calls: jobs.length,
      ...total.counts,
      closed: rating.closed,
      score: rating.score,
      volume: rating.volume,
      byRail: rails,
      runnersOnline,
    };
  }

  /** The seller's address as it was published, matched without regard to case. */
  private sellerKey(address: string): string | null {
    const wanted = address.toLowerCase();
    for (const offer of this.store.listOffers(true)) {
      if (offer.seller.toLowerCase() === wanted) return offer.seller;
    }
    return null;
  }

  private async tallies(): Promise<
    Map<string, { seller: Tally; offers: Array<{ offerHash: Hex; title: string; listed: boolean; tally: Tally }> }>
  > {
    const bySeller = new Map<
      string,
      { seller: Tally; offers: Array<{ offerHash: Hex; title: string; listed: boolean; tally: Tally }> }
    >();
    const byOffer = new Map<string, Tally>();
    const canonical = new Map<string, string>();

    // Oldest first, so a seller keeps the spelling of their first offer.
    for (const stored of [...this.store.listOffers(true)].reverse()) {
      const lower = stored.seller.toLowerCase();
      const name = canonical.get(lower) ?? stored.seller;
      canonical.set(lower, name);
      const entry = bySeller.get(name) ?? { seller: new Tally(), offers: [] };
      const tally = new Tally();
      entry.offers.unshift({
        offerHash: stored.offerHash,
        title: stored.offer.title,
        listed: stored.delistedAt === null,
        tally,
      });
      byOffer.set(stored.offerHash.toLowerCase(), tally);
      bySeller.set(name, entry);
    }

    for (const job of this.store.ratingJobs()) {
      const name = canonical.get(job.seller.toLowerCase());
      const entry = name === undefined ? undefined : bySeller.get(name);
      if (!entry) continue;
      const judged = await this.judge(job);
      entry.seller.add(judged);
      byOffer.get(job.offerHash.toLowerCase())?.add(judged);
    }
    return bySeller;
  }

  private async judge(job: RatingJob): Promise<Judged> {
    if (selfDealt(job)) return { job, outcome: "selfDealt", deliveredAt: null };
    switch (job.status) {
      case "funded":
      case "paid":
        return { job, outcome: "open", deliveredAt: null };
      case "failed":
        return { job, outcome: "failed", deliveredAt: null };
      case "refunded":
        return { job, outcome: "refunded", deliveredAt: null };
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

function same(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function atomic(amount: string): bigint {
  return /^\d+$/.test(amount) ? BigInt(amount) : 0n;
}
