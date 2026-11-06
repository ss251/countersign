import { describe, expect, test } from "bun:test";
import {
  addressUrl,
  canRefund,
  formatDateTime,
  formatSignedUsdt,
  formatUsdt,
  formatWbt,
  formatWeiWbt,
  normaliseRefundReply,
  refundLabel,
  relativeTime,
  settlementOutcome,
  shortAddress,
  shortHash,
  statusLabel,
  statusTone,
  TOKEN_MISSING_MESSAGE,
  TOKEN_REFUSED_MESSAGE,
  tokenProblem,
  totals,
  txUrl,
  type Order,
} from "../src/routes/merchant/model.ts";
import { fixtureOrders } from "../src/routes/merchant/fixtures.ts";

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

  test("tones every status", () => {
    expect(statuses.map((status) => [status, statusTone(status)])).toEqual([
      ["pending", "money"],
      ["held", "money"],
      ["paid", "settled"],
      ["partially_refunded", "neutral"],
      ["refunded", "neutral"],
      ["cancelled", "neutral"],
    ]);
  });
});

describe("refund replies", () => {
  test("normalises a cancel reply", () => {
    expect(
      normaliseRefundReply(
        { ok: true, transaction: "0xabc", url: "https://example/tx/0xabc", status: "cancelled" },
        200,
      ),
    ).toEqual({ ok: true, txHash: "0xabc" });
  });

  test("normalises a transfer refund reply", () => {
    expect(
      normaliseRefundReply(
        { ok: true, txHash: "0xdef", txUrl: "https://example/tx/0xdef", refunded: "300000", remaining: "0" },
        200,
      ),
    ).toEqual({ ok: true, txHash: "0xdef", refunded: "300000" });
  });

  test("keeps a refusal reason and rejects unknown bodies", () => {
    expect(normaliseRefundReply({ ok: false, reason: "refund_not_possible" }, 400)).toEqual({
      ok: false,
      reason: "refund_not_possible",
    });
    expect(normaliseRefundReply({ ok: false }, 409)).toEqual({ ok: false, reason: "http_409" });
    expect(normaliseRefundReply({ nope: true }, 200)).toBeNull();
    expect(normaliseRefundReply(null, 200)).toBeNull();
  });
});

describe("merchant token", () => {
  test("names a missing token", () => {
    expect(tokenProblem(undefined)).toBe(TOKEN_MISSING_MESSAGE);
    expect(tokenProblem("")).toBe(TOKEN_MISSING_MESSAGE);
    expect(tokenProblem("   ")).toBe(TOKEN_MISSING_MESSAGE);
    expect(TOKEN_MISSING_MESSAGE).toBe(
      "The merchant console needs its token. Set VITE_MERCHANT_TOKEN.",
    );
  });

  test("names a refused token", () => {
    expect(tokenProblem("secret", 401)).toBe(TOKEN_REFUSED_MESSAGE);
    expect(TOKEN_REFUSED_MESSAGE).toBe("The merchant service refused the token.");
    expect(tokenProblem("secret", 200)).toBeNull();
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
  const base = fixtureOrders[0]!;
  const order = (overrides: Partial<Order>): Order => ({ ...base, ...overrides });

  test("sums the fixtures without counting held money as received", () => {
    expect(totals(fixtureOrders)).toEqual({
      received: "3000000",
      held: "400000",
      refunded: "500000",
      net: "2500000",
      count: 5,
    });
  });

  test("counts exact payments in every state except pending", () => {
    const pending = order({ id: "0x01", status: "pending", amount: "900000" });
    const paid = order({ id: "0x02", status: "paid", amount: "100000" });
    const partial = order({
      id: "0x03",
      status: "partially_refunded",
      amount: "200000",
      refunded: "50000",
    });
    const refunded = order({
      id: "0x04",
      status: "refunded",
      amount: "300000",
      refunded: "300000",
    });
    expect(totals([pending, paid, partial, refunded])).toEqual({
      received: "600000",
      held: "0",
      refunded: "350000",
      net: "250000",
      count: 4,
    });
  });

  test("holds escrow money until it is released", () => {
    const held = order({ id: "0x11", kind: "escrow", status: "held", amount: "400000" });
    const released = order({
      id: "0x12",
      kind: "escrow",
      status: "paid",
      closeKind: "release",
      amount: "600000",
      fee: "6000",
    });
    expect(totals([held, released])).toEqual({
      received: "600000",
      held: "400000",
      refunded: "0",
      net: "594000",
      count: 2,
    });
  });

  test("leaves cancels and deadline refunds out of both columns", () => {
    const cancelled = order({
      id: "0x21",
      kind: "escrow",
      status: "cancelled",
      closeKind: "cancel",
      amount: "400000",
      refunded: "0",
    });
    const expired = order({
      id: "0x22",
      kind: "escrow",
      status: "refunded",
      closeKind: "deadline_refund",
      amount: "500000",
      refunded: "0",
    });
    expect(totals([cancelled, expired])).toEqual({
      received: "0",
      held: "0",
      refunded: "0",
      net: "0",
      count: 2,
    });
  });

  test("a fee lowers net and a missing fee counts as zero", () => {
    const withFee = order({
      id: "0x31",
      kind: "escrow",
      status: "paid",
      closeKind: "release",
      amount: "1000000",
      fee: "15000",
    });
    const withoutFee = order({ id: "0x32", status: "paid", amount: "500000", fee: undefined });
    expect(totals([withFee, withoutFee])).toEqual({
      received: "1500000",
      held: "0",
      refunded: "0",
      net: "1485000",
      count: 2,
    });
  });

  test("net may be negative", () => {
    const refunded = order({
      id: "0x41",
      status: "refunded",
      amount: "100000",
      refunded: "250000",
    });
    const sums = totals([refunded]);
    expect(sums.net).toBe("-150000");
    expect(formatSignedUsdt(sums.net)).toBe("-0.15");
  });
});

describe("dates and outcomes", () => {
  test("writes a date people read", () => {
    const text = formatDateTime(new Date(2026, 10, 6, 14, 32).getTime());
    expect(text).toMatch(/^6 Nov 2026, \d{2}:\d{2} \S+/);
  });

  test("names how the money finished", () => {
    expect(settlementOutcome({ status: "paid", closeTx: "0xclose" })).toEqual({
      label: "Released",
      txHash: "0xclose",
    });
    expect(settlementOutcome({ status: "cancelled", closeTx: "0xclose" })).toEqual({
      label: "Cancelled by the merchant. Full amount returned.",
      txHash: "0xclose",
    });
    expect(settlementOutcome({ status: "refunded", closeTx: "0xclose" })).toEqual({
      label: "Refunded after the deadline",
      txHash: "0xclose",
    });
    expect(settlementOutcome({ status: "paid", closeTx: null })).toBeNull();
    expect(settlementOutcome({ status: "refunded", closeTx: null })).toBeNull();
  });

  test("the fixture never repeats a hash", () => {
    const hashes: string[] = [];
    for (const order of fixtureOrders) {
      hashes.push(order.id, order.settleTx);
      if (order.offerHash) hashes.push(order.offerHash);
      hashes.push(...order.refundTxs);
    }
    expect(new Set(hashes).size).toBe(hashes.length);
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
