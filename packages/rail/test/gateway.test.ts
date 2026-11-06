/**
 * The gateway rail against a fake facilitator: no network, no live Gateway calls.
 * Proves the challenge, a real batched signature, the local mismatch refusal, and
 * the settle mapping including a thrown facilitator.
 */

import { describe, expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import type { Offer, PaymentPayload, PaymentRequirements } from "@countersign/core";
import { type FacilitatorLike, gatewayPayment, gatewayRail, isGatewayRequirement } from "../src/gateway/index.ts";

// anvil's well-known dev key; it holds nothing anywhere else
const BUYER = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const SELLER = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a").address;

const ARC = "eip155:5042002";
const USDC = "0x3600000000000000000000000000000000000000";
const VERIFYING = "0x0077777d7eba4688bdef3e311b846f25870a19b9";
const NOW = 1_762_400_000;
const KIND = {
  scheme: "exact",
  network: ARC,
  extra: {
    name: "GatewayWalletBatched",
    version: "1",
    verifyingContract: VERIFYING,
    minValiditySeconds: 604_800,
    assets: [{ symbol: "USDC", address: USDC, decimals: 6, authorizationVersions: ["1", "2"] }],
  },
};
const OFFER: Offer = {
  v: 1,
  seller: SELLER,
  title: "gateway item",
  summary: "",
  adapter: "skill",
  input: { type: "object" },
  output: { type: "object" },
  price: "250000",
  deadline: 120,
  bond: "0",
  rails: ["gateway"],
  issuedAt: 1,
};
const CONTEXT = { resource: "http://hub/x", now: NOW };

interface CallLog {
  verify: Array<{ payment: PaymentPayload; requirements: PaymentRequirements }>;
  settle: Array<{ payment: PaymentPayload; requirements: PaymentRequirements }>;
}

function fakeFacilitator(
  options: {
    kinds?: Array<{ scheme: string; network: string; extra?: Record<string, unknown> }>;
    verify?: FacilitatorLike["verify"];
    settle?: FacilitatorLike["settle"];
  } = {},
): { facilitator: FacilitatorLike; calls: CallLog } {
  const calls: CallLog = { verify: [], settle: [] };
  const facilitator: FacilitatorLike = {
    getSupported: async () => ({ kinds: options.kinds ?? [KIND] }),
    verify: async (payment, requirements) => {
      calls.verify.push({ payment, requirements });
      return options.verify
        ? options.verify(payment, requirements)
        : { isValid: true, payer: BUYER.address };
    },
    settle: async (payment, requirements) => {
      calls.settle.push({ payment, requirements });
      return options.settle
        ? options.settle(payment, requirements)
        : { success: true, payer: BUYER.address, transaction: "0xgateway", network: requirements.network };
    },
  };
  return { facilitator, calls };
}

describe("gateway rail", () => {
  test("challenge advertises the batched Gateway kind", async () => {
    const rail = await gatewayRail({ facilitator: fakeFacilitator().facilitator });

    expect(rail.declaration).toMatchObject({
      id: "gateway",
      network: ARC,
      scheme: "exact",
      kind: "batched",
      gasPaidBy: "gateway",
      asset: { network: ARC, address: USDC, symbol: "USDC", decimals: 6 },
      explorerTx: "https://testnet.arcscan.app/tx/{tx}",
    });
    expect(rail.declaration.finality).toContain("next batch");
    expect(rail.escrow).toBeUndefined();

    expect(rail.challenge(OFFER, CONTEXT)).toEqual({
      scheme: "exact",
      network: ARC,
      amount: OFFER.price,
      asset: USDC,
      payTo: SELLER,
      maxTimeoutSeconds: 120,
      extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: VERIFYING },
    });
  });

  test("challenge floors the timeout at 60 seconds and honours payTo", async () => {
    const rail = await gatewayRail({ facilitator: fakeFacilitator().facilitator });
    const payTo = "0x00000000000000000000000000000000000000A7";
    const req = rail.challenge({ ...OFFER, deadline: 5, payTo: { gateway: payTo } }, CONTEXT);

    expect(req.maxTimeoutSeconds).toBe(60);
    expect(req.payTo).toBe(payTo);
  });

  test("a real buyer signature fills accepted and a payload", async () => {
    const rail = await gatewayRail({ facilitator: fakeFacilitator().facilitator });
    const req = rail.challenge(OFFER, CONTEXT);
    expect(isGatewayRequirement(req)).toBe(true);

    const payment = await gatewayPayment(BUYER, req);
    expect(payment.x402Version).toBe(2);
    expect(payment.accepted).toEqual(req);
    expect(Object.keys(payment.payload).sort()).toEqual(["authorization", "signature"]);
    expect((payment.payload.signature as string).startsWith("0x")).toBe(true);

    const auth = payment.payload.authorization as { from: string; to: string; value: string };
    expect(auth.from.toLowerCase()).toBe(BUYER.address.toLowerCase());
    expect(auth.to.toLowerCase()).toBe(SELLER.toLowerCase());
    expect(auth.value).toBe(req.amount);
  });

  test("verify refuses a mismatched amount without calling the facilitator", async () => {
    const { facilitator, calls } = fakeFacilitator();
    const rail = await gatewayRail({ facilitator });
    const req = rail.challenge(OFFER, CONTEXT);
    const payment = await gatewayPayment(BUYER, req);
    const moved = { ...payment, accepted: { ...payment.accepted, amount: "1" } };

    await expect(rail.verify(moved, req)).resolves.toEqual({
      isValid: false,
      invalidReason: "Refused. The payment does not match this offer.",
    });
    expect(calls.verify).toHaveLength(0);

    await expect(rail.verify(payment, req)).resolves.toEqual({ isValid: true, payer: BUYER.address });
    expect(calls.verify).toHaveLength(1);
  });

  test("verify prefixes the facilitator's refusal", async () => {
    const { facilitator } = fakeFacilitator({
      verify: async () => ({ isValid: false, invalidReason: "insufficient_balance" }),
    });
    const rail = await gatewayRail({ facilitator });
    const req = rail.challenge(OFFER, CONTEXT);
    const payment = await gatewayPayment(BUYER, req);

    expect(await rail.verify(payment, req)).toEqual({
      isValid: false,
      invalidReason: "Refused. insufficient_balance",
    });
  });

  test("settle maps the facilitator's success", async () => {
    const { facilitator, calls } = fakeFacilitator();
    const rail = await gatewayRail({ facilitator });
    const req = rail.challenge(OFFER, CONTEXT);
    const payment = await gatewayPayment(BUYER, req);

    expect(await rail.settle(payment, req)).toEqual({
      success: true,
      payer: BUYER.address,
      transaction: "0xgateway",
      network: ARC,
    });
    expect(calls.settle).toHaveLength(1);
  });

  test("settle turns a thrown facilitator error into a failed result", async () => {
    const { facilitator } = fakeFacilitator({
      settle: async () => {
        throw new Error("gateway is down\nretry later");
      },
    });
    const rail = await gatewayRail({ facilitator });
    const req = rail.challenge(OFFER, CONTEXT);
    const payment = await gatewayPayment(BUYER, req);

    expect(await rail.settle(payment, req)).toEqual({
      success: false,
      errorReason: "gateway is down",
      transaction: "",
      network: ARC,
    });
  });

  test("gatewayRail throws when Arc has no batched kind", async () => {
    const { facilitator } = fakeFacilitator({
      kinds: [{ scheme: "exact", network: ARC, extra: { name: "SomethingElse" } }],
    });

    await expect(gatewayRail({ facilitator })).rejects.toThrow("eip155:5042002");
  });
});
