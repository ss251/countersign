import { describe, expect, test } from "bun:test";
import {
  addressUrl,
  canRefund,
  formatUsdt,
  humanDate,
  itemLabel,
  normalizeRefundReply,
  wasReceived,
  formatWbt,
  formatWeiWbt,
  refundLabel,
  relativeTime,
  shortAddress,
  shortHash,
  statusLabel,
  statusTone,
  totals,
  txUrl,
  type Order,
} from "../src/routes/merchant/model.ts";
import { fixtureCsv, fixtureOrders, fixtureRefundTx, findFixtureOrder } from "../src/routes/merchant/fixtures.ts";
import { offersRefund } from "../src/routes/merchant/Panel.tsx";
import { NOT_SERVED, fetchOrder, fetchOrders } from "../src/routes/merchant/api.ts";
import {
  ORDERS_CSV_HEADER,
  assetOf,
  explorerOf,
  fromHubOrder,
  fromHubRecord,
  networkNameOf,
  ordersCsv,
} from "../src/routes/merchant/model.ts";
import {
  adjustments,
  checkRefundAmount,
  contribution,
  decimalsFor,
  equation,
  filterCounts,
  formatFixed,
  ledger,
  matchesFilter,
  reasonLabel,
  receivedAt,
  timeline,
} from "../src/routes/merchant/model.ts";

describe("formatUsdt", () => {
  test("formats atomic amounts without floats", () => {
    expect(formatUsdt("0")).toBe("0.00");
    expect(formatUsdt("1")).toBe("0.000001");
    expect(formatUsdt("250000")).toBe("0.25");
    expect(formatUsdt("1000000")).toBe("1.00");
    expect(formatUsdt("1234567")).toBe("1.234567");
    expect(formatUsdt("100000000")).toBe("100.00");
  });

  test("keeps two decimals and drops zeros beyond them", () => {
    expect(formatUsdt("120000")).toBe("0.12");
    expect(formatUsdt("105000")).toBe("0.105");
    expect(formatUsdt("1250000")).toBe("1.25");
    expect(formatUsdt("1230000")).toBe("1.23");
  });
});

describe("status vocabulary", () => {
  const statuses = [
    "pending",
    "held",
    "paid",
    "partially_refunded",
    "refunded",
    "cancelled",
  ] as const;

  test("labels every status", () => {
    expect(statusLabel("pending")).toBe("Settling");
    expect(statusLabel("held")).toBe("Held in escrow");
    expect(statusLabel("paid")).toBe("Paid");
    expect(statusLabel("partially_refunded")).toBe("Partly refunded");
    expect(statusLabel("refunded")).toBe("Refunded");
    expect(statusLabel("cancelled")).toBe("Cancelled");
    for (const status of statuses) expect(statusLabel(status).length).toBeGreaterThan(0);
  });

  test("green is paid, blue is money in flight, returned money is ink", () => {
    expect(statuses.map((status) => [status, statusTone(status)])).toEqual([
      ["pending", "money"],
      ["held", "money"],
      ["paid", "settled"],
      ["partially_refunded", "neutral"],
      ["refunded", "neutral"],
      ["cancelled", "neutral"],
    ]);
    expect(statusTone("refund_pending")).toBe("money");
  });
});

describe("refunds", () => {
  test("allows every state with money left", () => {
    expect(canRefund({ status: "paid", refundable: "250000" })).toBe(true);
    expect(canRefund({ status: "held", refundable: "400000" })).toBe(true);
    expect(canRefund({ status: "partially_refunded", refundable: "750000" })).toBe(true);
  });

  test("refuses closed states and empty balances", () => {
    expect(canRefund({ status: "pending", refundable: "250000" })).toBe(false);
    expect(canRefund({ status: "refunded", refundable: "0" })).toBe(false);
    expect(canRefund({ status: "cancelled", refundable: "250000" })).toBe(false);
    expect(canRefund({ status: "paid", refundable: "0" })).toBe(false);
  });

  test("labels held and paid refunds", () => {
    expect(refundLabel({ status: "held", refundable: "400000" })).toBe("Cancel and refund 0.40");
    expect(refundLabel({ status: "paid", refundable: "1500000" })).toBe("Refund 1.50");
  });
});

describe("totals", () => {
  test("sums the fixtures: held money is not received money", () => {
    expect(totals(fixtureOrders)).toEqual({
      received: "1350000",
      held: "400000",
      refunded: "500000",
      fees: "500",
      net: "849500",
      netNegative: false,
      count: 6,
    });
  });

  const base = fixtureOrders[0]!;
  const order = (patch: Partial<Order>): Order => ({ ...base, ...patch });

  test("a held escrow order is held, not received", () => {
    const sums = totals([order({ kind: "escrow", status: "held", amount: "400000", closeKind: null })]);
    expect(sums.held).toBe("400000");
    expect(sums.received).toBe("0");
  });

  test("cancelled and deadline-refunded escrow orders were never received", () => {
    const sums = totals([
      order({ kind: "escrow", status: "cancelled", amount: "300000", closeKind: "cancel" }),
      order({ kind: "escrow", status: "refunded", amount: "200000", closeKind: "deadline_refund" }),
    ]);
    expect(sums).toMatchObject({ received: "0", held: "0", refunded: "0", net: "0" });
  });

  test("a released order is received less its toll, and a transfer refund comes off net", () => {
    const sums = totals([
      order({ kind: "escrow", status: "refunded", amount: "50000", fee: "500", refunded: "50000", closeKind: "release" }),
    ]);
    expect(sums).toMatchObject({ received: "50000", fees: "500", refunded: "50000", net: "500", netNegative: true });
  });

  test("a pending direct payment is not received yet", () => {
    expect(totals([order({ status: "pending", amount: "990000" })]).received).toBe("0");
  });
});

describe("wasReceived", () => {
  test("direct payments once settled, escrow orders only when released", () => {
    expect(wasReceived({ kind: "exact", status: "paid", closeKind: null })).toBe(true);
    expect(wasReceived({ kind: "exact", status: "pending", closeKind: null })).toBe(false);
    expect(wasReceived({ kind: "escrow", status: "held", closeKind: null })).toBe(false);
    expect(wasReceived({ kind: "escrow", status: "paid", closeKind: "release" })).toBe(true);
    expect(wasReceived({ kind: "escrow", status: "cancelled", closeKind: "cancel" })).toBe(false);
  });
});

describe("itemLabel", () => {
  const id = "0x4dc460652c20607ee4a16f699c90f3a0bb94b3ce3696099932cbeb1d95fd42bc";
  test("prefers the description, then the hub title, then the URL, then the id", () => {
    expect(itemLabel({ id, description: "Mumbai weather forecast", resource: "https://x" }, "title")).toBe(
      "Mumbai weather forecast",
    );
    expect(itemLabel({ id, description: null, resource: "https://x" }, "whitechain-dev")).toBe("whitechain-dev");
    expect(itemLabel({ id, description: " ", resource: "https://x/y" }, null)).toBe("Y");
    expect(itemLabel({ id }, null)).toBe("Order 0x4dc4…42bc");
  });

  test("never shows a raw URL: the last path segment becomes the label", () => {
    expect(itemLabel({ id, resource: "http://127.0.0.1:8404/forecast" }, null)).toBe("Forecast");
    expect(itemLabel({ id, resource: "https://countersign.local/whitechain/checkout" }, null)).toBe("Checkout");
    expect(itemLabel({ id, resource: "https://shop.example/reports/weekly-report.json?x=1" }, null)).toBe("Weekly report");
    expect(itemLabel({ id, resource: "http://127.0.0.1:8402/" }, null)).toBe("Order 0x4dc4…42bc");
    expect(itemLabel({ id, resource: "https://x/orders/0x4dc4" }, null)).toBe("Order 0x4dc4…42bc");
  });
});

describe("timestamps from the relay", () => {
  test("an escrow deadline in seconds is read as seconds", () => {
    const order = fromHubOrder({ ...fixtureOrders[2]!, createdAt: 1_793_958_584_000, deadline: 1_793_962_184 })!;
    expect(order.deadline).toBe(1_793_962_184_000);
    expect(order.createdAt).toBe(1_793_958_584_000);
    expect(new Date(order.deadline!).getUTCFullYear()).toBe(2026);
  });
});

describe("humanDate", () => {
  test("reads like a person writes it: day, short month, year, 24 h time and the zone", () => {
    expect(humanDate(Date.UTC(2026, 10, 6, 9, 2, 19))).toMatch(/^6 Nov 2026, \d{2}:\d{2}( \S+)?$/);
  });
});

describe("normalizeRefundReply", () => {
  test("a transfer refund reply", () => {
    expect(
      normalizeRefundReply({ ok: true, txHash: "0xaa", txUrl: "u", refunded: "250000", remaining: "0" }, 200),
    ).toEqual({ ok: true, txHash: "0xaa", refunded: "250000" });
  });

  test("a cancel reply is a success too, without an amount", () => {
    expect(normalizeRefundReply({ ok: true, transaction: "0xbb", url: "u", status: "cancelled" }, 200)).toEqual({
      ok: true,
      txHash: "0xbb",
    });
  });

  test("a refusal keeps its reason; junk is not a reply", () => {
    expect(normalizeRefundReply({ ok: false, reason: "not_refundable" }, 409)).toEqual({
      ok: false,
      reason: "not_refundable",
    });
    expect(normalizeRefundReply({ ok: false }, 502)).toEqual({ ok: false, reason: "http_502" });
    expect(normalizeRefundReply({ ok: true }, 200)).toBeNull();
    expect(normalizeRefundReply("nope", 200)).toBeNull();
  });
});

describe("fixtures", () => {
  test("no transaction hash appears twice", () => {
    const hashes = fixtureOrders.flatMap((o) => [o.settleTx, ...(o.closeTx ? [o.closeTx] : []), ...o.refundTxs]);
    hashes.push(...fixtureOrders.map((o) => fixtureRefundTx(o.id)));
    expect(new Set(hashes.map((h) => h.toLowerCase())).size).toBe(hashes.length);
  });

  test("the fixture export has the relay's columns", () => {
    expect(fixtureCsv().split("\n")[0]).toBe(
      "date_utc,order_id,kind,customer,merchant,amount_usdt,fee_usdt,refunded_usdt,net_usdt,status,settle_tx_url,close_tx_url,refund_tx_urls",
    );
  });
});

describe("relativeTime", () => {
  const now = new Date(2026, 4, 20, 12, 0, 0).getTime();

  test("uses minutes below an hour", () => {
    expect(relativeTime(now, now)).toBe("just now");
    expect(relativeTime(now - 59_999, now)).toBe("just now");
    expect(relativeTime(now - 60_000, now)).toBe("1 min ago");
    expect(relativeTime(now - 2 * 60_000, now)).toBe("2 min ago");
    expect(relativeTime(now - 59 * 60_000, now)).toBe("59 min ago");
  });

  test("uses hours below a day", () => {
    expect(relativeTime(now - 60 * 60_000, now)).toBe("1 h ago");
    expect(relativeTime(now - 23 * 60 * 60_000, now)).toBe("23 h ago");
  });

  test("uses a short date after a day", () => {
    expect(relativeTime(now - 24 * 60 * 60_000, now)).toBe("19 May 2026");
    const old = new Date(2026, 0, 15, 12, 0, 0).getTime();
    const later = new Date(2026, 0, 17, 12, 0, 0).getTime();
    expect(relativeTime(old, later)).toBe("15 Jan 2026");
  });
});

describe("identifiers and links", () => {
  test("shortens addresses and hashes", () => {
    expect(shortAddress("0xcb39cEfBF97d1FE8b0606f25721F6F9E32924298")).toBe("0xcb39…4298");
    expect(shortHash("0x4dc460652c20607ee4a16f699c90f3a0bb94b3ce3696099932cbeb1d95fd42bc")).toBe(
      "0x4dc4…42bc",
    );
  });

  test("builds explorer links", () => {
    expect(txUrl("0xabc")).toBe("https://explorer.testnet.whitechain.io/tx/0xabc");
    expect(addressUrl("0xdef")).toBe("https://explorer.testnet.whitechain.io/address/0xdef");
  });

  test("formats relay gas figures to four decimals", () => {
    expect(formatWeiWbt("11340000000000000")).toBe("0.0113");
    expect(formatWeiWbt("50000000000000000")).toBe("0.0500");
    expect(formatWbt("1.42")).toBe("1.4200");
  });
});

describe("filters", () => {
  test("counts the fixtures per filter; partly refunded money is still Paid", () => {
    expect(filterCounts(fixtureOrders)).toEqual({ all: 6, paid: 3, held: 1, refunded: 2 });
  });

  test("Held covers settling payments, Refunded covers cancels", () => {
    expect(matchesFilter({ status: "pending" }, "held")).toBe(true);
    expect(matchesFilter({ status: "cancelled" }, "refunded")).toBe(true);
    expect(matchesFilter({ status: "refund_pending" }, "refunded")).toBe(true);
    expect(matchesFilter({ status: "held" }, "paid")).toBe(false);
  });
});

describe("receivedAt", () => {
  // An order as an older relay sends it: no receivedAt field at all.
  const { receivedAt: _dropped, ...base } = fixtureOrders[0]!;
  test("a held order has no received date until it releases", () => {
    expect(receivedAt({ ...base, kind: "escrow", status: "held", closeKind: null })).toBeNull();
    expect(receivedAt({ ...base, kind: "escrow", status: "paid", closeKind: "release", receivedAt: 1_000 })).toBe(1_000);
  });

  test("a direct payment is received when it settles; a cancel never is", () => {
    expect(receivedAt({ ...base, kind: "exact", status: "paid", closeKind: null, createdAt: 5_000 })).toBe(5_000);
    expect(receivedAt({ ...base, kind: "escrow", status: "cancelled", closeKind: "cancel" })).toBeNull();
  });
});

describe("the clearing desk's arithmetic", () => {
  const base = fixtureOrders[0]!;
  const order = (patch: Partial<Order>): Order => ({ ...base, ...patch });

  test("released − refunded − toll = net; held stands beside it, never in it", () => {
    const sums = equation(fixtureOrders);
    expect(sums).toEqual({
      released: 1_350_000n,
      refunded: 500_000n,
      toll: 500n,
      net: 849_500n,
      held: 400_000n,
    });
    expect(sums.released - sums.refunded - sums.toll).toBe(sums.net);
  });

  test("the running balance ends at the header's net, newest first", () => {
    const rows = ledger(fixtureOrders);
    const counted = rows.filter((row) => !row.pending);
    expect(counted[0]!.balance).toBe(equation(fixtureOrders).net);
    const times = rows.map((row) => row.order.createdAt);
    expect(times).toEqual([...times].sort((a, b) => b - a));
    // Each step moves by exactly what the row's amount and its adjustments say.
    for (let index = 0; index < rows.length - 1; index += 1) {
      expect(rows[index]!.balance - rows[index + 1]!.balance).toBe(contribution(rows[index]!.order));
    }
  });

  test("the held row is pending and does not move the balance", () => {
    const rows = ledger(fixtureOrders);
    const index = rows.findIndex((row) => row.order.status === "held");
    expect(rows[index]!.pending).toBe(true);
    expect(rows[index]!.balance).toBe(rows[index + 1]!.balance);
    expect(rows.filter((row) => row.pending)).toHaveLength(1);
  });

  test("each row explains why the balance moved by less than its amount", () => {
    expect(adjustments(order({ kind: "escrow", status: "held", closeKind: null }))).toEqual([{ kind: "held" }]);
    expect(adjustments(order({ status: "pending" }))).toEqual([{ kind: "settling" }]);
    expect(
      adjustments(order({ kind: "escrow", status: "cancelled", closeKind: "cancel", amount: "300000" })),
    ).toEqual([{ kind: "returned", amount: 300_000n, close: "cancel" }]);
    expect(
      adjustments(order({ kind: "escrow", status: "partially_refunded", closeKind: "release", fee: "500", refunded: "10000" })),
    ).toEqual([
      { kind: "toll", amount: 500n },
      { kind: "refunded", amount: 10_000n },
    ]);
    expect(adjustments(order({}))).toEqual([]);
  });

  test("cancelled and held orders add nothing; a released one adds its amount less toll and refunds", () => {
    expect(contribution(order({ kind: "escrow", status: "cancelled", closeKind: "cancel", amount: "300000" }))).toBe(0n);
    expect(contribution(order({ kind: "escrow", status: "held", closeKind: null, amount: "400000" }))).toBe(0n);
    expect(
      contribution(order({ kind: "escrow", status: "paid", closeKind: "release", amount: "50000", fee: "500", refunded: "0" })),
    ).toBe(49_500n);
  });
});

describe("fixed decimals", () => {
  test("a column gets the fewest places that show every value exactly", () => {
    expect(decimalsFor([50_000n, 1_000_000n])).toBe(2);
    expect(decimalsFor([1_249_500n, 500n])).toBe(4);
    expect(decimalsFor([1n])).toBe(6);
  });

  test("pads to the column and never hides a digit of money", () => {
    expect(formatFixed(1_350_000n, 4)).toBe("1.3500");
    expect(formatFixed(500n, 2)).toBe("0.0005");
    expect(formatFixed(-500_000n, 2)).toBe("−0.50");
    expect(formatFixed(0n, 2)).toBe("0.00");
  });
});

describe("checkRefundAmount", () => {
  const left = 750_000n;
  test("accepts a plain decimal up to what is left", () => {
    expect(checkRefundAmount("0.25", left)).toEqual({ ok: true, atomic: 250_000n });
    expect(checkRefundAmount(" .5 ", left)).toEqual({ ok: true, atomic: 500_000n });
    expect(checkRefundAmount("0.75", left)).toEqual({ ok: true, atomic: 750_000n });
  });

  test("refuses empty, malformed, zero, too precise and too much, in words", () => {
    expect(checkRefundAmount("", left)).toEqual({ ok: false, message: "Enter an amount." });
    expect(checkRefundAmount("1,5", left)).toEqual({ ok: false, message: "Enter an amount like 0.25." });
    expect(checkRefundAmount(".", left)).toEqual({ ok: false, message: "Enter an amount like 0.25." });
    expect(checkRefundAmount("0", left)).toEqual({ ok: false, message: "Enter more than 0." });
    expect(checkRefundAmount("0.0000001", left)).toEqual({ ok: false, message: "USDT has six decimals at most." });
    expect(checkRefundAmount("0.76", left)).toEqual({ ok: false, message: "Only 0.75 USDT is left to refund." });
  });
});

describe("timeline", () => {
  test("a released escrow order: funded, then released with its slip, newest first", () => {
    const record = findFixtureOrder("0x01a66ebcdaa75420b747496de7e523ed0293ecf27d6733c56aead58719dcb231")!;
    const events = timeline(record, "merchant");
    expect(events.map((event) => event.key)).toEqual(["release", "fund"]);
    expect(events[0]).toMatchObject({
      tone: "settled",
      title: "Released to you",
      detail: "Toll 0.0005 USDT.",
      slipHash: "0x7f69ea83dd410372d0ec8eb178f7a45affd16f11f5865655381495afff5edf6c",
    });
    expect(timeline(record, "customer")[0]!.title).toBe("Released to the merchant");
  });

  test("a refund the relay did not time keeps its place and shows its block", () => {
    const record = findFixtureOrder("0x4dc460652c20607ee4a16f699c90f3a0bb94b3ce3696099932cbeb1d95fd42bc")!;
    const events = timeline(record, "customer");
    expect(events.map((event) => event.title)).toEqual(["Refunded 0.25 USDT", "Paid 0.25 USDT"]);
    expect(events[0]).toMatchObject({ at: null, block: "12361744", tone: "neutral" });
  });

  test("a refund carries its reason; a refusal this visit is red and newest", () => {
    const record = findFixtureOrder("0x9a2b4c6d8e0f1a3b5c7d9e1f3a5b7c9d1e3f5a7b9c1d3e5f7a9b1c3d5e7f9a1b")!;
    const events = timeline(record, "merchant", [{ at: Date.now(), reason: "merchant_balance_low" }]);
    expect(events[0]).toMatchObject({ tone: "refused", title: "Refund refused. Merchant balance low" });
    expect(events[1]).toMatchObject({ title: "Refunded 0.25 USDT", detail: "Requested by customer" });
    expect(events[2]).toMatchObject({ title: "Received 1.00 USDT", tone: "settled" });
  });

  test("a cancel speaks to each reader", () => {
    const record = findFixtureOrder("0xd3247aa41d6a23adfe6ae673d6ad2c676da8fdfb188a4c4c5dd8b06ca7bb8e7e")!;
    expect(timeline(record, "merchant")[0]!.title).toBe("Cancelled. 0.30 USDT returned to the customer");
    expect(timeline(record, "customer")[0]!.title).toBe("Cancelled by the merchant. 0.30 USDT returned to you");
  });
});

describe("refund reasons", () => {
  test("names the four reasons and nothing else", () => {
    expect(reasonLabel("not_delivered")).toBe("Not delivered");
    expect(reasonLabel("chargeback")).toBeNull();
    expect(reasonLabel(null)).toBeNull();
  });
});

describe("fixture refunds", () => {
  test("every simulated attempt gets a hash of its own", () => {
    const id = fixtureOrders[3]!.id;
    const hashes = [0, 1, 2, 3, 4].map((attempt) => fixtureRefundTx(id, attempt));
    expect(new Set(hashes).size).toBe(hashes.length);
    for (const hash of hashes) expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("offersRefund", () => {
  const partly = fixtureOrders[3]!; // 1.00 paid, 0.25 back, 0.75 left
  const done = (before: string) => ({ kind: "done" as const, txHash: "0x01", amount: "250000", cancelled: false, before });

  test("never during the undo window or while sending", () => {
    expect(offersRefund(partly, { kind: "undo" })).toBe(false);
    expect(offersRefund(partly, { kind: "sending" })).toBe(false);
  });

  test("not on a stale list: the remainder that was just refunded is never offered twice", () => {
    expect(offersRefund(partly, done(partly.refundable))).toBe(false);
  });

  test("again once the list shows what is left after a partial refund", () => {
    expect(offersRefund(partly, done("1000000"))).toBe(true);
    expect(offersRefund({ ...partly, refundable: "0", status: "refunded" }, done("750000"))).toBe(false);
  });
});

describe("hub records (wc/orders-contract.md)", () => {
  const record = {
    id: "0x" + "ab".repeat(32),
    kind: "escrow",
    rail: "escrow",
    network: "eip155:5042002",
    networkName: "Arc testnet",
    asset: { symbol: "USDC", decimals: 6 },
    explorer: "https://testnet.arcscan.app/",
    customer: "0x" + "11".repeat(20),
    merchant: "0x" + "22".repeat(20),
    amount: "10000",
    fee: "100",
    refunded: "0",
    refundable: "10000",
    status: "released",
    closeKind: "release",
    createdAt: 1_793_960_010_000,
    receivedAt: 1_793_960_014_000,
    closedAt: 1_793_960_014_000,
    settleTx: "0x" + "33".repeat(32),
    closeTx: "0x" + "44".repeat(32),
    refundTxs: [],
    slipHash: "0x" + "55".repeat(32),
    offerHash: "0x" + "66".repeat(32),
    deadline: 1_793_963_610_000,
    description: "use-usdc",
  };

  test("maps the contract shape, reading released as paid", () => {
    const order = fromHubOrder(record)!;
    expect(order).toMatchObject({ status: "paid", closeKind: "release", amount: "10000", fee: "100", description: "use-usdc" });
    expect(assetOf(order)).toBe("USDC");
    expect(networkNameOf(order)).toBe("Arc testnet");
    expect(explorerOf(order)).toBe("https://testnet.arcscan.app");
    expect(txUrl(order.settleTx, explorerOf(order))).toBe(`https://testnet.arcscan.app/tx/${record.settleTx}`);
  });

  test("a relay record without rail fields means Whitechain USDT", () => {
    const order = fromHubOrder({ ...fixtureOrders[0]! })!;
    expect(assetOf(order)).toBe("USDT");
    expect(networkNameOf(order)).toBe("Whitechain Sepolia");
    expect(explorerOf(order)).toBe("https://explorer.testnet.whitechain.io");
  });

  test("drops what cannot be an order instead of guessing", () => {
    expect(fromHubOrder(null)).toBeNull();
    expect(fromHubOrder({ ...record, status: "mystery" })).toBeNull();
    expect(fromHubOrder({ ...record, amount: "1.5" })).toBeNull();
    expect(fromHubOrder({ ...record, id: "" })).toBeNull();
  });

  test("a single record keeps its refunds with their reasons and times", () => {
    const full = fromHubRecord({
      ...record,
      status: "partially_refunded",
      refunds: [{ amount: "2500", txHash: "0x" + "77".repeat(32), blockNumber: "12", status: "confirmed", reason: "duplicate", at: 1_793_960_500_000 }, { bad: true }],
    })!;
    expect(full.refunds).toEqual([
      { amount: "2500", txHash: "0x" + "77".repeat(32), blockNumber: "12", status: "confirmed", reason: "duplicate", at: 1_793_960_500_000 },
    ]);
  });

  test("the export has the relay's columns and per-order explorer links", () => {
    const csv = ordersCsv([fromHubOrder(record)!]).split("\n");
    expect(csv[0]).toBe(ORDERS_CSV_HEADER);
    expect(csv[1]).toContain("https://testnet.arcscan.app/tx/0x3333");
    expect(csv[1]).toContain(",0.0099,");
  });
});

describe("where the desk reads (STEER-1730)", () => {
  const realFetch = globalThis.fetch;
  const merchant = "0xd5882dBC7D41fBcf8ae0B05E9eAc1cbe93d6C71c";
  const answer = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const serve = (routes: Record<string, () => Response>) => {
    const seen: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      seen.push(url);
      const hit = Object.entries(routes).find(([prefix]) => url.startsWith(prefix));
      if (!hit) throw new TypeError("network down");
      return hit[1]();
    }) as typeof fetch;
    return seen;
  };

  test("the hub's /orders first, and the page is told it is the hub", async () => {
    const seen = serve({ "/hub/orders?seller=": () => answer(200, { orders: [fixtureOrders[0]] }) });
    const result = await fetchOrders(merchant);
    expect(result.source).toEqual({ kind: "hub", base: "/hub" });
    expect(result.orders).toHaveLength(1);
    expect(seen[0]).toBe(`/hub/orders?seller=${merchant}&limit=200`);
    globalThis.fetch = realFetch;
  });

  test("a hub without /orders falls back to the relay's live records, and says so", async () => {
    serve({
      "/hub/orders": () => new Response("404 Not Found", { status: 404 }),
      "/relay/orders?merchant=": () => answer(200, { orders: fixtureOrders }),
    });
    const result = await fetchOrders(merchant);
    expect(result.source.kind).toBe("relay");
    expect(result.orders).toHaveLength(fixtureOrders.length);
    globalThis.fetch = realFetch;
  });

  test("a hub that is away also falls back, and the page says the hub did not answer", async () => {
    serve({
      "/hub/orders": () => new Response("Bad Gateway", { status: 502 }),
      "/relay/orders?merchant=": () => answer(200, { orders: fixtureOrders }),
    });
    expect((await fetchOrders(merchant)).source).toEqual({ kind: "relay", base: "/relay", why: "down" });
    globalThis.fetch = realFetch;
  });

  test("with neither, an honest error: never fixtures, never zeros", async () => {
    serve({ "/hub/orders": () => new Response("404 Not Found", { status: 404 }) });
    await expect(fetchOrders(merchant)).rejects.toThrow(NOT_SERVED);
    serve({});
    await expect(fetchOrders(merchant)).rejects.toThrow("The hub did not answer.");
    globalThis.fetch = realFetch;
  });

  test("an unknown order is missing; a hub without the route is not", async () => {
    serve({ "/hub/orders/": () => answer(404, { code: "not_found" }) });
    expect(await fetchOrder("0x01")).toBeNull();
    serve({ "/hub/orders/": () => new Response("404 Not Found", { status: 404 }) });
    await expect(fetchOrder("0x01")).rejects.toThrow(NOT_SERVED);
    globalThis.fetch = realFetch;
  });
});
