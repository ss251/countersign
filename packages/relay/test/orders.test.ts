import { describe, expect, test } from "bun:test";
import { txUrl } from "../src/chain.ts";
import { Ledger } from "../src/ledger.ts";
import { fakeHash, fakeNonce } from "./support.ts";

const MERCHANT = "0x2222222222222222222222222222222222222222";
const OTHER = "0x5555555555555555555555555555555555555555";
const CUSTOMER = "0x1111111111111111111111111111111111111111";
const HEADER =
  "date_utc,order_id,kind,customer,merchant,amount_usdt,refunded_usdt,net_usdt,status,settle_tx_url,close_tx_url,refund_tx_urls";

let counter = 0;
function jobId(): string {
  counter += 1;
  return `0x${counter.toString(16).padStart(64, "a")}`;
}

function newJob(id: string, createdAt: number, overrides: { payee?: string; amount?: bigint; status?: "pending" | "funded" } = {}) {
  return {
    jobId: id,
    offerHash: `0x${"0f".repeat(32)}`,
    buyer: CUSTOMER,
    payee: overrides.payee ?? MERCHANT,
    amount: overrides.amount ?? 1_500_000n,
    deadline: 1_760_000_120,
    fundTx: fakeHash(),
    fundBlock: 7n,
    status: overrides.status,
    createdAt,
  };
}

function newPayment(id: string, settledAt: number, amount = 2_000_000n) {
  return {
    id,
    network: "eip155:1874",
    payer: CUSTOMER,
    payTo: MERCHANT,
    amount,
    nonce: fakeNonce(),
    txHash: id,
    blockNumber: 3n,
    settledAt,
  };
}

describe("jobs ledger", () => {
  test("closeJob only moves a funded job; promoteJob only a pending one", () => {
    const ledger = new Ledger(":memory:");
    const id = jobId();
    ledger.recordJob(newJob(id, 1000, { status: "pending" }));
    expect(ledger.closeJob(id, "released", fakeHash())).toBe(false);
    expect(ledger.promoteJob(id, 9n)).toBe(true);
    expect(ledger.getJob(id)!.status).toBe("funded");
    expect(ledger.getJob(id)!.fundBlock).toBe(9n);
    expect(ledger.promoteJob(id, 10n)).toBe(false);
    const close = fakeHash();
    expect(ledger.closeJob(id, "released", close, "0xslip", 5000)).toBe(true);
    expect(ledger.closeJob(id, "cancelled", fakeHash())).toBe(false);
    const job = ledger.getJob(id)!;
    expect([job.status, job.closeTx, job.slipHash, job.closedAt]).toEqual(["released", close, "0xslip", 5000]);
  });

  test("listJobs filters by payee and buyer, newest first", () => {
    const ledger = new Ledger(":memory:");
    const a = jobId();
    const b = jobId();
    const c = jobId();
    ledger.recordJob(newJob(a, 1000));
    ledger.recordJob(newJob(b, 3000));
    ledger.recordJob(newJob(c, 2000, { payee: OTHER }));
    expect(ledger.listJobs({ payee: MERCHANT }).map((j) => j.jobId)).toEqual([b, a]);
    expect(ledger.listJobs({ buyer: CUSTOMER }).map((j) => j.jobId)).toEqual([b, c, a]);
  });
});

describe("orders", () => {
  function seeded() {
    const ledger = new Ledger(":memory:");
    const held = jobId();
    const released = jobId();
    const cancelled = jobId();
    const refunded = jobId();
    const pending = jobId();
    const elsewhere = jobId();
    const paid = fakeHash();
    const partial = fakeHash();
    ledger.recordPayment(newPayment(paid, 1000));
    ledger.recordPayment(newPayment(partial, 2000, 3_000_000n));
    ledger.recordRefund({ paymentId: partial, amount: 1_000_000n, txHash: fakeHash(), blockNumber: 4n, nonce: fakeNonce() });
    ledger.recordJob(newJob(held, 3000));
    ledger.recordJob(newJob(released, 4000));
    ledger.recordJob(newJob(cancelled, 5000));
    ledger.recordJob(newJob(refunded, 6000));
    ledger.recordJob(newJob(pending, 7000, { status: "pending" }));
    ledger.recordJob(newJob(elsewhere, 8000, { payee: OTHER }));
    ledger.closeJob(released, "released", fakeHash(), "0xs");
    ledger.closeJob(cancelled, "cancelled", fakeHash());
    ledger.closeJob(refunded, "refunded", fakeHash());
    return { ledger, held, released, cancelled, refunded, pending, elsewhere, paid, partial };
  }

  test("one list of payments and jobs, newest first, with the status mapping", () => {
    const s = seeded();
    const orders = s.ledger.listOrders({ merchant: MERCHANT });
    expect(orders.map((o) => o.id)).toEqual([s.pending, s.refunded, s.cancelled, s.released, s.held, s.partial, s.paid]);
    const by = Object.fromEntries(orders.map((o) => [o.id, o]));
    expect(by[s.paid]!.kind).toBe("exact");
    expect([s.paid, s.partial, s.held, s.released, s.cancelled, s.refunded, s.pending].map((id) => by[id]!.status)).toEqual([
      "paid",
      "partially_refunded",
      "held",
      "paid",
      "cancelled",
      "refunded",
      "pending",
    ]);
    expect(by[s.held]!.kind).toBe("escrow");
    expect(by[s.partial]!.refunded).toBe(1_000_000n);
    expect(by[s.partial]!.refundable).toBe(2_000_000n);
    expect(by[s.released]!.refundable).toBe(1_500_000n);
    for (const id of [s.held, s.cancelled, s.refunded, s.pending]) expect(by[id]!.refundable).toBe(0n);
    expect(s.ledger.listOrders({ merchant: OTHER }).map((o) => o.id)).toEqual([s.elsewhere]);
    expect(s.ledger.listOrders({ customer: CUSTOMER })).toHaveLength(8);
    expect(s.ledger.listOrders({ customer: OTHER })).toHaveLength(0);
  });

  test("a transfer refund against a released job reuses the refunds table", () => {
    const s = seeded();
    const tx = fakeHash();
    s.ledger.recordRefund({ paymentId: s.released, amount: 500_000n, txHash: tx, blockNumber: 5n, nonce: fakeNonce() });
    let order = s.ledger.getOrder(s.released)!;
    expect([order.status, order.refunded, order.refundable, order.refundTxs]).toEqual(["partially_refunded", 500_000n, 1_000_000n, [tx]]);
    s.ledger.recordRefund({ paymentId: s.released, amount: 1_000_000n, txHash: fakeHash(), blockNumber: 6n, nonce: fakeNonce() });
    order = s.ledger.getOrder(s.released)!;
    expect([order.status, order.refundable]).toEqual(["refunded", 0n]);
    // a held job has nothing to transfer back
    expect(s.ledger.refundable(s.held)).toBe(0n);
  });

  test("ordersCsv has the header and one row per order", () => {
    const s = seeded();
    const refundTx = fakeHash();
    s.ledger.recordRefund({ paymentId: s.released, amount: 500_000n, txHash: refundTx, blockNumber: 5n, nonce: fakeNonce() });
    const lines = s.ledger.ordersCsv(MERCHANT).trimEnd().split("\n");
    expect(lines[0]).toBe(HEADER);
    expect(lines).toHaveLength(8);
    const job = s.ledger.getJob(s.released)!;
    const row = lines.find((l) => l.includes(s.released))!;
    expect(row).toBe(
      [
        new Date(4000).toISOString(),
        s.released,
        "escrow",
        CUSTOMER,
        MERCHANT,
        "1.5",
        "0.5",
        "1",
        "partially_refunded",
        txUrl(job.fundTx),
        txUrl(job.closeTx!),
        txUrl(refundTx),
      ].join(","),
    );
    const held = lines.find((l) => l.includes(s.held))!;
    expect(held.split(",")[10]).toBe("");
  });

  test("toCsv still writes the payments-only export", () => {
    const s = seeded();
    expect(s.ledger.toCsv(MERCHANT).split("\n")[0]).toBe(
      "date_utc,payment_id,payer,merchant,amount_usdt,refunded_usdt,net_usdt,status,settle_tx_url,refund_tx_urls",
    );
  });
});
