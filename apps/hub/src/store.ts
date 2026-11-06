import { Database } from "bun:sqlite";
import type { Offer, PaymentPayload, RailId, Slip } from "./deps.ts";
import type { Hex } from "viem";

export type JobStatus = "funded" | "paid" | "released" | "settled" | "failed" | "refunded";

/**
 * Who a failed delivery is on. `seller`: the runner took the job and refused it, answered
 * badly, or ran past the offer's own deadline. `hub`: the runner was gone, the connection
 * dropped, or the hub cut the job short. A job closed without one is nobody's fault on record.
 */
export type Fault = "seller" | "hub";

export interface StoredOffer {
  offerHash: Hex;
  seller: string;
  offer: Offer;
  publishedAt: number;
  delistedAt: number | null;
}

export interface JobRecord {
  jobId: Hex;
  offerHash: Hex;
  rail: RailId;
  buyer: string;
  amount: string;
  deadline: number;
  status: JobStatus;
  payment: PaymentPayload;
  settleTx: string | null;
  closeTx: string | null;
  slipHash: Hex | null;
  createdAt: number;
  closedAt?: number | null;
}

export interface JobPatch {
  status?: JobStatus;
  settleTx?: string | null;
  closeTx?: string | null;
  slipHash?: Hex | null;
  closedAt?: number | null;
  fault?: Fault | null;
}

/** A job joined with its offer's seller and its stored slip, for ratings and stats. */
export interface RatingJob {
  jobId: Hex;
  offerHash: Hex;
  seller: string;
  rail: RailId;
  buyer: string;
  amount: string;
  status: JobStatus;
  slipHash: Hex | null;
  slip: Slip | null;
  fault: Fault | null;
  createdAt: number;
}

interface OfferRow {
  offer_hash: string;
  seller: string;
  offer_json: string;
  published_at: number;
  delisted_at: number | null;
}

interface JobRow {
  job_id: string;
  offer_hash: string;
  rail: string;
  buyer: string;
  amount: string;
  deadline: number;
  status: string;
  payment_json: string;
  settle_tx: string | null;
  close_tx: string | null;
  slip_hash: string | null;
  created_at: number;
  closed_at: number | null;
}

interface RatingJobRow {
  job_id: string;
  offer_hash: string;
  rail: string;
  buyer: string;
  amount: string;
  status: string;
  slip_hash: string | null;
  fault: string | null;
  created_at: number;
  seller: string;
  slip_json: string | null;
}

interface SlipRow {
  slip_hash: string;
  job_id: string;
  slip_json: string;
  created_at: number;
}

export class Store {
  private readonly db: Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run(`
      CREATE TABLE IF NOT EXISTS offers (
        offer_hash TEXT PRIMARY KEY,
        seller TEXT NOT NULL,
        offer_json TEXT NOT NULL,
        published_at INTEGER NOT NULL,
        delisted_at INTEGER NULL
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS jobs (
        job_id TEXT PRIMARY KEY,
        offer_hash TEXT NOT NULL,
        rail TEXT NOT NULL,
        buyer TEXT NOT NULL,
        amount TEXT NOT NULL,
        deadline INTEGER NOT NULL,
        status TEXT NOT NULL,
        payment_json TEXT NOT NULL,
        settle_tx TEXT NULL,
        close_tx TEXT NULL,
        slip_hash TEXT NULL,
        created_at INTEGER NOT NULL,
        closed_at INTEGER NULL
      )
    `);
    const jobColumns = this.db.query<{ name: string }, []>("PRAGMA table_info(jobs)").all();
    if (!jobColumns.some((column) => column.name === "closed_at")) {
      this.db.run("ALTER TABLE jobs ADD COLUMN closed_at INTEGER NULL");
    }
    if (!jobColumns.some((column) => column.name === "fault")) {
      this.db.run("ALTER TABLE jobs ADD COLUMN fault TEXT NULL");
    }
    this.db.run(`
      CREATE TABLE IF NOT EXISTS slips (
        slip_hash TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        slip_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
  }

  /** Insert a new offer. Returns false when the hash was already stored. */
  putOffer(offerHash: Hex, seller: string, offer: Offer, publishedAt: number): boolean {
    const result = this.db
      .query("INSERT OR IGNORE INTO offers (offer_hash, seller, offer_json, published_at, delisted_at) VALUES (?, ?, ?, ?, NULL)")
      .run(offerHash, seller, JSON.stringify(offer), publishedAt);
    return result.changes > 0;
  }

  getOffer(offerHash: string): StoredOffer | null {
    const row = this.db.query<OfferRow, [string]>("SELECT * FROM offers WHERE offer_hash = ?").get(offerHash);
    if (!row) return null;
    return {
      offerHash: row.offer_hash as Hex,
      seller: row.seller,
      offer: JSON.parse(row.offer_json) as Offer,
      publishedAt: row.published_at,
      delistedAt: row.delisted_at,
    };
  }

  /** Newest first. Delisted offers are included only when asked for. */
  listOffers(includeDelisted = false): StoredOffer[] {
    const sql = includeDelisted
      ? "SELECT * FROM offers ORDER BY published_at DESC, rowid DESC"
      : "SELECT * FROM offers WHERE delisted_at IS NULL ORDER BY published_at DESC, rowid DESC";
    return this.db
      .query<OfferRow, []>(sql)
      .all()
      .map((row) => ({
        offerHash: row.offer_hash as Hex,
        seller: row.seller,
        offer: JSON.parse(row.offer_json) as Offer,
        publishedAt: row.published_at,
        delistedAt: row.delisted_at,
      }));
  }

  delistOffer(offerHash: Hex, at: number): void {
    this.db.query("UPDATE offers SET delisted_at = ? WHERE offer_hash = ?").run(at, offerHash);
  }

  putJob(job: JobRecord): void {
    this.db
      .query(
        "INSERT INTO jobs (job_id, offer_hash, rail, buyer, amount, deadline, status, payment_json, settle_tx, close_tx, slip_hash, created_at, closed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        job.jobId,
        job.offerHash,
        job.rail,
        job.buyer,
        job.amount,
        job.deadline,
        job.status,
        JSON.stringify(job.payment),
        job.settleTx,
        job.closeTx,
        job.slipHash,
        job.createdAt,
        closedAtFor(job),
      );
  }

  /**
   * Insert a job only when its id is new. The primary key on job_id is the
   * nonce claim: false means a paid call already used this authorisation.
   */
  claimJob(job: JobRecord): boolean {
    const result = this.db
      .query(
        "INSERT OR IGNORE INTO jobs (job_id, offer_hash, rail, buyer, amount, deadline, status, payment_json, settle_tx, close_tx, slip_hash, created_at, closed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        job.jobId,
        job.offerHash,
        job.rail,
        job.buyer,
        job.amount,
        job.deadline,
        job.status,
        JSON.stringify(job.payment),
        job.settleTx,
        job.closeTx,
        job.slipHash,
        job.createdAt,
        closedAtFor(job),
      );
    return result.changes > 0;
  }

  getJob(jobId: string): JobRecord | null {
    const row = this.db.query<JobRow, [string]>("SELECT * FROM jobs WHERE job_id = ?").get(jobId);
    return row ? jobFromRow(row) : null;
  }

  /** Every job, newest first. */
  listJobs(): JobRecord[] {
    return this.db
      .query<JobRow, []>("SELECT * FROM jobs ORDER BY rowid DESC")
      .all()
      .map(jobFromRow);
  }

  /** Closed jobs only, newest close first, with created_at as the fallback time. */
  listClosedJobs(limit = 20): JobRecord[] {
    return this.db
      .query<JobRow, [number]>(
        "SELECT * FROM jobs WHERE status IN ('released', 'settled', 'refunded') AND close_tx IS NOT NULL ORDER BY COALESCE(closed_at, created_at) DESC, rowid DESC LIMIT ?",
      )
      .all(limit)
      .map(jobFromRow);
  }

  updateJob(jobId: string, patch: JobPatch): void {
    const sets: string[] = [];
    const values: (string | number | null)[] = [];
    if (patch.status !== undefined) {
      sets.push("status = ?");
      values.push(patch.status);
    }
    if (patch.settleTx !== undefined) {
      sets.push("settle_tx = ?");
      values.push(patch.settleTx);
    }
    if (patch.closeTx !== undefined) {
      sets.push("close_tx = ?");
      values.push(patch.closeTx);
      if (patch.closeTx === null) {
        sets.push("closed_at = NULL");
      } else if (patch.closedAt !== undefined) {
        sets.push("closed_at = ?");
        values.push(patch.closedAt);
      } else {
        sets.push("closed_at = CAST(strftime('%s', 'now') AS INTEGER)");
      }
    }
    if (patch.slipHash !== undefined) {
      sets.push("slip_hash = ?");
      values.push(patch.slipHash);
    }
    if (patch.fault !== undefined) {
      sets.push("fault = ?");
      values.push(patch.fault);
    }
    if (sets.length === 0) return;
    this.db.query(`UPDATE jobs SET ${sets.join(", ")} WHERE job_id = ?`).run(...values, jobId);
  }

  putSlip(slipHash: Hex, jobId: Hex, slip: Slip, createdAt: number): void {
    this.db
      .query("INSERT OR REPLACE INTO slips (slip_hash, job_id, slip_json, created_at) VALUES (?, ?, ?, ?)")
      .run(slipHash, jobId, JSON.stringify(slip), createdAt);
  }

  getSlip(slipHash: string): Slip | null {
    const row = this.db.query<SlipRow, [string]>("SELECT * FROM slips WHERE slip_hash = ?").get(slipHash);
    return row ? (JSON.parse(row.slip_json) as Slip) : null;
  }

  /**
   * Every job with the seller of its offer and the slip the hub stored for it, oldest first.
   * Read-only: ratings and stats are derived from this and nothing else.
   */
  ratingJobs(): RatingJob[] {
    return this.db
      .query<RatingJobRow, []>(
        `SELECT jobs.job_id, jobs.offer_hash, jobs.rail, jobs.buyer, jobs.amount, jobs.status,
                jobs.slip_hash, jobs.fault, jobs.created_at,
                offers.seller AS seller, slips.slip_json AS slip_json
           FROM jobs
           JOIN offers ON offers.offer_hash = jobs.offer_hash
           LEFT JOIN slips ON slips.slip_hash = jobs.slip_hash
          ORDER BY jobs.created_at ASC, jobs.rowid ASC`,
      )
      .all()
      .map((row) => ({
        jobId: row.job_id as Hex,
        offerHash: row.offer_hash as Hex,
        seller: row.seller,
        rail: row.rail as RailId,
        buyer: row.buyer,
        amount: row.amount,
        status: row.status as JobStatus,
        slipHash: row.slip_hash as Hex | null,
        slip: row.slip_json === null ? null : (JSON.parse(row.slip_json) as Slip),
        fault: row.fault === "seller" || row.fault === "hub" ? row.fault : null,
        createdAt: row.created_at,
      }));
  }

  /** Jobs whose money is still locked and whose deadline has arrived. */
  fundedJobsPastDeadline(now: number): JobRecord[] {
    return this.db
      .query<JobRow, [number]>("SELECT * FROM jobs WHERE status IN ('funded', 'failed') AND deadline <= ?")
      .all(now)
      .map(jobFromRow);
  }
}

function jobFromRow(row: JobRow): JobRecord {
  return {
    jobId: row.job_id as Hex,
    offerHash: row.offer_hash as Hex,
    rail: row.rail as RailId,
    buyer: row.buyer,
    amount: row.amount,
    deadline: row.deadline,
    status: row.status as JobStatus,
    payment: JSON.parse(row.payment_json) as PaymentPayload,
    settleTx: row.settle_tx,
    closeTx: row.close_tx,
    slipHash: row.slip_hash as Hex | null,
    createdAt: row.created_at,
    closedAt: row.closed_at,
  };
}

function closedAtFor(job: JobRecord): number | null {
  if (job.closedAt !== undefined) return job.closedAt;
  return job.closeTx !== null ? job.createdAt : null;
}
