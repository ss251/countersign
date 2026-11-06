import { describe, expect, test } from "bun:test";
import { cardMode } from "../src/routes/assistant/cardMode.ts";

describe("the purchase card's mode", () => {
  test("no wallet: the hold writes no signature and says nothing about why", () => {
    expect(cardMode({ connected: false, chainId: undefined, rails: ["escrow"] })).toEqual({ wallet: false, why: null });
  });

  test("connected, but the offer does not take Arc's escrow rail", () => {
    expect(cardMode({ connected: true, chainId: 5042002, rails: ["gateway", "hedera"] })).toEqual({
      wallet: false,
      why: "Your wallet can countersign only on Arc's escrow rail, and this offer does not take it.",
    });
  });

  test("connected on another chain", () => {
    expect(cardMode({ connected: true, chainId: 1, rails: ["escrow"] })).toEqual({
      wallet: false,
      why: "Switch to Arc testnet to countersign this with your wallet.",
    });
  });

  test("connected on Arc with an escrow offer: the wallet signs", () => {
    expect(cardMode({ connected: true, chainId: 5042002, rails: ["escrow"] })).toEqual({ wallet: true });
  });
});
