import { describe, expect, test } from "bun:test";
import { priceLabel, railToken } from "../src/price-label.ts";

describe("price-label", () => {
  test("railToken: USDT on whitechain, USDC on every other rail", () => {
    expect(railToken("whitechain")).toBe("USDT");
    for (const rail of ["escrow", "gateway", "hedera", "hedera-scheduled", "eip3009"]) {
      expect(railToken(rail)).toBe("USDC");
    }
  });

  test("priceLabel names the token of the offer's rails", () => {
    expect(priceLabel("10000", ["whitechain"])).toBe("0.01 USDT");
    expect(priceLabel("10000", ["escrow"])).toBe("0.01 USDC");
    expect(priceLabel("10000", ["escrow", "gateway", "hedera"])).toBe("0.01 USDC");
    expect(priceLabel("10000", ["escrow", "whitechain"])).toBe("0.01 USDC/USDT");
    expect(priceLabel("10000", ["whitechain", "escrow"])).toBe("0.01 USDT/USDC");
    expect(priceLabel("1500000", [])).toBe("1.5 USDC");
  });
});
