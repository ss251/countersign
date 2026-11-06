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
  status: PaymentStatus;
  refunded: bigint;
};

export type RefundRecord = {
  paymentId: string;
  amount: bigint;
  txHash: string;
  blockNumber: bigint;
  nonce: string;
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
};

export type JobFilter = {
  payee?: string;
  buyer?: string;
};

export type OrderKind = "exact" | "escrow";
export type OrderStatus =
  | "paid"
  | "partially_refunded"
  | "refunded"
  | "pending"
  | "held"
  | "cancelled";

export type Order = {
  id: string;
  kind: OrderKind;
  customer: string;
  merchant: string;
  amount: bigint;
  refunded: bigint;
  refundable: bigint;
  status: OrderStatus;
  createdAt: number;
  settleTx: string;
  closeTx: string | null;
  refundTxs: string[];
  offerHash?: string;
  deadline?: number;
  resource?: string | null;
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
  status: string;
};

type RefundRow = {
  payment_id: string;
  amount: string;
  tx_hash: string;
  block_number: string;
  nonce: string;
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
    status TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS payments_authorization
    ON payments (payer, nonce);
  CREATE TABLE IF NOT EXISTS refunds (
    payment_id TEXT NOT NULL,
    amount TEXT NOT NULL,
    tx_hash TEXT NOT NULL,
    block_number TEXT NOT NULL,
    nonce TEXT NOT NULL
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
    resource TEXT
  );
  CREATE INDEX IF NOT EXISTS jobs_payee ON jobs (payee);
  CREATE INDEX IF NOT EXISTS jobs_buyer ON jobs (buyer);
`;

const ORDERS_CSV_HEADER =
  "date_utc,order_id,kind,customer,merchant,amount_usdt,refunded_usdt,net_usdt,status,settle_tx_url,close_tx_url,refund_tx_urls";

const CSV_HEADER =
  "date_utc,payment_id,payer,merchant,amount_usdt,refunded_usdt,net_usdt,status,settle_tx_url,refund_tx_urls";

export class Ledger {
  private readonly db: Database;

  constructor(path: string) {
    this.db = new Database(path, { create: true });
    this.db.exec(SCHEMA);
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

  recordRefund(refund: RefundRecord): void {
    this.db
      .query(
        "INSERT INTO refunds (payment_id, amount, tx_hash, block_number, nonce) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        refund.paymentId,
        atomicToWire(refund.amount),
        refund.txHash,
        refund.blockNumber.toString(),
        refund.nonce,
      );
  }

  refundable(id: string): bigint {
    const payment = this.getPayment(id);
    if (payment) {
      if (payment.status !== "settled") return 0n;
      const remaining = payment.amount - payment.refunded;
      return remaining > 0n ? remaining : 0n;
    }
    const job = this.getJob(id);
    if (!job || job.status !== "released") return 0n;
    const remaining = job.amount - this.refundedFor(job.jobId);
    return remaining > 0n ? remaining : 0n;
  }

  recordJob(job: NewJob): void {
    this.db
      .query(
        `INSERT INTO jobs
          (job_id, offer_hash, buyer, payee, amount, deadline, fund_tx, fund_block, status, created_at, resource)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          formatUnits(order.refunded, USDT.decimals),
          formatUnits(order.amount - order.refunded, USDT.decimals),
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
    return {
      id: payment.id,
      kind: "exact",
      customer: payment.payer,
      merchant: payment.payTo,
      amount: payment.amount,
      refunded: payment.refunded,
      refundable: this.refundable(payment.id),
      status: payment.status === "pending" ? "pending" : transferStatus(payment.amount, payment.refunded),
      createdAt: payment.settledAt,
      settleTx: payment.txHash,
      closeTx: null,
      refundTxs: refunds.map((refund) => refund.txHash),
      resource: payment.resource,
    };
  }

  private jobOrder(job: JobRecord): Order {
    const refunds = this.listRefunds(job.jobId);
    const refunded = refunds.reduce((total, refund) => total + refund.amount, 0n);
    let status: OrderStatus;
    switch (job.status) {
      case "pending":
        status = "pending";
        break;
      case "funded":
        status = "held";
        break;
      case "released":
        status = transferStatus(job.amount, refunded);
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
      refunded: job.status === "released" ? refunded : 0n,
      refundable: this.refundable(job.jobId),
      status,
      createdAt: job.createdAt,
      settleTx: job.fundTx,
      closeTx: job.closeTx,
      refundTxs: refunds.map((refund) => refund.txHash),
      offerHash: job.offerHash,
      deadline: job.deadline,
      resource: job.resource,
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
    }));
  }

  toCsv(payTo: string): string {
    const rows: string[] = [CSV_HEADER];
    for (const payment of this.listPayments({ payTo })) {
      if (payment.status !== "settled") continue;
      const refunds = this.listRefunds(payment.id);
      const status =
        payment.refunded === 0n
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
          (id, network, payer, pay_to, amount, nonce, tx_hash, block_number, settled_at, resource, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      status: row.status === "pending" ? "pending" : "settled",
      refunded: this.refundedFor(row.id),
    };
  }

  private refundedFor(paymentId: string): bigint {
    return this.listRefunds(paymentId).reduce((total, refund) => total + refund.amount, 0n);
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
  };
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
