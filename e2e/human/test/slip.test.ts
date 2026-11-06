import { describe, expect, test } from "bun:test";
import { slipHashFromHref } from "../lib/slip.ts";

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
