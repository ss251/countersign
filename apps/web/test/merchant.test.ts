import { describe, expect, test } from "bun:test";
import {
  addressUrl,
  canRefund,
  formatUsdt,
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
  test("sums the fixtures", () => {
    expect(totals(fixtureOrders)).toEqual({
      received: "3400000",
      refunded: "500000",
      net: "2900000",
      count: 5,
    });
  });

  test("leaves pending and cancelled out of received", () => {
    const sample = fixtureOrders[0]!;
    const pending: Order = { ...sample, status: "pending", amount: "990000" };
    const cancelled: Order = { ...sample, status: "cancelled", amount: "880000" };
    expect(totals([pending, cancelled])).toEqual({
      received: "0",
      refunded: "0",
      net: "0",
      count: 2,
    });
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
