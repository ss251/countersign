import { describe, expect, test } from "bun:test";
import { offerHash, type Offer, type PaymentPayload, type PaymentRequirements } from "@countersign/core";
import { Challenge, Credential, Receipt } from "mppx";
import { stripeClientFromKey } from "../client.ts";
import { CARD_FLOOR, STABLECOIN_FLOOR, TEMPO_USDC } from "../constants.ts";
import { mockStripeClient } from "../mock.ts";
import { createMppRail } from "../rail.ts";

const SELLER = "0x1111111111111111111111111111111111111111" as const;
const RESOURCE = "http://localhost:8798/paid";
const NETWORK_ID = "profile_test_mock";
const SECRET = "s".repeat(32);
const REALM = "localhost";

function offer(price: string): Offer {
  return {
    v: 1,
    seller: SELLER,
    title: "Mock MPP offer",
    summary: "An offer paid over the mpp rail",
    adapter: "skill",
    input: { type: "object" },
    output: { type: "object" },
    price,
    deadline: 3600,
    bond: "0",
    rails: ["mpp"],
    issuedAt: 1_793_957_000,
  };
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function railWith(client = mockStripeClient(), over: { maxTimeoutSeconds?: number } = {}) {
  return createMppRail({
    client,
    networkId: NETWORK_ID,
    secretKey: SECRET,
    realm: REALM,
    ...over,
  });
}

function wwwAuthenticate(requirements: PaymentRequirements): string {
  const mpp = requirements.extra?.mpp as { wwwAuthenticate?: unknown } | undefined;
  if (typeof mpp?.wwwAuthenticate !== "string") throw new Error("requirements carry no MPP challenge");
  return mpp.wwwAuthenticate;
}

function sptPayload(requirements: PaymentRequirements, challengeExternalId?: string) {
  const challenges = Challenge.deserializeList(wwwAuthenticate(requirements));
  const challenge = challenges.find((candidate) => candidate.method === "stripe");
  if (!challenge) throw new Error("no stripe challenge");
  const externalId = challengeExternalId ?? (challenge.request.externalId as string);
  return {
    challenge,
    serialized: Credential.serialize(
      Credential.from({
        challenge,
        payload: { spt: "spt_test_mock", externalId },
      }),
    ),
  };
}

function tempoPayload(requirements: PaymentRequirements) {
  const challenges = Challenge.deserializeList(wwwAuthenticate(requirements));
  const challenge = challenges.find((candidate) => candidate.method === "tempo");
  if (!challenge) throw new Error("no tempo challenge");
  return {
    challenge,
    serialized: Credential.serialize(
      Credential.from({
        challenge,
        payload: { hash: `0x${"11".repeat(32)}`, type: "hash" },
      }),
    ),
  };
}

function paymentFor(requirements: PaymentRequirements, credential: string): PaymentPayload {
  return {
    x402Version: 2,
    accepted: requirements,
    payload: { credential },
    resource: { url: RESOURCE },
  };
}

describe("challenge", () => {
  test("converts atomic USD to cents and offers both methods at 0.50", () => {
    const rail = railWith();
    const o = offer("500000");
    const req = rail.challenge(o, { resource: RESOURCE, now: nowSeconds() });

    expect(req.scheme).toBe("exact");
    expect(req.network).toBe("mpp:stripe");
    expect(req.amount).toBe("50");
    expect(req.asset).toBe("usd");
    expect(req.payTo).toBe(NETWORK_ID);
    expect(req.extra?.offerHash).toBe(offerHash(o));
    const mpp = req.extra?.mpp as { wwwAuthenticate: string; methods: string[] };
    expect(mpp.methods).toEqual(["tempo", "stripe"]);

    const challenges = Challenge.deserializeList(mpp.wwwAuthenticate);
    expect(challenges.map((c) => c.method)).toEqual(["tempo", "stripe"]);
    const tempo = challenges.find((c) => c.method === "tempo")!;
    const stripe = challenges.find((c) => c.method === "stripe")!;
    expect(tempo.request.amount).toBe("500000");
    expect(tempo.request.currency).toBe(TEMPO_USDC);
    expect(stripe.request.amount).toBe("50");
    expect(stripe.request.currency).toBe("usd");
    expect(stripe.request.externalId).toBe(offerHash(o));
  });

  test("offers only the stablecoin method at 0.05", () => {
    const rail = railWith();
    const req = rail.challenge(offer("50000"), { resource: RESOURCE, now: nowSeconds() });

    expect(req.network).toBe("mpp:tempo");
    expect(req.amount).toBe("50000");
    expect(req.asset).toBe(TEMPO_USDC);
    const mpp = req.extra?.mpp as { wwwAuthenticate: string; methods: string[] };
    expect(mpp.methods).toEqual(["tempo"]);
    const challenges = Challenge.deserializeList(mpp.wwwAuthenticate);
    expect(challenges).toHaveLength(1);
    expect(challenges[0]!.request.amount).toBe("50000");
  });

  test("refuses a price under the 0.01 stablecoin floor", () => {
    const rail = railWith();
    expect(() => rail.challenge(offer((STABLECOIN_FLOOR - 1n).toString()), { resource: RESOURCE, now: nowSeconds() })).toThrow(
      /stablecoin floor/,
    );
    expect(() => rail.challenge(offer("0"), { resource: RESOURCE, now: nowSeconds() })).toThrow(/stablecoin floor/);
  });

  test("does not offer the card method for a fractional-cent price", () => {
    const rail = railWith();
    const req = rail.challenge(offer((CARD_FLOOR + 1n).toString()), { resource: RESOURCE, now: nowSeconds() });
    expect(req.network).toBe("mpp:tempo");
    expect((req.extra?.mpp as { methods: string[] }).methods).toEqual(["tempo"]);
  });
});

describe("verify", () => {
  test("accepts a credential built for the challenge", async () => {
    const rail = railWith();
    const req = rail.challenge(offer("500000"), { resource: RESOURCE, now: nowSeconds() });
    const { serialized } = sptPayload(req);
    const result = await rail.verify(paymentFor(req, serialized), req);
    expect(result).toEqual({ isValid: true });
  });

  test("refuses a tampered challenge", async () => {
    const rail = railWith();
    const req = rail.challenge(offer("500000"), { resource: RESOURCE, now: nowSeconds() });
    const { challenge } = sptPayload(req);
    const tampered = {
      challenge: { ...challenge, request: { ...challenge.request, amount: "51" } },
      payload: { spt: "spt_test_mock" },
    };
    const result = await rail.verify(
      paymentFor(req, Credential.serialize(tampered)),
      req,
    );
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe("challenge_not_ours");
  });

  test("refuses a different amount in the requirements", async () => {
    const rail = railWith();
    const req = rail.challenge(offer("500000"), { resource: RESOURCE, now: nowSeconds() });
    const { serialized } = sptPayload(req);
    const other = { ...req, amount: "51" };
    const result = await rail.verify(paymentFor(req, serialized), other);
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe("amount_mismatch");
  });

  test("refuses an expired challenge", async () => {
    const rail = railWith(mockStripeClient(), { maxTimeoutSeconds: 300 });
    const req = rail.challenge(offer("500000"), { resource: RESOURCE, now: nowSeconds() - 400 });
    const { serialized } = sptPayload(req);
    const result = await rail.verify(paymentFor(req, serialized), req);
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe("expired");
  });

  test("refuses a stablecoin credential at the verification stop point", async () => {
    const rail = railWith();
    const req = rail.challenge(offer("50000"), { resource: RESOURCE, now: nowSeconds() });
    const { serialized } = tempoPayload(req);
    const result = await rail.verify(paymentFor(req, serialized), req);
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe("tempo_verification_requires_rpc");
  });
});

describe("settle", () => {
  test("records the mock PaymentIntent and returns a parseable receipt", async () => {
    const client = mockStripeClient();
    const rail = railWith(client);
    const req = rail.challenge(offer("500000"), { resource: RESOURCE, now: nowSeconds() });
    const { serialized } = sptPayload(req);

    const result = await rail.settle(paymentFor(req, serialized), req);

    expect(result.success).toBe(true);
    expect(result.transaction).toBe("pi_mock_1");
    expect(result.network).toBe("mpp:stripe");
    expect(result.receipt).toBeString();
    const receipt = Receipt.deserialize(result.receipt!);
    expect(receipt.method).toBe("stripe");
    expect(receipt.reference).toBe("pi_mock_1");
    expect(receipt.status).toBe("success");
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]!.params.amount).toBe(50);
    expect(client.calls[0]!.params.currency).toBe("usd");
    expect(client.calls[0]!.params.shared_payment_granted_token).toBe("spt_test_mock");
  });

  test("refuses a replayed credential without a second client call", async () => {
    const client = mockStripeClient();
    const rail = railWith(client);
    const req = rail.challenge(offer("500000"), { resource: RESOURCE, now: nowSeconds() });
    const { serialized } = sptPayload(req);
    const payment = paymentFor(req, serialized);

    const first = await rail.settle(payment, req);
    expect(first.success).toBe(true);
    expect(client.calls).toHaveLength(1);

    const replay = await rail.settle(payment, req);
    expect(replay.success).toBe(false);
    expect(replay.errorReason).toBe("replay");
    expect(client.calls).toHaveLength(1);
  });

  test("returns no receipt when the Stripe client fails", async () => {
    const client = mockStripeClient({ fail: true });
    const rail = railWith(client);
    const req = rail.challenge(offer("500000"), { resource: RESOURCE, now: nowSeconds() });
    const { serialized } = sptPayload(req);

    const result = await rail.settle(paymentFor(req, serialized), req);

    expect(result.success).toBe(false);
    expect(result.errorReason).toBe("payment_failed");
    expect(result.receipt).toBeUndefined();
    expect(client.calls).toHaveLength(1);
  });
});

describe("client", () => {
  test("refuses keys that are not Stripe test keys", () => {
    expect(() => stripeClientFromKey("sk_live_not_a_real_key")).toThrow(/sk_test_/);
    expect(() => stripeClientFromKey("rk_live_not_a_real_key")).toThrow(/rk_test_/);
    expect(() => stripeClientFromKey("")).toThrow();
  });

  test("accepts a test key without contacting Stripe", () => {
    const client = stripeClientFromKey("sk_test_not_a_real_key");
    expect(typeof client.paymentIntents.create).toBe("function");
  });
});
