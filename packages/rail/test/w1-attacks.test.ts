import { describe, expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import type { Address } from "viem";
import { authorizationTypedData, countersignPayload, type CountersignExtra, type Offer, type PaymentPayload } from "@countersign/core";
import { escrowRail } from "../src/escrow/index.ts";

// cs-w1 adversarial tests. A failing test here is a blocker.

const buyer = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const seller = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
const ESCROW = "0x00000000000000000000000000000000000000E5" as Address;
const TOKEN = "0x00000000000000000000000000000000000000A7" as Address;
const NOW = 1_762_400_000;

const stub = {
  readContract: async ({ functionName }: { functionName: string }) =>
    functionName === "balanceOf" ? 10n ** 12n : functionName === "authorizationState" ? false : { status: 0 },
} as never;

const rail = escrowRail({
  id: "escrow",
  chainId: 31337,
  rpcUrl: "http://127.0.0.1:1",
  escrow: ESCROW,
  token: TOKEN,
  tokenName: "USDC",
  tokenVersion: "2",
  symbol: "USDC",
  decimals: 6,
  explorerTx: "x/{tx}",
  finality: "f",
  gasPaidBy: "hub",
  now: () => NOW,
  publicClient: stub,
});

const offer: Offer = {
  v: 1,
  seller: seller.address,
  title: "t",
  summary: "",
  adapter: "skill",
  input: { type: "object" },
  output: { type: "object" },
  price: "1500000",
  deadline: 120, // "Seconds the seller has to deliver once the escrow is funded."
  bond: "0",
  rails: ["escrow"],
  issuedAt: 1,
};

async function payWithDeadline(deadline: number): Promise<{ payment: PaymentPayload; req: ReturnType<typeof rail.challenge> }> {
  const req = rail.challenge(offer, { resource: "http://hub/x", now: NOW });
  const extra = req.extra as unknown as CountersignExtra;
  const input = {
    terms: { offerHash: extra.offerHash, buyer: buyer.address, payee: req.payTo as Address, amount: req.amount, deadline, salt: "1" },
    chainId: extra.chainId,
    escrow: extra.escrow,
    token: req.asset as Address,
    tokenName: extra.tokenName,
    tokenVersion: extra.tokenVersion,
    validAfter: 0,
    validBefore: NOW + 600,
  };
  const signature = await buyer.signTypedData(authorizationTypedData(input));
  return {
    req,
    payment: { x402Version: 2, accepted: req, payload: countersignPayload(input, signature) as unknown as Record<string, unknown> },
  };
}

describe("W1 B3: the buyer can shorten the seller's delivery window", () => {
  test("honest deadline is accepted", async () => {
    const { payment, req } = await payWithDeadline(NOW + 120);
    expect((await rail.verify(payment, req)).isValid).toBe(true);
  });

  test("a deadline 100 seconds shorter than the offer promises is refused", async () => {
    // The offer promises 120 seconds. The buyer countersigns a deadline 11 seconds out: the
    // seller has 11 seconds, then anyone refunds the buyer. deadlineSlack (120) allows it.
    const { payment, req } = await payWithDeadline(NOW + 11);
    const v = await rail.verify(payment, req);
    expect(v.isValid).toBe(false);
  });
});
