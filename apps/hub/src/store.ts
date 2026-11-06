import { Database } from "bun:sqlite";
import type {
  ApprovalRequest,
  Envelope,
  EnvelopeSpend,
  Offer,
  PaymentPayload,
  RailId,
  Slip,
} from "./deps.ts";
import type { Hex } from "viem";

export type JobStatus =
  | "funded"
  | "paid"
  | "released"
  | "settled"
  | "failed"
  | "refunded"
  | "delivered"
  | "disputed";

/** How a delivered job's review ended (escrow v2, D12). */
export type ReviewOutcome = "accepted" | "disputed" | "window-elapsed";

/** The closed-or-open states ratings understand. Delivered jobs are open, disputed jobs refunded. */
type RatingStatus = "funded" | "paid" | "released" | "settled" | "failed" | "refunded";

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
  /** Escrow v2: the countersigned review window in seconds. Null on v1 jobs. */
  reviewWindow?: number | null;
  /** Escrow v2: when the delivery was committed, unix seconds. Null until delivered. */
  deliveredAt?: number | null;
  /** Escrow v2: deliveredAt + reviewWindow, unix seconds. Null until delivered. */
  endsAt?: number | null;
  /** Escrow v2: how the review ended. Null until it does. */
  reviewOutcome?: ReviewOutcome | null;
  /** Escrow v2: the accept, dispute or window release transaction. */
  reviewTx?: string | null;
  /** The job this purchase was made inside, or null when the lineage named none this hub recorded. */
  parentJobId?: Hex | null;
}

export interface JobPatch {
  status?: JobStatus;
  settleTx?: string | null;
  closeTx?: string | null;
  slipHash?: Hex | null;
  closedAt?: number | null;
  fault?: Fault | null;
  reviewWindow?: number | null;
  deliveredAt?: number | null;
  endsAt?: number | null;
  reviewOutcome?: ReviewOutcome | null;
  reviewTx?: string | null;
}

/** A buyer agent's signed statement of its limits and spend, as the hub received it. */
export interface EnvelopeMirrorRecord {
  agent: string;
  envelope: Envelope;
  spent: EnvelopeSpend;
  signedAt: number;
  sig: Hex;
}

/** A revoke the envelope's approver signed, kept forever: a later revoke does not replace it. */
export interface RevocationRecord {
  agent: string;
  revokedAt: number;
  sig: Hex;
  recordedAt: number;
}

export type ApprovalStatus = "pending" | "countersign" | "decline";

/** A call the buyer agent held for a human decision. */
export interface ApprovalRecord {
  id: string;
  agent: string;
  offerHash: Hex;
  title: string;
  amount: string;
  rail: RailId;
  terms: unknown;
  status: ApprovalStatus;
  createdAt: number;
  decidedAt: number | null;
  /** The agent's signed request, without sig. Null for rows stored before version 2. */
  request: ApprovalRequest | null;
  /** The agent's signature over the request body, unique per request. */
  requestSig: string | null;
  /** The approver's signature over the decision body. */
  decisionSig: string | null;
}

/** A job joined with its offer's seller and its stored slip, for ratings and stats. */
export interface RatingJob {
  jobId: Hex;
  offerHash: Hex;
  seller: string;
  rail: RailId;
  buyer: string;
  amount: string;
  status: RatingStatus;
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
  review_window: number | null;
  delivered_at: number | null;
  ends_at: number | null;
  review_outcome: string | null;
  review_tx: string | null;
  parent_job_id: string | null;
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

interface EnvelopeRow {
  agent: string;
  envelope_json: string;
  spent_json: string;
  signed_at: number;
  sig: string;
}

interface RevocationRow {
  agent: string;
  revoked_at: number;
  sig: string;
  recorded_at: number;
}

interface ApprovalRow {
  id: string;
  agent: string;
  offer_hash: string;
  title: string;
  amount: string;
  rail: string;
  terms_json: string;
  status: string;
  created_at: number;
  decided_at: number | null;
  request_json: string | null;
  request_sig: string | null;
  decision_sig: string | null;
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
        closed_at INTEGER NULL,
        review_window INTEGER NULL,
        delivered_at INTEGER NULL,
        ends_at INTEGER NULL,
        review_outcome TEXT NULL,
        review_tx TEXT NULL,
        parent_job_id TEXT NULL
      )
    `);
    const jobColumns = this.db.query<{ name: string }, []>("PRAGMA table_info(jobs)").all();
    if (!jobColumns.some((column) => column.name === "closed_at")) {
      this.db.run("ALTER TABLE jobs ADD COLUMN closed_at INTEGER NULL");
    }
    if (!jobColumns.some((column) => column.name === "fault")) {
      this.db.run("ALTER TABLE jobs ADD COLUMN fault TEXT NULL");
    }
    if (!jobColumns.some((column) => column.name === "review_window")) {
      this.db.run("ALTER TABLE jobs ADD COLUMN review_window INTEGER NULL");
    }
    if (!jobColumns.some((column) => column.name === "delivered_at")) {
      this.db.run("ALTER TABLE jobs ADD COLUMN delivered_at INTEGER NULL");
    }
    if (!jobColumns.some((column) => column.name === "ends_at")) {
      this.db.run("ALTER TABLE jobs ADD COLUMN ends_at INTEGER NULL");
    }
    if (!jobColumns.some((column) => column.name === "review_outcome")) {
      this.db.run("ALTER TABLE jobs ADD COLUMN review_outcome TEXT NULL");
    }
    if (!jobColumns.some((column) => column.name === "review_tx")) {
      this.db.run("ALTER TABLE jobs ADD COLUMN review_tx TEXT NULL");
    }
    if (!jobColumns.some((column) => column.name === "parent_job_id")) {
      this.db.run("ALTER TABLE jobs ADD COLUMN parent_job_id TEXT NULL");
    }
    this.db.run(`
      CREATE TABLE IF NOT EXISTS slips (
        slip_hash TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        slip_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS envelopes (
        agent TEXT PRIMARY KEY,
        envelope_json TEXT NOT NULL,
        spent_json TEXT NOT NULL,
        signed_at INTEGER NOT NULL,
        sig TEXT NOT NULL
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        agent TEXT NOT NULL,
        offer_hash TEXT NOT NULL,
        title TEXT NOT NULL,
        amount TEXT NOT NULL,
        rail TEXT NOT NULL,
        terms_json TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        decided_at INTEGER NULL,
        request_json TEXT NULL,
        request_sig TEXT NULL,
        decision_sig TEXT NULL
      )
    `);
    const approvalColumns = this.db.query<{ name: string }, []>("PRAGMA table_info(approvals)").all();
    if (!approvalColumns.some((column) => column.name === "request_json")) {
      this.db.run("ALTER TABLE approvals ADD COLUMN request_json TEXT NULL");
    }
    if (!approvalColumns.some((column) => column.name === "request_sig")) {
      this.db.run("ALTER TABLE approvals ADD COLUMN request_sig TEXT NULL");
    }
    if (!approvalColumns.some((column) => column.name === "decision_sig")) {
      this.db.run("ALTER TABLE approvals ADD COLUMN decision_sig TEXT NULL");
    }
    this.db.run("CREATE UNIQUE INDEX IF NOT EXISTS approvals_request_sig ON approvals(request_sig)");
    this.db.run(`
      CREATE TABLE IF NOT EXISTS revocations (agent TEXT PRIMARY KEY, revoked_at INTEGER NOT NULL, sig TEXT NOT NULL, recorded_at INTEGER NOT NULL)
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
        "INSERT INTO jobs (job_id, offer_hash, rail, buyer, amount, deadline, status, payment_json, settle_tx, close_tx, slip_hash, created_at, closed_at, review_window, delivered_at, ends_at, review_outcome, review_tx, parent_job_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
        job.reviewWindow ?? null,
        job.deliveredAt ?? null,
        job.endsAt ?? null,
        job.reviewOutcome ?? null,
        job.reviewTx ?? null,
        job.parentJobId ?? null,
      );
  }

  /**
   * Insert a job only when its id is new. The primary key on job_id is the
   * nonce claim: false means a paid call already used this authorisation.
   */
  claimJob(job: JobRecord): boolean {
    const result = this.db
      .query(
        "INSERT OR IGNORE INTO jobs (job_id, offer_hash, rail, buyer, amount, deadline, status, payment_json, settle_tx, close_tx, slip_hash, created_at, closed_at, review_window, delivered_at, ends_at, review_outcome, review_tx, parent_job_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
        job.reviewWindow ?? null,
        job.deliveredAt ?? null,
        job.endsAt ?? null,
        job.reviewOutcome ?? null,
        job.reviewTx ?? null,
        job.parentJobId ?? null,
      );
    return result.changes > 0;
  }

  getJob(jobId: string): JobRecord | null {
    const row = this.db.query<JobRow, [string]>("SELECT * FROM jobs WHERE job_id = ?").get(jobId);
    return row ? jobFromRow(row) : null;
  }

  /** Jobs claimed inside this one, oldest first. The id is compared case-insensitively. */
  childJobs(parentJobId: string): JobRecord[] {
    return this.db
      .query<JobRow, [string]>(
        "SELECT * FROM jobs WHERE lower(parent_job_id) = lower(?) ORDER BY created_at ASC, job_id ASC",
      )
      .all(parentJobId)
      .map(jobFromRow);
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
    if (patch.reviewWindow !== undefined) {
      sets.push("review_window = ?");
      values.push(patch.reviewWindow);
    }
    if (patch.deliveredAt !== undefined) {
      sets.push("delivered_at = ?");
      values.push(patch.deliveredAt);
    }
    if (patch.endsAt !== undefined) {
      sets.push("ends_at = ?");
      values.push(patch.endsAt);
    }
    if (patch.reviewOutcome !== undefined) {
      sets.push("review_outcome = ?");
      values.push(patch.reviewOutcome);
    }
    if (patch.reviewTx !== undefined) {
      sets.push("review_tx = ?");
      values.push(patch.reviewTx);
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
        status:
          row.status === "delivered"
            ? "funded"
            : row.status === "disputed"
              ? "refunded"
              : (row.status as RatingStatus),
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

  /** Delivered jobs whose review window has closed (strictly after ends_at). */
  deliveredJobsPastWindow(now: number): JobRecord[] {
    return this.db
      .query<JobRow, [number]>("SELECT * FROM jobs WHERE status = 'delivered' AND ends_at IS NOT NULL AND ends_at < ?")
      .all(now)
      .map(jobFromRow);
  }

  /** One buyer's jobs, newest first. The address is compared case-insensitively. */
  listJobsByBuyer(buyer: string, limit: number): JobRecord[] {
    return this.db
      .query<JobRow, [string, number]>(
        "SELECT * FROM jobs WHERE lower(buyer) = lower(?) ORDER BY created_at DESC, rowid DESC LIMIT ?",
      )
      .all(buyer, limit)
      .map(jobFromRow);
  }

  /** One seller's jobs, newest first. The offer's seller is compared case-insensitively. */
  listJobsBySeller(seller: string, limit: number): JobRecord[] {
    return this.db
      .query<JobRow, [string, number]>(
        `SELECT jobs.job_id, jobs.offer_hash, jobs.rail, jobs.buyer, jobs.amount, jobs.deadline,
                jobs.status, jobs.payment_json, jobs.settle_tx, jobs.close_tx, jobs.slip_hash,
                jobs.created_at, jobs.closed_at, jobs.review_window, jobs.delivered_at, jobs.ends_at,
                jobs.review_outcome, jobs.review_tx, jobs.parent_job_id
           FROM jobs
           JOIN offers ON offers.offer_hash = jobs.offer_hash
          WHERE lower(offers.seller) = lower(?)
          ORDER BY jobs.created_at DESC, jobs.rowid DESC
          LIMIT ?`,
      )
      .all(seller, limit)
      .map(jobFromRow);
  }

  putEnvelopeMirror(record: EnvelopeMirrorRecord): void {
    this.db
      .query(
        "INSERT INTO envelopes (agent, envelope_json, spent_json, signed_at, sig) VALUES (?, ?, ?, ?, ?) ON CONFLICT(agent) DO UPDATE SET envelope_json = excluded.envelope_json, spent_json = excluded.spent_json, signed_at = excluded.signed_at, sig = excluded.sig",
      )
      .run(
        record.agent.toLowerCase(),
        JSON.stringify(record.envelope),
        JSON.stringify(record.spent),
        record.signedAt,
        record.sig,
      );
  }

  getEnvelopeMirror(agent: string): EnvelopeMirrorRecord | null {
    const row = this.db
      .query<EnvelopeRow, [string]>("SELECT * FROM envelopes WHERE agent = ?")
      .get(agent.toLowerCase());
    if (!row) return null;
    return {
      agent: row.agent,
      envelope: JSON.parse(row.envelope_json) as Envelope,
      spent: JSON.parse(row.spent_json) as EnvelopeSpend,
      signedAt: row.signed_at,
      sig: row.sig as Hex,
    };
  }

  /** Record a revoke. The first revoke for an agent is kept. */
  putRevocation(record: RevocationRecord): void {
    this.db
      .query("INSERT OR IGNORE INTO revocations (agent, revoked_at, sig, recorded_at) VALUES (?, ?, ?, ?)")
      .run(record.agent.toLowerCase(), record.revokedAt, record.sig, record.recordedAt);
  }

  getRevocation(agent: string): RevocationRecord | null {
    const row = this.db
      .query<RevocationRow, [string]>("SELECT * FROM revocations WHERE agent = ?")
      .get(agent.toLowerCase());
    if (!row) return null;
    return {
      agent: row.agent,
      revokedAt: row.revoked_at,
      sig: row.sig as Hex,
      recordedAt: row.recorded_at,
    };
  }

  /** Insert an approval. False when its id or request signature was already stored. */
  putApproval(approval: ApprovalRecord): boolean {
    const result = this.db
      .query(
        "INSERT OR IGNORE INTO approvals (id, agent, offer_hash, title, amount, rail, terms_json, status, created_at, decided_at, request_json, request_sig, decision_sig) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        approval.id,
        approval.agent.toLowerCase(),
        approval.offerHash,
        approval.title,
        approval.amount,
        approval.rail,
        JSON.stringify(approval.terms),
        approval.status,
        approval.createdAt,
        approval.decidedAt,
        approval.request === null ? null : JSON.stringify(approval.request),
        approval.requestSig,
        approval.decisionSig,
      );
    return result.changes > 0;
  }

  /** True when this exact signed request was already accepted. */
  hasApprovalRequestSig(sig: string): boolean {
    const row = this.db
      .query<{ present: number }, [string]>("SELECT 1 AS present FROM approvals WHERE request_sig = ? LIMIT 1")
      .get(sig);
    return row !== null;
  }

  /** Pending approvals for one agent that have not passed the given creation time. */
  countPendingApprovals(agent: string, since: number): number {
    const row = this.db
      .query<{ n: number }, [string, number]>(
        "SELECT COUNT(*) AS n FROM approvals WHERE agent = ? AND status = 'pending' AND created_at > ?",
      )
      .get(agent.toLowerCase(), since);
    return row?.n ?? 0;
  }

  getApproval(id: string): ApprovalRecord | null {
    const row = this.db.query<ApprovalRow, [string]>("SELECT * FROM approvals WHERE id = ?").get(id);
    return row ? approvalFromRow(row) : null;
  }

  /** Approvals newest first, optionally for one agent. */
  listApprovals(agent?: string): ApprovalRecord[] {
    const rows = agent
      ? this.db
          .query<ApprovalRow, [string]>(
            "SELECT * FROM approvals WHERE lower(agent) = lower(?) ORDER BY created_at DESC, rowid DESC",
          )
          .all(agent)
      : this.db
          .query<ApprovalRow, []>("SELECT * FROM approvals ORDER BY created_at DESC, rowid DESC")
          .all();
    return rows.map(approvalFromRow);
  }

  /** Set a pending approval's decision and signature. False when it was already decided. */
  decideApproval(
    id: string,
    status: Exclude<ApprovalStatus, "pending">,
    decidedAt: number,
    decisionSig: string,
  ): boolean {
    const result = this.db
      .query("UPDATE approvals SET status = ?, decided_at = ?, decision_sig = ? WHERE id = ? AND status = 'pending'")
      .run(status, decidedAt, decisionSig, id);
    return result.changes > 0;
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
    reviewWindow: row.review_window,
    deliveredAt: row.delivered_at,
    endsAt: row.ends_at,
    reviewOutcome: row.review_outcome as ReviewOutcome | null,
    reviewTx: row.review_tx,
    parentJobId: row.parent_job_id as Hex | null,
  };
}

function closedAtFor(job: JobRecord): number | null {
  if (job.closedAt !== undefined) return job.closedAt;
  return job.closeTx !== null ? job.createdAt : null;
}

function approvalFromRow(row: ApprovalRow): ApprovalRecord {
  return {
    id: row.id,
    agent: row.agent,
    offerHash: row.offer_hash as Hex,
    title: row.title,
    amount: row.amount,
    rail: row.rail as RailId,
    terms: JSON.parse(row.terms_json) as unknown,
    status: row.status as ApprovalStatus,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
    request: row.request_json === null ? null : (JSON.parse(row.request_json) as ApprovalRequest),
    requestSig: row.request_sig,
    decisionSig: row.decision_sig,
  };
}
