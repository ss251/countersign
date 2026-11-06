import { describe, expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import { assertOffer, OfferError } from "../src/index.ts";

const MESSAGE =
  "offer.bond above zero needs offer.reviewWindow above zero: a bond protects a buyer who can refuse a delivery";

const seller = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");

function offer(over: { bond?: string; reviewWindow?: number } = {}) {
  return {
    v: 1,
    seller: seller.address,
    title: "t",
    summary: "",
    adapter: "skill",
    input: { type: "object" },
    output: { type: "object" },
    price: "10000",
    deadline: 60,
    bond: over.bond ?? "1",
    rails: ["escrow"],
    issuedAt: 1_800_000_000,
    ...(over.reviewWindow !== undefined ? { reviewWindow: over.reviewWindow } : {}),
  };
}

describe("a bond implies a review window", () => {
  test("bond 1 with no window throws exactly that message", () => {
    expect(() => assertOffer(offer())).toThrow(new OfferError(MESSAGE));
  });

  test("bond 1 with window 0 throws", () => {
    expect(() => assertOffer(offer({ reviewWindow: 0 }))).toThrow(new OfferError(MESSAGE));
  });

  test("bond 1 with window 60 passes", () => {
    expect(() => assertOffer(offer({ reviewWindow: 60 }))).not.toThrow();
  });

  test('bond "000" with no window is not a bond above zero', () => {
    // parseAtomic rejects leading zeros, so "000" fails before the window rule.
    // The zero it does accept, "0", needs no window.
    expect(() => assertOffer(offer({ bond: "000" }))).toThrow(
      new OfferError("offer.price and offer.bond must be atomic digit strings"),
    );
    expect(() => assertOffer(offer({ bond: "0" }))).not.toThrow();
  });
});
