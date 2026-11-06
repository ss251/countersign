import { describe, expect, test } from "bun:test";
import type { Slip, SlipBody } from "../src/types.ts";
import { slipCommitHash, slipHash, ZERO_HASH } from "../src/slip.ts";

const body: SlipBody = {
  v: 1,
  rail: "escrow",
  network: "eip155:5042002",
  offerHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
  jobId: "0x1106bd955f6f3268bd9bd592353e8f40d1bd412ad0e6c5bfd8919b1fac4951c9",
  buyer: "0x2222222222222222222222222222222222222222",
  seller: "0x3333333333333333333333333333333333333333",
  payTo: "0x3333333333333333333333333333333333333333",
  asset: "0x3600000000000000000000000000000000000000",
  amount: "10000",
  inputHash: "0x01",
  outputHash: "0x02",
  deliveredAt: 1_762_400_100,
  children: [],
  escrow: "0x4444444444444444444444444444444444444444",
  chainId: 5042002,
};

const slip: Slip = {
  body,
  hash: slipHash(body),
  sellerSig: "0x",
  payment: { x402Version: 2, accepted: {} as never, payload: {} },
  settlement: {
    transaction: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    network: "eip155:5042002",
    url: "https://example.test/tx/aa",
    receipt: "receipt-1",
  },
};

describe("slipCommitHash", () => {
  test("is the slip hash of the body", () => {
    expect(slipCommitHash(body)).toBe(slipHash(body));
  });

  test("does not cover the settlement transaction, receipt or payment", () => {
    const variants: Slip[] = [
      {
        ...slip,
        settlement: {
          ...slip.settlement,
          transaction: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
      },
      { ...slip, settlement: { ...slip.settlement, receipt: "receipt-2" } },
      { ...slip, payment: { ...slip.payment, payload: { authorization: { nonce: "0x01" } } } },
    ];
    for (const variant of variants) {
      expect(slipCommitHash(variant.body)).toBe(slipCommitHash(slip.body));
    }
  });

  test("changes when a body field changes", () => {
    expect(slipCommitHash({ ...body, amount: "10001" })).not.toBe(slipCommitHash(body));
    expect(slipCommitHash({ ...body, outputHash: "0x03" })).not.toBe(slipCommitHash(body));
    expect(slipCommitHash({ ...body, children: ["0x01"] })).not.toBe(slipCommitHash(body));
  });

  test("the zero hash is 32 zero bytes", () => {
    expect(ZERO_HASH).toBe(`0x${"00".repeat(32)}` as `0x${string}`);
  });
});
