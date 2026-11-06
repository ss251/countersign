import { Database } from "bun:sqlite";
import type { Offer, PaymentPayload, RailId, Slip } from "./deps.ts";
import type { Hex } from "viem";

export type JobStatus = "funded" | "paid" | "released" | "settled" | "failed" | "refunded";

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
}

export interface JobPatch {
  status?: JobStatus;
  settleTx?: string | null;
  closeTx?: string | null;
  slipHash?: Hex | null;
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
        created_at INTEGER NOT NULL
      )
    `);
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
        "INSERT INTO jobs (job_id, offer_hash, rail, buyer, amount, deadline, status, payment_json, settle_tx, close_tx, slip_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
      );
  }

  /**
   * Insert a job only when its id is new. The primary key on job_id is the
   * nonce claim: false means a paid call already used this authorisation.
   */
  claimJob(job: JobRecord): boolean {
    const result = this.db
      .query(
        "INSERT OR IGNORE INTO jobs (job_id, offer_hash, rail, buyer, amount, deadline, status, payment_json, settle_tx, close_tx, slip_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
      );
    return result.changes > 0;
  }

  getJob(jobId: string): JobRecord | null {
    const row = this.db.query<JobRow, [string]>("SELECT * FROM jobs WHERE job_id = ?").get(jobId);
    if (!row) return null;
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
    };
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
    }
    if (patch.slipHash !== undefined) {
      sets.push("slip_hash = ?");
      values.push(patch.slipHash);
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

  /** Jobs whose money is still locked and whose deadline has arrived. */
  fundedJobsPastDeadline(now: number): JobRecord[] {
    return this.db
      .query<JobRow, [number]>("SELECT * FROM jobs WHERE status IN ('funded', 'failed') AND deadline <= ?")
      .all(now)
      .map((row) => ({
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
      }));
  }
}
