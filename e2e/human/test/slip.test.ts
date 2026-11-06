import { describe, expect, test } from "bun:test";
import { escrowRailAddress, slipHashFromHref } from "../lib/slip.ts";

const HASH = `0x${"ab".repeat(32)}`;

describe("the slip-hash parser", () => {
  test("accepts a #/verify link with 0x and 64 hex", () => {
    expect(slipHashFromHref(`#/verify/${HASH}`)).toBe(HASH);
    expect(slipHashFromHref(`https://console.test/#/verify/${HASH}`)).toBe(HASH);
  });

  test("rejects anything else", () => {
    expect(slipHashFromHref(`#/verify/0x${"ab".repeat(31)}`)).toBeUndefined();
    expect(slipHashFromHref(`#/verify/0x${"ab".repeat(33)}`)).toBeUndefined();
    expect(slipHashFromHref(`#/verify/${HASH}0`)).toBeUndefined();
    expect(slipHashFromHref(`#/verify/${HASH}/`)).toBeUndefined();
    expect(slipHashFromHref(`#/slip/${HASH}`)).toBeUndefined();
    expect(slipHashFromHref(`/verify/${HASH}`)).toBeUndefined();
    expect(slipHashFromHref(`${HASH}`)).toBeUndefined();
  });
});

describe("the escrow rail address", () => {
  const ESCROW = `0x${"12".repeat(20)}`;

  test("a /rails body with an escrow rail returns its address", () => {
    expect(
      escrowRailAddress({
        rails: [
          { id: "gateway", kind: "batched" },
          { id: "escrow", kind: "escrow", escrow: ESCROW },
        ],
      }),
    ).toBe(ESCROW);
  });

  test("a body with no escrow rail returns null", () => {
    expect(escrowRailAddress({ rails: [{ id: "gateway", kind: "batched" }] })).toBeNull();
    expect(escrowRailAddress({ rails: [{ id: "hedera", kind: "direct" }] })).toBeNull();
    expect(escrowRailAddress({ rails: [] })).toBeNull();
  });

  test("a non-object returns null", () => {
    expect(escrowRailAddress(null)).toBeNull();
    expect(escrowRailAddress(undefined)).toBeNull();
    expect(escrowRailAddress("rails")).toBeNull();
    expect(escrowRailAddress(42)).toBeNull();
    expect(escrowRailAddress([])).toBeNull();
  });
});
