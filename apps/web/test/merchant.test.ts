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
import { fixtureCsv, fixtureOrders, fixtureRefundTx } from "../src/routes/merchant/fixtures.ts";
import { filterCounts, matchesFilter, receivedAt } from "../src/routes/merchant/model.ts";

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

  test("only Paid is green; every other badge is neutral", () => {
    expect(statuses.map((status) => [status, statusTone(status)])).toEqual([
      ["pending", "neutral"],
      ["held", "neutral"],
      ["paid", "settled"],
      ["partially_refunded", "neutral"],
      ["refunded", "neutral"],
      ["cancelled", "neutral"],
    ]);
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
    expect(itemLabel({ id, description: " ", resource: "https://x/y" }, null)).toBe("https://x/y");
    expect(itemLabel({ id }, null)).toBe("Order 0x4dc4…42bc");
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
