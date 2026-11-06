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
`;

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

  refundable(paymentId: string): bigint {
    const payment = this.getPayment(paymentId);
    if (!payment || payment.status !== "settled") return 0n;
    const remaining = payment.amount - payment.refunded;
    return remaining > 0n ? remaining : 0n;
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

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
