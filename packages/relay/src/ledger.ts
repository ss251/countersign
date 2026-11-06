import { Database } from "bun:sqlite";
import type { SQLQueryBindings } from "bun:sqlite";
import { atomicToWire, formatUnits } from "@countersign/core";
import { txUrl, USDT } from "./chain.ts";

export type PaymentStatus = "settled" | "pending";

export type PaymentRecord = {
  id: string;
  network: string;
  payer: string;
  payTo: string;
  amount: bigint;
  nonce: string;
  txHash: string;
  blockNumber: bigint;
  settledAt: number;
  resource: string | null;
  description: string | null;
  status: PaymentStatus;
  refunded: bigint;
};

export type RefundStatus = "pending" | "confirmed";

export type RefundRecord = {
  paymentId: string;
  amount: bigint;
  txHash: string;
  blockNumber: bigint;
  nonce: string;
  status: RefundStatus;
  validBefore: number;
};

export type NewRefund = Omit<RefundRecord, "status" | "validBefore">;

export type NewPendingRefund = {
  paymentId: string;
  amount: bigint;
  txHash: string;
  nonce: string;
};

export type SpendRecord = {
  txHash: string;
  payer: string;
  costWei: bigint;
  at: number;
};

export type NewPayment = {
  id: string;
  network: string;
  payer: string;
  payTo: string;
  amount: bigint;
  nonce: string;
  txHash: string;
  blockNumber: bigint;
  settledAt: number;
  resource?: string | null;
  description?: string | null;
};

export type JobStatus = "pending" | "funded" | "released" | "cancelled" | "refunded";

export type JobRecord = {
  jobId: string;
  offerHash: string;
  buyer: string;
  payee: string;
  amount: bigint;
  deadline: number;
  fundTx: string;
  fundBlock: bigint;
  status: JobStatus;
  closeTx: string | null;
  slipHash: string | null;
  createdAt: number;
  closedAt: number | null;
  resource: string | null;
  description: string | null;
};

export type NewJob = {
  jobId: string;
  offerHash: string;
  buyer: string;
  payee: string;
  amount: bigint;
  deadline: number;
  fundTx: string;
  fundBlock: bigint;
  status?: "pending" | "funded";
  createdAt: number;
  resource?: string | null;
  description?: string | null;
};

export type JobFilter = {
  payee?: string;
  buyer?: string;
};

export type OrderKind = "exact" | "escrow";
export type CloseKind = "release" | "cancel" | "deadline_refund";
export type OrderStatus =
  | "paid"
  | "partially_refunded"
  | "refunded"
  | "refund_pending"
  | "pending"
  | "held"
  | "cancelled";

export type Order = {
  id: string;
  kind: OrderKind;
  customer: string;
  merchant: string;
  amount: bigint;
  fee: bigint;
  refunded: bigint;
  refundable: bigint;
  status: OrderStatus;
  closeKind: CloseKind | null;
  createdAt: number;
  settleTx: string;
  closeTx: string | null;
  refundTxs: string[];
  offerHash?: string;
  deadline?: number;
  resource?: string | null;
  description?: string | null;
};

export type OrderFilter = {
  merchant?: string;
  customer?: string;
};

type JobRow = {
  job_id: string;
  offer_hash: string;
  buyer: string;
  payee: string;
  amount: string;
  deadline: number;
  fund_tx: string;
  fund_block: string;
  status: string;
  close_tx: string | null;
  slip_hash: string | null;
  created_at: number;
  closed_at: number | null;
  resource: string | null;
  description: string | null;
};

export type PaymentFilter = {
  payTo?: string;
  payer?: string;
};

type PaymentRow = {
  id: string;
  network: string;
  payer: string;
  pay_to: string;
  amount: string;
  nonce: string;
  tx_hash: string;
  block_number: string;
  settled_at: number;
  resource: string | null;
  description: string | null;
  status: string;
};

type RefundRow = {
  payment_id: string;
  amount: string;
  tx_hash: string;
  block_number: string;
  nonce: string;
  status: string;
  valid_before: number;
};

type SpendRow = {
  tx_hash: string;
  payer: string;
  cost_wei: string;
  at: number;
};

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    network TEXT NOT NULL,
    payer TEXT NOT NULL,
    pay_to TEXT NOT NULL,
    amount TEXT NOT NULL,
    nonce TEXT NOT NULL,
    tx_hash TEXT NOT NULL,
    block_number TEXT NOT NULL,
    settled_at INTEGER NOT NULL,
    resource TEXT,
    description TEXT,
    status TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS payments_authorization
    ON payments (payer, nonce);
  CREATE TABLE IF NOT EXISTS refunds (
    payment_id TEXT NOT NULL,
    amount TEXT NOT NULL,
    tx_hash TEXT NOT NULL,
    block_number TEXT NOT NULL,
    nonce TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'confirmed',
    valid_before INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS refunds_payment
    ON refunds (payment_id);
  CREATE TABLE IF NOT EXISTS jobs (
    job_id TEXT PRIMARY KEY,
    offer_hash TEXT NOT NULL,
    buyer TEXT NOT NULL,
    payee TEXT NOT NULL,
    amount TEXT NOT NULL,
    deadline INTEGER NOT NULL,
    fund_tx TEXT NOT NULL,
    fund_block TEXT NOT NULL,
    status TEXT NOT NULL,
    close_tx TEXT,
    slip_hash TEXT,
    created_at INTEGER NOT NULL,
    closed_at INTEGER,
    resource TEXT,
    description TEXT
  );
  CREATE INDEX IF NOT EXISTS jobs_payee ON jobs (payee);
  CREATE INDEX IF NOT EXISTS jobs_buyer ON jobs (buyer);
  CREATE TABLE IF NOT EXISTS spends (
    tx_hash TEXT NOT NULL,
    payer TEXT NOT NULL,
    cost_wei TEXT NOT NULL,
    at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS spends_at ON spends (at);
`;

const ORDERS_CSV_HEADER =
  "date_utc,order_id,kind,customer,merchant,amount_usdt,fee_usdt,refunded_usdt,net_usdt,status,settle_tx_url,close_tx_url,refund_tx_urls";

const CSV_HEADER =
  "date_utc,payment_id,payer,merchant,amount_usdt,refunded_usdt,net_usdt,status,settle_tx_url,refund_tx_urls";

export type LedgerOptions = {
  /** The escrow toll in basis points, used for released escrow order fees. */
  tollBps?: number;
};

export class Ledger {
  private readonly db: Database;
  private readonly tollBps: number;

  constructor(path: string, options: LedgerOptions = {}) {
    this.db = new Database(path, { create: true });
    this.db.exec(SCHEMA);
    this.migrate();
    this.tollBps = options.tollBps ?? 0;
  }

  recordPayment(payment: NewPayment): void {
    this.insert(payment, "settled");
  }

  recordPending(payment: NewPayment): void {
    this.insert(payment, "pending");
  }

  promotePending(
    id: string,
    info?: { blockNumber?: bigint; settledAt?: number } | bigint,
  ): void {
    const sets = ["status = 'settled'"];
    const params: SQLQueryBindings[] = [];
    if (typeof info === "bigint") {
      sets.push("block_number = ?");
      params.push(info.toString());
    } else if (info) {
      if (info.blockNumber !== undefined) {
        sets.push("block_number = ?");
        params.push(info.blockNumber.toString());
      }
      if (info.settledAt !== undefined) {
        sets.push("settled_at = ?");
        params.push(info.settledAt);
      }
    }
    params.push(id);
    this.db
      .query<unknown, SQLQueryBindings[]>(
        `UPDATE payments SET ${sets.join(", ")} WHERE id = ? AND status = 'pending'`,
      )
      .run(...params);
  }

  findByAuthorization(from: string, nonce: string): PaymentRecord | null {
    const row = this.db
      .query<PaymentRow, [string, string]>(
        "SELECT * FROM payments WHERE LOWER(payer) = LOWER(?) AND LOWER(nonce) = LOWER(?) LIMIT 1",
      )
      .get(from, nonce);
    return row ? this.toPayment(row) : null;
  }

  getPayment(id: string): PaymentRecord | null {
    const row = this.db
      .query<PaymentRow, [string]>("SELECT * FROM payments WHERE id = ? LIMIT 1")
      .get(id);
    return row ? this.toPayment(row) : null;
  }

  recordSpend(spend: SpendRecord): void {
    this.db
      .query("INSERT INTO spends (tx_hash, payer, cost_wei, at) VALUES (?, ?, ?, ?)")
      .run(spend.txHash, spend.payer, spend.costWei.toString(), spend.at);
  }

  recentSpends(sinceMs: number): SpendRecord[] {
    const rows = this.db
      .query<SpendRow, [number]>(
        "SELECT * FROM spends WHERE at > ? ORDER BY at ASC, rowid ASC",
      )
      .all(sinceMs);
    return rows.map((row) => ({
      txHash: row.tx_hash,
      payer: row.payer,
      costWei: BigInt(row.cost_wei),
      at: row.at,
    }));
  }

  listPayments(filter: PaymentFilter = {}): PaymentRecord[] {
    const conditions: string[] = [];
    const params: SQLQueryBindings[] = [];
    if (filter.payTo) {
      conditions.push("LOWER(pay_to) = LOWER(?)");
      params.push(filter.payTo);
    }
    if (filter.payer) {
      conditions.push("LOWER(payer) = LOWER(?)");
      params.push(filter.payer);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.db
      .query<PaymentRow, SQLQueryBindings[]>(
        `SELECT * FROM payments ${where} ORDER BY settled_at DESC, rowid DESC`,
      )
      .all(...params);
    return rows.map((row) => this.toPayment(row));
  }

  recordRefund(refund: NewRefund): void {
    this.db
      .query(
        `INSERT INTO refunds
          (payment_id, amount, tx_hash, block_number, nonce, status, valid_before)
         VALUES (?, ?, ?, ?, ?, 'confirmed', 0)`,
      )
      .run(
        refund.paymentId,
        atomicToWire(refund.amount),
        refund.txHash,
        refund.blockNumber.toString(),
        refund.nonce,
      );
  }

  recordPendingRefund(refund: NewPendingRefund, validBefore: number): void {
    this.db
      .query(
        `INSERT INTO refunds
          (payment_id, amount, tx_hash, block_number, nonce, status, valid_before)
         VALUES (?, ?, ?, '0', ?, 'pending', ?)`,
      )
      .run(
        refund.paymentId,
        atomicToWire(refund.amount),
        refund.txHash,
        refund.nonce,
        validBefore,
      );
  }

  confirmRefund(paymentId: string, nonce: string, blockNumber: bigint): boolean {
    const result = this.db
      .query(
        `UPDATE refunds SET status = 'confirmed', block_number = ?
         WHERE payment_id = ? AND LOWER(nonce) = LOWER(?) AND status = 'pending'`,
      )
      .run(blockNumber.toString(), paymentId, nonce);
    return result.changes > 0;
  }

  deleteRefund(paymentId: string, nonce: string): boolean {
    const result = this.db
      .query(
        "DELETE FROM refunds WHERE payment_id = ? AND LOWER(nonce) = LOWER(?) AND status = 'pending'",
      )
      .run(paymentId, nonce);
    return result.changes > 0;
  }

  refundable(id: string): bigint {
    const payment = this.getPayment(id);
    if (payment) {
      if (payment.status !== "settled") return 0n;
      const remaining = payment.amount - this.reservedFor(payment.id);
      return remaining > 0n ? remaining : 0n;
    }
    const job = this.getJob(id);
    if (!job || job.status !== "released") return 0n;
    const remaining = job.amount - this.reservedFor(job.jobId);
    return remaining > 0n ? remaining : 0n;
  }

  recordJob(job: NewJob): void {
    this.db
      .query(
        `INSERT INTO jobs
          (job_id, offer_hash, buyer, payee, amount, deadline, fund_tx, fund_block, status, created_at, resource, description)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        job.jobId,
        job.offerHash,
        job.buyer,
        job.payee,
        atomicToWire(job.amount),
        job.deadline,
        job.fundTx,
        job.fundBlock.toString(),
        job.status ?? "funded",
        job.createdAt,
        job.resource ?? null,
        job.description ?? null,
      );
  }

  getJob(jobId: string): JobRecord | null {
    const row = this.db
      .query<JobRow, [string]>("SELECT * FROM jobs WHERE LOWER(job_id) = LOWER(?) LIMIT 1")
      .get(jobId);
    return row ? toJob(row) : null;
  }

  /** pending -> funded, once the fund transaction is seen on chain. */
  promoteJob(jobId: string, block: bigint): boolean {
    const result = this.db
      .query(
        "UPDATE jobs SET status = 'funded', fund_block = ? WHERE LOWER(job_id) = LOWER(?) AND status = 'pending'",
      )
      .run(block.toString(), jobId);
    return result.changes > 0;
  }

  /** funded -> released | cancelled | refunded. Any other starting state is left alone. */
  closeJob(
    jobId: string,
    status: "released" | "cancelled" | "refunded",
    closeTx: string,
    slipHash?: string,
    closedAt: number = Date.now(),
  ): boolean {
    const result = this.db
      .query(
        `UPDATE jobs SET status = ?, close_tx = ?, slip_hash = ?, closed_at = ?
         WHERE LOWER(job_id) = LOWER(?) AND status = 'funded'`,
      )
      .run(status, closeTx, slipHash ?? null, closedAt, jobId);
    return result.changes > 0;
  }

  listJobs(filter: JobFilter = {}): JobRecord[] {
    const conditions: string[] = [];
    const params: SQLQueryBindings[] = [];
    if (filter.payee) {
      conditions.push("LOWER(payee) = LOWER(?)");
      params.push(filter.payee);
    }
    if (filter.buyer) {
      conditions.push("LOWER(buyer) = LOWER(?)");
      params.push(filter.buyer);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.db
      .query<JobRow, SQLQueryBindings[]>(
        `SELECT * FROM jobs ${where} ORDER BY created_at DESC, rowid DESC`,
      )
      .all(...params);
    return rows.map(toJob);
  }

  /** Direct payments and escrow jobs as one list, newest first. */
  listOrders(filter: OrderFilter = {}): Order[] {
    const orders: Order[] = [];
    for (const payment of this.listPayments({ payTo: filter.merchant, payer: filter.customer })) {
      orders.push(this.paymentOrder(payment));
    }
    for (const job of this.listJobs({ payee: filter.merchant, buyer: filter.customer })) {
      orders.push(this.jobOrder(job));
    }
    return orders.sort((a, b) => b.createdAt - a.createdAt);
  }

  getOrder(id: string): Order | null {
    const payment = this.getPayment(id);
    if (payment) return this.paymentOrder(payment);
    const job = this.getJob(id);
    return job ? this.jobOrder(job) : null;
  }

  ordersCsv(merchant: string): string {
    const rows: string[] = [ORDERS_CSV_HEADER];
    for (const order of this.listOrders({ merchant })) {
      rows.push(
        [
          new Date(order.createdAt).toISOString(),
          order.id,
          order.kind,
          order.customer,
          order.merchant,
          formatUnits(order.amount, USDT.decimals),
          formatUnits(order.fee, USDT.decimals),
          formatUnits(order.refunded, USDT.decimals),
          formatSigned(order.amount - order.fee - order.refunded),
          order.status,
          txUrl(order.settleTx),
          order.closeTx ? txUrl(order.closeTx) : "",
          order.refundTxs.map((tx) => txUrl(tx)).join(" "),
        ]
          .map(csvField)
          .join(","),
      );
    }
    return `${rows.join("\n")}\n`;
  }

  private paymentOrder(payment: PaymentRecord): Order {
    const refunds = this.listRefunds(payment.id);
    const hasPending = refunds.some((refund) => refund.status === "pending");
    return {
      id: payment.id,
      kind: "exact",
      customer: payment.payer,
      merchant: payment.payTo,
      amount: payment.amount,
      fee: 0n,
      refunded: payment.refunded,
      refundable: this.refundable(payment.id),
      status:
        payment.status === "pending"
          ? "pending"
          : hasPending
            ? "refund_pending"
            : transferStatus(payment.amount, payment.refunded),
      closeKind: null,
      createdAt: payment.settledAt,
      settleTx: payment.txHash,
      closeTx: null,
      refundTxs: refunds.map((refund) => refund.txHash),
      resource: payment.resource,
      description: payment.description,
    };
  }

  private jobOrder(job: JobRecord): Order {
    const refunds = this.listRefunds(job.jobId);
    const refunded = job.status === "released" ? this.refundedFor(job.jobId) : 0n;
    const hasPending = refunds.some((refund) => refund.status === "pending");
    let status: OrderStatus;
    switch (job.status) {
      case "pending":
        status = "pending";
        break;
      case "funded":
        status = "held";
        break;
      case "released":
        status = hasPending ? "refund_pending" : transferStatus(job.amount, refunded);
        break;
      case "cancelled":
        status = "cancelled";
        break;
      case "refunded":
        status = "refunded";
        break;
    }
    return {
      id: job.jobId,
      kind: "escrow",
      customer: job.buyer,
      merchant: job.payee,
      amount: job.amount,
      fee: job.status === "released" ? this.feeFor(job.amount) : 0n,
      refunded,
      refundable: this.refundable(job.jobId),
      status,
      closeKind: closeKindOf(job.status),
      createdAt: job.createdAt,
      settleTx: job.fundTx,
      closeTx: job.closeTx,
      refundTxs: refunds.map((refund) => refund.txHash),
      offerHash: job.offerHash,
      deadline: job.deadline,
      resource: job.resource,
      description: job.description,
    };
  }

  listRefunds(paymentId: string): RefundRecord[] {
    const rows = this.db
      .query<RefundRow, [string]>(
        "SELECT * FROM refunds WHERE payment_id = ? ORDER BY rowid ASC",
      )
      .all(paymentId);
    return rows.map((row) => ({
      paymentId: row.payment_id,
      amount: BigInt(row.amount),
      txHash: row.tx_hash,
      blockNumber: BigInt(row.block_number),
      nonce: row.nonce,
      status: row.status === "pending" ? "pending" : "confirmed",
      validBefore: row.valid_before,
    }));
  }

  listPendingRefunds(paymentId: string): RefundRecord[] {
    return this.listRefunds(paymentId).filter((refund) => refund.status === "pending");
  }

  toCsv(payTo: string): string {
    const rows: string[] = [CSV_HEADER];
    for (const payment of this.listPayments({ payTo })) {
      if (payment.status !== "settled") continue;
      const refunds = this.listRefunds(payment.id);
      const status =
        refunds.some((refund) => refund.status === "pending")
          ? "refund_pending"
          : payment.refunded === 0n
            ? "paid"
            : payment.refunded >= payment.amount
              ? "refunded"
              : "partially_refunded";
      rows.push(
        [
          new Date(payment.settledAt).toISOString(),
          payment.id,
          payment.payer,
          payment.payTo,
          formatUnits(payment.amount, USDT.decimals),
          formatUnits(payment.refunded, USDT.decimals),
          formatUnits(payment.amount - payment.refunded, USDT.decimals),
          status,
          txUrl(payment.txHash),
          refunds.map((refund) => txUrl(refund.txHash)).join(" "),
        ]
          .map(csvField)
          .join(","),
      );
    }
    return `${rows.join("\n")}\n`;
  }

  close(): void {
    this.db.close();
  }

  private insert(payment: NewPayment, status: PaymentStatus): void {
    this.db
      .query(
        `INSERT INTO payments
          (id, network, payer, pay_to, amount, nonce, tx_hash, block_number, settled_at, resource, description, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        payment.id,
        payment.network,
        payment.payer,
        payment.payTo,
        atomicToWire(payment.amount),
        payment.nonce,
        payment.txHash,
        payment.blockNumber.toString(),
        payment.settledAt,
        payment.resource ?? null,
        payment.description ?? null,
        status,
      );
  }

  private toPayment(row: PaymentRow): PaymentRecord {
    return {
      id: row.id,
      network: row.network,
      payer: row.payer,
      payTo: row.pay_to,
      amount: BigInt(row.amount),
      nonce: row.nonce,
      txHash: row.tx_hash,
      blockNumber: BigInt(row.block_number),
      settledAt: row.settled_at,
      resource: row.resource,
      description: row.description,
      status: row.status === "pending" ? "pending" : "settled",
      refunded: this.refundedFor(row.id),
    };
  }

  private refundedFor(paymentId: string): bigint {
    return this.listRefunds(paymentId)
      .filter((refund) => refund.status === "confirmed")
      .reduce((total, refund) => total + refund.amount, 0n);
  }

  private reservedFor(paymentId: string): bigint {
    return this.listRefunds(paymentId).reduce((total, refund) => total + refund.amount, 0n);
  }

  private feeFor(amount: bigint): bigint {
    return (amount * BigInt(this.tollBps)) / 10_000n;
  }

  private migrate(): void {
    const columns = this.db
      .query<{ name: string }, []>("PRAGMA table_info(refunds)")
      .all();
    const names = new Set(columns.map((column) => column.name));
    if (!names.has("status")) {
      this.db.exec("ALTER TABLE refunds ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed'");
    }
    if (!names.has("valid_before")) {
      this.db.exec("ALTER TABLE refunds ADD COLUMN valid_before INTEGER NOT NULL DEFAULT 0");
    }
    for (const table of ["payments", "jobs"] as const) {
      const existing = this.db
        .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
        .all();
      if (!existing.some((column) => column.name === "description")) {
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN description TEXT`);
      }
    }
  }
}

function closeKindOf(status: JobStatus): CloseKind | null {
  switch (status) {
    case "released":
      return "release";
    case "cancelled":
      return "cancel";
    case "refunded":
      return "deadline_refund";
    case "pending":
    case "funded":
      return null;
  }
}

function transferStatus(amount: bigint, refunded: bigint): OrderStatus {
  if (refunded === 0n) return "paid";
  return refunded >= amount ? "refunded" : "partially_refunded";
}

function toJob(row: JobRow): JobRecord {
  const status = (["pending", "funded", "released", "cancelled", "refunded"] as const).find(
    (value) => value === row.status,
  );
  return {
    jobId: row.job_id,
    offerHash: row.offer_hash,
    buyer: row.buyer,
    payee: row.payee,
    amount: BigInt(row.amount),
    deadline: row.deadline,
    fundTx: row.fund_tx,
    fundBlock: BigInt(row.fund_block),
    status: status ?? "pending",
    closeTx: row.close_tx,
    slipHash: row.slip_hash,
    createdAt: row.created_at,
    closedAt: row.closed_at,
    resource: row.resource,
    description: row.description,
  };
}

function formatSigned(value: bigint): string {
  return value < 0n
    ? `-${formatUnits(-value, USDT.decimals)}`
    : formatUnits(value, USDT.decimals);
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
