import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NETWORK, txUrl } from "../src/chain.ts";
import { Ledger } from "../src/ledger.ts";
import { fakeHash, fakeNonce } from "./support.ts";

const MERCHANT = "0x2222222222222222222222222222222222222222";
const PAYER = "0x1111111111111111111111111111111111111111";
const HEADER =
  "date_utc,payment_id,payer,merchant,amount_usdt,refunded_usdt,net_usdt,status,settle_tx_url,refund_tx_urls";

function payment(
  id: string,
  amount: bigint,
  settledAt: number,
  overrides: { payTo?: string; payer?: string } = {},
) {
  return {
    id,
    network: NETWORK,
    payer: overrides.payer ?? PAYER,
    payTo: overrides.payTo ?? MERCHANT,
    amount,
    nonce: fakeNonce(),
    txHash: id,
    blockNumber: 42n,
    settledAt,
  };
}

describe("ledger", () => {
  test("writes the RFC 4180 CSV with statuses", () => {
    const ledger = new Ledger(":memory:");
    const paid = fakeHash();
    const partial = fakeHash();
    const full = fakeHash();
    ledger.recordPayment(payment(paid, 2_000_000n, Date.UTC(2026, 0, 2)));
    ledger.recordPayment(payment(partial, 1_500_000n, Date.UTC(2026, 0, 3)));
    ledger.recordPayment(payment(full, 3_000_000n, Date.UTC(2026, 0, 4)));
    ledger.recordRefund({
      paymentId: partial,
      amount: 500_000n,
      txHash: fakeHash(),
      blockNumber: 43n,
      nonce: fakeNonce(),
    });
    ledger.recordRefund({
      paymentId: full,
      amount: 3_000_000n,
      txHash: fakeHash(),
      blockNumber: 44n,
      nonce: fakeNonce(),
    });

    const csv = ledger.toCsv(MERCHANT);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe(HEADER);
    expect(lines).toHaveLength(4);

    const byId = new Map<string, string[]>();
    for (const line of lines.slice(1)) {
      const fields = line.split(",");
      byId.set(fields[1] as string, fields);
    }
    expect(byId.get(paid)?.[4]).toBe("2");
    expect(byId.get(paid)?.[5]).toBe("0");
    expect(byId.get(paid)?.[6]).toBe("2");
    expect(byId.get(paid)?.[7]).toBe("paid");
    expect(byId.get(partial)?.[7]).toBe("partially_refunded");
    expect(byId.get(partial)?.[5]).toBe("0.5");
    expect(byId.get(full)?.[7]).toBe("refunded");
    expect(byId.get(full)?.[6]).toBe("0");
    expect(ledger.refundable(full)).toBe(0n);
  });

  test("quotes fields with commas and quotes", () => {
    const ledger = new Ledger(":memory:");
    ledger.recordPayment(
      payment(fakeHash(), 1_000_000n, Date.UTC(2026, 0, 5), {
        payer: '0xabc,"def"',
      }),
    );
    const csv = ledger.toCsv(MERCHANT);
    expect(csv).toContain('"0xabc,""def"""');
  });

  test("joins refund transaction URLs with a space", () => {
    const ledger = new Ledger(":memory:");
    const id = fakeHash();
    const first = fakeHash();
    const second = fakeHash();
    ledger.recordPayment(payment(id, 1_000_000n, Date.UTC(2026, 0, 6)));
    ledger.recordRefund({
      paymentId: id,
      amount: 400_000n,
      txHash: first,
      blockNumber: 1n,
      nonce: fakeNonce(),
    });
    ledger.recordRefund({
      paymentId: id,
      amount: 100_000n,
      txHash: second,
      blockNumber: 2n,
      nonce: fakeNonce(),
    });
    const csv = ledger.toCsv(MERCHANT);
    const row = csv.trim().split("\n")[1] as string;
    expect(row).toContain(`${txUrl(first)} ${txUrl(second)}`);
    expect(ledger.listRefunds(id)).toHaveLength(2);
  });

  test("skips pending payments in the CSV and lists newest first", () => {
    const ledger = new Ledger(":memory:");
    const older = fakeHash();
    const newer = fakeHash();
    const pending = fakeHash();
    ledger.recordPayment(payment(older, 1_000_000n, 1000));
    ledger.recordPayment(payment(newer, 1_000_000n, 2000));
    ledger.recordPending({ ...payment(pending, 1_000_000n, 3000), txHash: pending });
    const listed = ledger.listPayments({ payTo: MERCHANT });
    expect(listed.map((row) => row.id)).toEqual([pending, newer, older]);
    expect(ledger.toCsv(MERCHANT)).not.toContain(pending);
  });

  test("finds a payment by authorization and promotes a pending row", () => {
    const ledger = new Ledger(":memory:");
    const id = fakeHash();
    const nonce = fakeNonce();
    ledger.recordPending({ ...payment(id, 1_000_000n, 1000), nonce, txHash: id });
    expect(ledger.getPayment(id)?.status).toBe("pending");
    expect(ledger.findByAuthorization(PAYER, nonce)?.id).toBe(id);
    ledger.promotePending(id, { blockNumber: 77n, settledAt: 5000 });
    expect(ledger.getPayment(id)?.status).toBe("settled");
    expect(ledger.getPayment(id)?.blockNumber).toBe(77n);
  });

  test("adds the description column to a database from before it", () => {
    const path = join(tmpdir(), `countersign-ledger-${crypto.randomUUID()}.sqlite`);
    const old = new Database(path, { create: true });
    old.exec(`
      CREATE TABLE payments (
        id TEXT PRIMARY KEY, network TEXT NOT NULL, payer TEXT NOT NULL, pay_to TEXT NOT NULL,
        amount TEXT NOT NULL, nonce TEXT NOT NULL, tx_hash TEXT NOT NULL,
        block_number TEXT NOT NULL, settled_at INTEGER NOT NULL, resource TEXT, status TEXT NOT NULL
      );
      CREATE TABLE jobs (
        job_id TEXT PRIMARY KEY, offer_hash TEXT NOT NULL, buyer TEXT NOT NULL, payee TEXT NOT NULL,
        amount TEXT NOT NULL, deadline INTEGER NOT NULL, fund_tx TEXT NOT NULL,
        fund_block TEXT NOT NULL, status TEXT NOT NULL, close_tx TEXT, slip_hash TEXT,
        created_at INTEGER NOT NULL, closed_at INTEGER, resource TEXT
      );
    `);
    old.close();

    const ledger = new Ledger(path);
    const id = fakeHash();
    ledger.recordPayment({
      ...payment(id, 1_000_000n, 1000),
      description: "Nightly build minutes",
    });
    expect(ledger.getPayment(id)?.description).toBe("Nightly build minutes");
    const jobId = fakeHash();
    ledger.recordJob({
      jobId,
      offerHash: fakeHash(),
      buyer: PAYER,
      payee: MERCHANT,
      amount: 1_000_000n,
      deadline: 2000,
      fundTx: fakeHash(),
      fundBlock: 1n,
      createdAt: 1000,
      description: "Custom settlement review",
    });
    expect(ledger.getJob(jobId)?.description).toBe("Custom settlement review");
    ledger.close();
    rmSync(path, { force: true });
  });

  test("adds the refund reason, refund time and close reason to a database from before them", () => {
    const path = join(tmpdir(), `countersign-ledger-${crypto.randomUUID()}.sqlite`);
    const old = new Database(path, { create: true });
    old.exec(`
      CREATE TABLE refunds (
        payment_id TEXT NOT NULL, amount TEXT NOT NULL, tx_hash TEXT NOT NULL,
        block_number TEXT NOT NULL, nonce TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'confirmed', valid_before INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE jobs (
        job_id TEXT PRIMARY KEY, offer_hash TEXT NOT NULL, buyer TEXT NOT NULL, payee TEXT NOT NULL,
        amount TEXT NOT NULL, deadline INTEGER NOT NULL, fund_tx TEXT NOT NULL,
        fund_block TEXT NOT NULL, status TEXT NOT NULL, close_tx TEXT, slip_hash TEXT,
        created_at INTEGER NOT NULL, closed_at INTEGER, resource TEXT
      );
      INSERT INTO refunds (payment_id, amount, tx_hash, block_number, nonce)
        VALUES ('0xold', '100', '0xtx', '1', '0xn');
    `);
    old.close();

    const ledger = new Ledger(path);
    expect(ledger.listRefunds("0xold").map((refund) => [refund.reason, refund.at])).toEqual([
      [null, null],
    ]);
    const paymentId = fakeHash();
    ledger.recordRefund({
      paymentId,
      amount: 400_000n,
      txHash: fakeHash(),
      blockNumber: 1n,
      nonce: fakeNonce(),
      reason: "duplicate",
      at: 1234,
    });
    expect(ledger.listRefunds(paymentId).map((refund) => [refund.reason, refund.at])).toEqual([
      ["duplicate", 1234],
    ]);

    const jobId = fakeHash();
    ledger.recordJob({
      jobId,
      offerHash: fakeHash(),
      buyer: PAYER,
      payee: MERCHANT,
      amount: 1_000_000n,
      deadline: 2000,
      fundTx: fakeHash(),
      fundBlock: 1n,
      createdAt: 1000,
    });
    expect(ledger.closeJob(jobId, "cancelled", fakeHash(), undefined, 5000, "other")).toBe(true);
    expect(ledger.getJob(jobId)?.closeReason).toBe("other");
    ledger.close();
    rmSync(path, { force: true });
  });
});
