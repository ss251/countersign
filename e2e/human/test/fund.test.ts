import { describe, expect, test } from "bun:test";
import { afterFunding, afterPurchase, changeToReturn, FUND_AMOUNT, GAS_RESERVE } from "../lib/fund.ts";

describe("the funding arithmetic", () => {
  test("a fund adds exactly one USDC", () => {
    expect(FUND_AMOUNT).toBe(1_000_000n);
    expect(afterFunding(0n)).toBe(1_000_000n);
    expect(afterFunding(5n)).toBe(1_000_005n);
  });

  test("a purchase subtracts the offer price", () => {
    expect(afterPurchase(1_000_000n, 50_000n)).toBe(950_000n);
    expect(afterPurchase(1_000_000n, 0n)).toBe(1_000_000n);
  });

  test("the change keeps the gas reserve", () => {
    expect(GAS_RESERVE).toBe(20_000n);
    expect(changeToReturn(950_000n)).toBe(930_000n);
    expect(changeToReturn(20_000n)).toBe(0n);
    expect(changeToReturn(10_000n)).toBe(0n);
  });
});
