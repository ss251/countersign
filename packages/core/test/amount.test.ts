import { describe, expect, test } from "bun:test";
import { AmountError, atomicToWire, bpsOf, formatUnits, parseAtomic, parseUnits } from "../src/amount.ts";

describe("atomic wire amounts", () => {
  test("round-trips digit strings", () => {
    for (const s of ["0", "1", "1500000", "340282366920938463463374607431768211455"]) {
      expect(atomicToWire(parseAtomic(s))).toBe(s);
    }
  });

  test("rejects anything that is not plain digits", () => {
    for (const s of ["", "-1", "+1", " 1", "1 ", "01", "1e6", "1.0", "0x10", "١"]) {
      expect(() => parseAtomic(s)).toThrow(AmountError);
    }
  });

  test("rejects negative bigints on the way out", () => {
    expect(() => atomicToWire(-1n)).toThrow(AmountError);
  });
});

describe("decimal units", () => {
  test("parses with exact precision", () => {
    expect(parseUnits("1.5", 6)).toBe(1_500_000n);
    expect(parseUnits("0.000001", 6)).toBe(1n);
    expect(parseUnits("12", 6)).toBe(12_000_000n);
    expect(parseUnits("0", 18)).toBe(0n);
  });

  test("refuses more decimals than the token has", () => {
    expect(() => parseUnits("0.0000001", 6)).toThrow(AmountError);
    expect(() => parseUnits("1.", 6)).toThrow(AmountError);
    expect(() => parseUnits(".5", 6)).toThrow(AmountError);
  });

  test("formats without rounding or exponents", () => {
    expect(formatUnits(1_500_000n, 6)).toBe("1.5");
    expect(formatUnits(1n, 6)).toBe("0.000001");
    expect(formatUnits(10n ** 30n, 6)).toBe("1000000000000000000000000");
    expect(formatUnits(0n, 6)).toBe("0");
  });

  test("format inverts parse", () => {
    for (const s of ["0.01", "3", "999999.999999"]) {
      expect(formatUnits(parseUnits(s, 6), 6)).toBe(s);
    }
  });
});

describe("basis points", () => {
  test("rounds down", () => {
    expect(bpsOf(1_000_000n, 250)).toBe(25_000n);
    expect(bpsOf(3n, 5_000)).toBe(1n);
    expect(bpsOf(5n, 0)).toBe(0n);
  });

  test("refuses out-of-range bps", () => {
    expect(() => bpsOf(1n, 10_001)).toThrow(AmountError);
    expect(() => bpsOf(1n, -1)).toThrow(AmountError);
    expect(() => bpsOf(1n, 1.5)).toThrow(AmountError);
  });
});
