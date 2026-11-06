import { describe, expect, test } from "bun:test";
import { domainSeparator } from "viem";
import { usdtDomain } from "../src/eip3009.ts";

describe("USDT EIP-712 domain", () => {
  test("matches the separator read from chain 1874", () => {
    expect(domainSeparator({ domain: usdtDomain() })).toBe(
      "0xcdcfacb6b15c8238b4e5fbb47bdb83b7f83f50a531d264bf9763d2bd1d3d2a25",
    );
  });
});
