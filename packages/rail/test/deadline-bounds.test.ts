/**
 * The escrow 402 publishes the deadline bounds the hub enforces, so a buyer whose signature
 * waits on a person can add headroom inside the hub's limit without guessing.
 */

import { describe, expect, test } from "bun:test";
import type { Address } from "viem";
import type { CountersignExtra, Offer } from "@countersign/core";
import { escrowRail } from "../src/escrow/index.ts";

const SELLER: Address = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
const ESCROW: Address = "0x4444444444444444444444444444444444444444";
const TOKEN: Address = "0x3600000000000000000000000000000000000000";
const NOW = 1_762_400_000;

const offer: Offer = {
  v: 1,
  seller: SELLER,
  title: "deadline bounds",
  summary: "",
  adapter: "skill",
  input: { type: "object" },
  output: { type: "object" },
  price: "1500000",
  deadline: 120,
  bond: "0",
  rails: ["escrow"],
  issuedAt: 1,
};

const stub = {
  readContract: async ({ functionName }: { functionName: string }) =>
    functionName === "balanceOf" ? 10n ** 12n : functionName === "authorizationState" ? false : { status: 0 },
} as never;

function railWith(bounds: { deadlineSkew?: number; maxExtraSeconds?: number } = {}) {
  return escrowRail({
    id: "escrow",
    chainId: 31337,
    rpcUrl: "http://127.0.0.1:1",
    escrow: ESCROW,
    token: TOKEN,
    tokenName: "USDC",
    tokenVersion: "2",
    symbol: "USDC",
    decimals: 6,
    explorerTx: "http://explorer/tx/{tx}",
    finality: "One block.",
    gasPaidBy: "hub",
    now: () => NOW,
    publicClient: stub,
    ...bounds,
  });
}

describe("escrow deadline bounds", () => {
  test("the 402 publishes the deadline bounds", () => {
    const extra = railWith().challenge(offer, { resource: "http://hub/x", now: NOW })
      .extra as unknown as CountersignExtra;
    expect(extra.deadlineSkewSeconds).toBe(15);
    expect(extra.maxExtraSeconds).toBe(300);

    const configured = railWith({ deadlineSkew: 20, maxExtraSeconds: 120 }).challenge(offer, {
      resource: "http://hub/x",
      now: NOW,
    }).extra as unknown as CountersignExtra;
    expect(configured.deadlineSkewSeconds).toBe(20);
    expect(configured.maxExtraSeconds).toBe(120);
  });
});
