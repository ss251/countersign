import { describe, expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import {
  assertOffer,
  type Offer,
  offerHash,
  OfferError,
  type Slip,
  type SlipBody,
  slipHash,
  slipSigner,
  slipTypedData,
} from "../src/index.ts";

const seller = privateKeyToAccount("0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba");

export const offer: Offer = {
  v: 1,
  seller: seller.address,
  title: "use-arc",
  summary: "Circle's use-arc skill, served as guidance text.",
  adapter: "skill",
  upstream: { url: "https://github.com/circlefin/skills", licence: "Apache-2.0" },
  input: { type: "object", properties: { question: { type: "string" } }, required: ["question"] },
  output: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  price: "10000",
  deadline: 120,
  bond: "0",
  rails: ["escrow", "hedera"],
  issuedAt: 1_762_400_000,
};

describe("offer", () => {
  test("a valid offer passes and hashes stably", () => {
    expect(() => assertOffer(offer)).not.toThrow();
    expect(offerHash(offer)).toBe(offerHash(JSON.parse(JSON.stringify(offer))));
  });

  test("a moved price is a different offer", () => {
    expect(offerHash({ ...offer, price: "20000" })).not.toBe(offerHash(offer));
  });

  test("refuses malformed offers", () => {
    const bad: unknown[] = [
      { ...offer, v: 2 },
      { ...offer, seller: "0x123" },
      { ...offer, price: "0" },
      { ...offer, price: "1.5" },
      { ...offer, deadline: 5 },
      { ...offer, rails: [] },
      { ...offer, rails: ["escrow", "escrow"] },
      { ...offer, rails: ["paypal"] },
      { ...offer, adapter: "shell" },
      { ...offer, title: "" },
    ];
    for (const b of bad) expect(() => assertOffer(b)).toThrow(OfferError);
  });
});

describe("slip", () => {
  const body: SlipBody = {
    v: 1,
    rail: "escrow",
    network: "eip155:5042002",
    offerHash: offerHash(offer),
    jobId: "0x1106bd955f6f3268bd9bd592353e8f40d1bd412ad0e6c5bfd8919b1fac4951c9",
    buyer: "0x2222222222222222222222222222222222222222",
    seller: seller.address,
    payTo: seller.address,
    asset: "0x3600000000000000000000000000000000000000",
    amount: "10000",
    inputHash: "0x01",
    outputHash: "0x02",
    deliveredAt: 1_762_400_100,
    children: [],
    escrow: "0x4444444444444444444444444444444444444444",
    chainId: 5042002,
  };

  test("the seller's Release signature recovers to the seller", async () => {
    const sellerSig = await seller.signTypedData(slipTypedData(body));
    const slip: Slip = {
      body,
      hash: slipHash(body),
      sellerSig,
      payment: { x402Version: 2, accepted: {} as never, payload: {} },
      settlement: { transaction: "0xabc", network: "eip155:5042002" },
    };
    expect(await slipSigner(slip)).toBe(seller.address);
  });

  test("changing any field changes the hash", () => {
    expect(slipHash({ ...body, outputHash: "0x03" })).not.toBe(slipHash(body));
    expect(slipHash({ ...body, children: ["0x01"] })).not.toBe(slipHash(body));
  });

  test("off-escrow slips use the bare Countersign domain", () => {
    const { escrow: _e, chainId: _c, ...bare } = body;
    expect(slipTypedData({ ...bare, rail: "hedera" }).domain).toEqual({ name: "Countersign", version: "1" });
  });
});
