import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { offerHash, type Offer, type PaymentPayload, type PaymentRequirements } from "@countersign/core";
import { Challenge, Credential, Receipt, Store } from "mppx";
import { tempo } from "mppx/server";
import { tempoMainnet } from "viem/tempo/chains";
import {
  CARD_FLOOR,
  STABLECOIN_FLOOR,
  TEMPO_CHAIN_ID,
  TEMPO_CURRENCY,
  TEMPO_DECIMALS,
  TEMPO_SYMBOL,
} from "../constants.ts";
import { mockStripeClient } from "../mock.ts";
import {
  createMppRail,
  inspectMppPayment,
  MPP_DECLARATION,
  type MppInspectionOptions,
  type MppRailOptions,
  type SettledStore,
} from "../rail.ts";

const SELLER = "0x1111111111111111111111111111111111111111" as const;
const RECIPIENT = "0x00000000000000000000000000000000000000aa" as const;
const OTHER_RECIPIENT = "0x00000000000000000000000000000000000000bb" as const;
const PAYER = "0x00000000000000000000000000000000000000dd" as const;
const RESOURCE = "http://localhost:8798/paid";
const NETWORK_ID = "profile_test_mock";
const SECRET = "s".repeat(32);
const REALM = "localhost";

function offer(price: string, over: Partial<Offer> = {}): Offer {
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
    payTo: { mpp: RECIPIENT },
    issuedAt: 1_793_957_000,
    ...over,
  };
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function railWith(over: Partial<MppRailOptions> = {}) {
  return createMppRail({
    secretKey: SECRET,
    realm: REALM,
    ...over,
  });
}

function railWithStripe(client = mockStripeClient(), over: Partial<MppRailOptions> = {}) {
  return railWith({ stripe: { client, networkId: NETWORK_ID }, ...over });
}

function wwwAuthenticate(requirements: PaymentRequirements): string {
  const mpp = requirements.extra?.mpp as { wwwAuthenticate?: unknown } | undefined;
  if (typeof mpp?.wwwAuthenticate !== "string") throw new Error("requirements carry no MPP challenge");
  return mpp.wwwAuthenticate;
}

function challengesOf(requirements: PaymentRequirements) {
  return Challenge.deserializeList(wwwAuthenticate(requirements));
}

function sptPayload(requirements: PaymentRequirements, challengeExternalId?: string) {
  const challenge = challengesOf(requirements).find((candidate) => candidate.method === "stripe");
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

function tempoPayload(
  requirements: PaymentRequirements,
  source?: string,
  hash = `0x${"11".repeat(32)}`,
) {
  const challenge = challengesOf(requirements).find((candidate) => candidate.method === "tempo");
  if (!challenge) throw new Error("no tempo challenge");
  return {
    challenge,
    serialized: Credential.serialize(
      Credential.from({
        challenge,
        payload: { hash, type: "hash" },
        ...(source ? { source } : {}),
      }),
    ),
  };
}

function credentialFor(challenge: ReturnType<typeof Challenge.deserialize>): string {
  return Credential.serialize(
    Credential.from({
      challenge,
      payload: { hash: `0x${"11".repeat(32)}`, type: "hash" },
    }),
  );
}

function reissue(
  challenge: ReturnType<typeof Challenge.deserialize>,
  request: Record<string, unknown>,
  secretKey = SECRET,
) {
  return Challenge.from({
    realm: challenge.realm,
    method: challenge.method,
    intent: challenge.intent,
    request,
    expires: challenge.expires,
    secretKey,
  });
}

function paymentFor(requirements: PaymentRequirements, credential: string): PaymentPayload {
  return {
    x402Version: 2,
    accepted: requirements,
    payload: { credential },
    resource: { url: RESOURCE },
  };
}

function inspect(
  requirements: PaymentRequirements,
  credential: string,
  over: Partial<MppInspectionOptions> = {},
) {
  return inspectMppPayment(paymentFor(requirements, credential), requirements, {
    secretKey: SECRET,
    realm: REALM,
    ...over,
  });
}

function memorySettled(): SettledStore {
  const ids = new Set<string>();
  return {
    has: (id) => ids.has(id),
    claim: (id) => {
      if (ids.has(id)) return false;
      ids.add(id);
      return true;
    },
  };
}

describe("declaration", () => {
  test("declares pathUSD on Tempo Moderato", () => {
    const rail = railWith();
    expect(rail.declaration.network).toBe("mpp:tempo");
    expect(rail.declaration.asset).toEqual({
      network: "mpp:tempo",
      address: "0x20c0000000000000000000000000000000000000",
      symbol: "pathUSD",
      decimals: 6,
    });
  });

  test("declares buyer-paid gas on the Moderato explorer", () => {
    const rail = railWith();
    expect(rail.declaration).toMatchObject({
      scheme: "exact",
      kind: "direct",
      gasPaidBy: "buyer",
      finality: "Final when the Tempo transaction is included on Moderato.",
      explorerTx: "https://explore.testnet.tempo.xyz/tx/{tx}",
    });
  });

  test("declares buyer-paid gas as a plain RailDeclaration", () => {
    expect(MPP_DECLARATION.gasPaidBy).toBe("buyer");
    const source = readFileSync(join(import.meta.dir, "..", "rail.ts"), "utf8");
    expect(source).not.toMatch(/as\s+RailDeclaration/);
  });

  test("keeps the constants on mppx's testnet defaults", () => {
    expect(TEMPO_CHAIN_ID).toBe(42431);
    expect(TEMPO_CURRENCY).toBe("0x20c0000000000000000000000000000000000000");
    expect(TEMPO_SYMBOL).toBe("pathUSD");
    expect(TEMPO_DECIMALS).toBe(6);
  });

  test("matches the chain and currency mppx resolves for testnet", async () => {
    const method = tempo.charge({
      testnet: true,
      currencies: [TEMPO_CURRENCY],
      store: Store.memory(),
    })[0]!;
    const resolved = await method.request!({
      expires: new Date(Date.now() + 300_000).toISOString(),
      request: {
        amount: "10000",
        currency: TEMPO_CURRENCY,
        decimals: TEMPO_DECIMALS,
        recipient: RECIPIENT,
      },
    });
    expect(resolved.chainId).toBe(TEMPO_CHAIN_ID);
    expect(resolved.currency).toBe(TEMPO_CURRENCY);
  });
});

describe("challenge", () => {
  test("offers one Tempo challenge at 0.01 without a stripe client", () => {
    const rail = railWith();
    const req = rail.challenge(offer("10000"), { resource: RESOURCE, now: nowSeconds() });

    expect(req.scheme).toBe("exact");
    expect(req.network).toBe("mpp:tempo");
    expect(req.amount).toBe("10000");
    expect(req.asset).toBe(TEMPO_CURRENCY);
    expect(req.payTo).toBe(RECIPIENT);
    expect(req.extra?.offerHash).toBe(offerHash(offer("10000")));
    const mpp = req.extra?.mpp as { wwwAuthenticate: string; methods: string[] };
    expect(mpp.methods).toEqual(["tempo"]);

    const challenges = Challenge.deserializeList(mpp.wwwAuthenticate);
    expect(challenges).toHaveLength(1);
    const challenge = challenges[0]!;
    expect(challenge.method).toBe("tempo");
    expect(challenge.request.amount).toBe("10000");
    expect(challenge.request.currency).toBe(TEMPO_CURRENCY);
    expect(challenge.request.recipient).toBe(RECIPIENT);
    expect((challenge.request.methodDetails as { chainId?: number }).chainId).toBe(42431);
  });

  test("pays the offer's own Tempo payee, not the rail recipient", () => {
    const rail = railWith({ recipient: OTHER_RECIPIENT });
    const req = rail.challenge(offer("10000"), { resource: RESOURCE, now: nowSeconds() });

    expect(req.payTo).toBe(RECIPIENT);
    const challenge = challengesOf(req).find((candidate) => candidate.method === "tempo")!;
    expect(challenge.request.recipient).toBe(RECIPIENT);
  });

  test("falls back to the seller when the offer names no mpp payee", () => {
    const o = offer("10000", { payTo: {} });
    const req = railWith().challenge(o, { resource: RESOURCE, now: nowSeconds() });

    expect(req.payTo).toBe(SELLER);
    const challenge = challengesOf(req).find((candidate) => candidate.method === "tempo")!;
    expect(challenge.request.recipient).toBe(SELLER);
  });

  test("refuses an offer whose mpp payee is not a valid address", () => {
    const rail = railWith();
    expect(() =>
      rail.challenge(offer("10000", { payTo: { mpp: "0x1234" } }), { resource: RESOURCE, now: nowSeconds() }),
    ).toThrow(/recipient/);
    expect(() =>
      rail.challenge(
        offer("10000", { payTo: { mpp: "0x0000000000000000000000000000000000000000" } }),
        { resource: RESOURCE, now: nowSeconds() },
      ),
    ).toThrow(/zero/);
  });

  test("never offers the card method without a stripe client", () => {
    const req = railWith().challenge(offer("500000"), { resource: RESOURCE, now: nowSeconds() });
    expect(req.network).toBe("mpp:tempo");
    expect((req.extra?.mpp as { methods: string[] }).methods).toEqual(["tempo"]);
  });

  test("converts atomic USD to cents and offers both methods at 0.50 with stripe", () => {
    const rail = railWithStripe();
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
    const tempoChallenge = challenges.find((c) => c.method === "tempo")!;
    const stripeChallenge = challenges.find((c) => c.method === "stripe")!;
    expect(tempoChallenge.request.amount).toBe("500000");
    expect(tempoChallenge.request.currency).toBe("0x20c0000000000000000000000000000000000000");
    expect((tempoChallenge.request.methodDetails as { chainId?: number }).chainId).toBe(42431);
    expect(tempoChallenge.request.recipient).toBe(RECIPIENT);
    expect(stripeChallenge.request.amount).toBe("50");
    expect(stripeChallenge.request.currency).toBe("usd");
    expect(stripeChallenge.request.externalId).toBe(offerHash(o));
  });

  test("offers only the Tempo method at 0.05 with stripe configured", () => {
    const rail = railWithStripe();
    const req = rail.challenge(offer("50000"), { resource: RESOURCE, now: nowSeconds() });

    expect(req.network).toBe("mpp:tempo");
    expect(req.amount).toBe("50000");
    expect(req.asset).toBe(TEMPO_CURRENCY);
    const mpp = req.extra?.mpp as { wwwAuthenticate: string; methods: string[] };
    expect(mpp.methods).toEqual(["tempo"]);
    const challenges = Challenge.deserializeList(mpp.wwwAuthenticate);
    expect(challenges).toHaveLength(1);
    expect(challenges[0]!.request.amount).toBe("50000");
    expect(challenges[0]!.request.currency).toBe("0x20c0000000000000000000000000000000000000");
    expect((challenges[0]!.request.methodDetails as { chainId?: number }).chainId).toBe(42431);
  });

  test("refuses a price under the 0.01 Tempo floor", () => {
    const rail = railWith();
    expect(() =>
      rail.challenge(offer((STABLECOIN_FLOOR - 1n).toString()), { resource: RESOURCE, now: nowSeconds() }),
    ).toThrow(/stablecoin floor/);
    expect(() => rail.challenge(offer("0"), { resource: RESOURCE, now: nowSeconds() })).toThrow(/stablecoin floor/);
  });

  test("does not offer the card method for a fractional-cent price", () => {
    const rail = railWithStripe();
    const req = rail.challenge(offer((CARD_FLOOR + 1n).toString()), { resource: RESOURCE, now: nowSeconds() });
    expect(req.network).toBe("mpp:tempo");
    expect((req.extra?.mpp as { methods: string[] }).methods).toEqual(["tempo"]);
  });
});

describe("stateless inspection", () => {
  test("accepts a credential issued before freshly re-issued requirements", () => {
    const rail = railWith({ recipient: OTHER_RECIPIENT });
    const earlier = rail.challenge(offer("10000"), { resource: RESOURCE, now: nowSeconds() - 2 });
    const { challenge, serialized } = tempoPayload(earlier);
    const fresh = rail.challenge(offer("10000"), { resource: RESOURCE, now: nowSeconds() });

    const result = inspect(fresh, serialized);

    expect(challengesOf(fresh)[0]!.id).not.toBe(challenge.id);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.method).toBe("tempo");
  });

  test("refuses a challenge signed with another secret", () => {
    const rail = railWith();
    const req = rail.challenge(offer("10000"), { resource: RESOURCE, now: nowSeconds() });
    const base = challengesOf(req)[0]!;
    const foreign = Challenge.from({
      realm: base.realm,
      method: base.method,
      intent: base.intent,
      request: base.request,
      expires: base.expires,
      secretKey: "t".repeat(32),
    });

    expect(inspect(req, credentialFor(foreign))).toEqual({ ok: false, reason: "challenge_not_ours" });
  });

  test("refuses another offer's externalId", () => {
    const rail = railWith();
    const mine = offer("10000");
    const other = offer("10000", { title: "Another offer" });
    const req = rail.challenge(mine, { resource: RESOURCE, now: nowSeconds() });
    const otherReq = rail.challenge(other, { resource: RESOURCE, now: nowSeconds() });

    expect(inspect(req, tempoPayload(otherReq).serialized)).toEqual({ ok: false, reason: "offer_mismatch" });
  });

  test("refuses a different recipient", () => {
    const rail = railWith();
    const req = rail.challenge(offer("10000"), { resource: RESOURCE, now: nowSeconds() });
    const base = challengesOf(req)[0]!;
    const tampered = reissue(base, {
      ...base.request,
      recipient: "0x00000000000000000000000000000000000000bb",
    });

    expect(inspect(req, credentialFor(tampered))).toEqual({ ok: false, reason: "offer_mismatch" });
  });

  test("refuses requirements whose payTo names another address", () => {
    const rail = railWith();
    const req = rail.challenge(offer("10000"), { resource: RESOURCE, now: nowSeconds() });
    const { serialized } = tempoPayload(req);

    expect(inspect({ ...req, payTo: OTHER_RECIPIENT }, serialized)).toEqual({
      ok: false,
      reason: "offer_mismatch",
    });
  });

  test("compares the challenge recipient and payTo case-insensitively", () => {
    const rail = railWith();
    const req = rail.challenge(offer("10000"), { resource: RESOURCE, now: nowSeconds() });
    const { serialized } = tempoPayload(req);

    expect(inspect({ ...req, payTo: RECIPIENT.toUpperCase().replace("0X", "0x") }, serialized).ok).toBe(true);
  });

  test("refuses a mainnet chain id", () => {
    const rail = railWith();
    const req = rail.challenge(offer("10000"), { resource: RESOURCE, now: nowSeconds() });
    const base = challengesOf(req)[0]!;
    const details = (base.request.methodDetails ?? {}) as Record<string, unknown>;
    const tampered = reissue(base, {
      ...base.request,
      methodDetails: { ...details, chainId: tempoMainnet.id },
    });

    expect(inspect(req, credentialFor(tampered))).toEqual({ ok: false, reason: "chain_mismatch" });
  });

  test("refuses requirements whose amount moved", () => {
    const rail = railWith();
    const req = rail.challenge(offer("10000"), { resource: RESOURCE, now: nowSeconds() });
    const { serialized } = tempoPayload(req);

    expect(inspect({ ...req, amount: "20000" }, serialized)).toEqual({ ok: false, reason: "amount_mismatch" });
  });
});

describe("verify", () => {
  test("accepts a stripe credential built for the challenge", async () => {
    const rail = railWithStripe();
    const req = rail.challenge(offer("500000"), { resource: RESOURCE, now: nowSeconds() });
    const { serialized } = sptPayload(req);
    const result = await rail.verify(paymentFor(req, serialized), req);
    expect(result).toEqual({ isValid: true });
  });

  test("refuses a tampered stripe challenge", async () => {
    const rail = railWithStripe();
    const req = rail.challenge(offer("500000"), { resource: RESOURCE, now: nowSeconds() });
    const { challenge } = sptPayload(req);
    const tampered = {
      challenge: { ...challenge, request: { ...challenge.request, amount: "51" } },
      payload: { spt: "spt_test_mock" },
    };
    const result = await rail.verify(paymentFor(req, Credential.serialize(tampered)), req);
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe("challenge_not_ours");
  });

  test("refuses a different stripe amount in the requirements", async () => {
    const rail = railWithStripe();
    const req = rail.challenge(offer("500000"), { resource: RESOURCE, now: nowSeconds() });
    const { serialized } = sptPayload(req);
    const other = { ...req, amount: "51" };
    const result = await rail.verify(paymentFor(req, serialized), other);
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe("amount_mismatch");
  });

  test("refuses an expired challenge", async () => {
    const rail = railWithStripe(mockStripeClient(), { maxTimeoutSeconds: 300 });
    const req = rail.challenge(offer("500000"), { resource: RESOURCE, now: nowSeconds() - 400 });
    const { serialized } = sptPayload(req);
    const result = await rail.verify(paymentFor(req, serialized), req);
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe("expired");
  });

  test("refuses a replayed tempo credential before asking mppx", async () => {
    const seen = memorySettled();
    const rail = railWith({ seen });
    const req = rail.challenge(offer("10000"), { resource: RESOURCE, now: nowSeconds() });
    const { challenge, serialized } = tempoPayload(req);
    await seen.claim(`challenge:${challenge.id}`);

    const result = await rail.verify(paymentFor(req, serialized), req);

    expect(result).toEqual({ isValid: false, invalidReason: "replay" });
  });

  test("does not report a payer named only by the credential's did:pkh source", async () => {
    const fake: NonNullable<MppRailOptions["tempoMppx"]> = {
      validateCredential: async () => {},
      broadcastCredential: async () => {
        throw new Error("not used");
      },
    };
    const rail = railWith({ tempoMppx: fake });
    const req = rail.challenge(offer("10000"), { resource: RESOURCE, now: nowSeconds() });
    const { serialized } = tempoPayload(req, `did:pkh:eip155:${TEMPO_CHAIN_ID}:${PAYER}`);

    expect(await rail.verify(paymentFor(req, serialized), req)).toEqual({ isValid: true });
  });

  test("refuses a replay regardless of the credential's source", async () => {
    for (const source of [undefined, "did:pkh:eip155:1:" + PAYER, "not-a-did"]) {
      const seen = memorySettled();
      const rail = railWith({ seen });
      const req = rail.challenge(offer("10000"), { resource: RESOURCE, now: nowSeconds() });
      const { challenge, serialized } = tempoPayload(req, source);
      await seen.claim(`challenge:${challenge.id}`);

      expect(await rail.verify(paymentFor(req, serialized), req)).toEqual({
        isValid: false,
        invalidReason: "replay",
      });
    }
  });
});

describe("settle", () => {
  test("records the mock PaymentIntent and returns a parseable receipt", async () => {
    const client = mockStripeClient();
    const rail = railWithStripe(client);
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

  test("refuses a replayed stripe credential without a second client call", async () => {
    const client = mockStripeClient();
    const rail = railWithStripe(client);
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
    const rail = railWithStripe(client);
    const req = rail.challenge(offer("500000"), { resource: RESOURCE, now: nowSeconds() });
    const { serialized } = sptPayload(req);

    const result = await rail.settle(paymentFor(req, serialized), req);

    expect(result.success).toBe(false);
    expect(result.errorReason).toBe("payment_failed");
    expect(result.receipt).toBeUndefined();
    expect(client.calls).toHaveLength(1);
  });

  test("refuses a replayed tempo credential without asking mppx", async () => {
    const seen = memorySettled();
    const rail = railWith({ seen });
    const req = rail.challenge(offer("10000"), { resource: RESOURCE, now: nowSeconds() });
    const { challenge, serialized } = tempoPayload(req);
    await seen.claim(`challenge:${challenge.id}`);

    const result = await rail.settle(paymentFor(req, serialized), req);

    expect(result).toEqual({
      success: false,
      errorReason: "replay",
      transaction: "",
      network: "mpp:tempo",
    });
  });
});

describe("one tempo method per rail", () => {
  test("serves two offers with different payees through one mppx instance", async () => {
    const payeeA = "0x00000000000000000000000000000000000000a1" as const;
    const sellerB = "0x00000000000000000000000000000000000000b2" as const;
    const reference = `0x${"ab".repeat(32)}`;
    const receipt = {
      method: "tempo",
      reference,
      status: "success" as const,
      timestamp: new Date().toISOString(),
    };
    const calls: Array<{ kind: "validate" | "broadcast"; credential: string }> = [];
    const receivers = new Set<unknown>();
    const fake: NonNullable<MppRailOptions["tempoMppx"]> = {
      validateCredential: async function (this: unknown, credential: string) {
        receivers.add(this);
        calls.push({ kind: "validate", credential });
      },
      broadcastCredential: async function (this: unknown, credential: string) {
        receivers.add(this);
        calls.push({ kind: "broadcast", credential });
        return receipt;
      },
    };
    const rail = railWith({ tempoMppx: fake, payerOf: async () => undefined });

    const offers = [
      offer("10000", { payTo: { mpp: payeeA } }),
      offer("10000", { seller: sellerB, payTo: {} }),
    ];
    const recipients: string[] = [];

    for (const [index, o] of offers.entries()) {
      const req = rail.challenge(o, { resource: RESOURCE, now: nowSeconds() });
      const hash = `0x${(index + 1).toString(16).padStart(2, "0").repeat(32)}`;
      const { challenge, serialized } = tempoPayload(req, undefined, hash);
      if (typeof challenge.request.recipient !== "string") throw new Error("no recipient");
      recipients.push(challenge.request.recipient);

      expect(await rail.verify(paymentFor(req, serialized), req)).toEqual({ isValid: true });
      const settled = await rail.settle(paymentFor(req, serialized), req);
      expect(settled.success).toBe(true);
      expect(settled.transaction).toBe(reference);
    }

    expect(recipients).toEqual([payeeA, sellerB]);
    expect(calls).toHaveLength(4);
    expect(calls.filter((call) => call.kind === "validate")).toHaveLength(2);
    expect(calls.filter((call) => call.kind === "broadcast")).toHaveLength(2);
    expect(receivers.size).toBe(1);
    expect(receivers.has(fake)).toBe(true);
  });

  test("refuses another payee's credential before calling mppx", async () => {
    const payeeA = "0x00000000000000000000000000000000000000a1" as const;
    const sellerB = "0x00000000000000000000000000000000000000b2" as const;
    let calls = 0;
    const fake: NonNullable<MppRailOptions["tempoMppx"]> = {
      validateCredential: async () => {
        calls += 1;
      },
      broadcastCredential: async () => {
        calls += 1;
        return {
          method: "tempo",
          reference: `0x${"ab".repeat(32)}`,
          status: "success",
          timestamp: new Date().toISOString(),
        };
      },
    };
    const rail = railWith({ tempoMppx: fake });

    const reqA = rail.challenge(offer("10000", { payTo: { mpp: payeeA } }), {
      resource: RESOURCE,
      now: nowSeconds(),
    });
    const reqB = rail.challenge(offer("10000", { seller: sellerB, payTo: {} }), {
      resource: RESOURCE,
      now: nowSeconds(),
    });
    const { serialized } = tempoPayload(reqA);

    expect(await rail.verify(paymentFor(reqB, serialized), reqB)).toEqual({
      isValid: false,
      invalidReason: "offer_mismatch",
    });
    expect(calls).toBe(0);
  });
});

describe("constructor", () => {
  test("builds without a rail-level recipient", () => {
    const rail = createMppRail({ secretKey: SECRET, realm: REALM });
    const req = rail.challenge(offer("10000"), { resource: RESOURCE, now: nowSeconds() });
    expect(req.payTo).toBe(RECIPIENT);
  });

  test("refuses a malformed fallback recipient", () => {
    expect(() => railWith({ recipient: "0x1234" })).toThrow(/recipient/);
  });

  test("refuses a zero fallback address", () => {
    expect(() => railWith({ recipient: "0x0000000000000000000000000000000000000000" })).toThrow(/zero/);
  });
});

const MPP_SOURCE_DIR = join(import.meta.dir, "..");
const FORBIDDEN_MARKERS = ["4217", "0x20c000000000000000000000b9537d11c60e8b50"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "test" ? [] : sourceFiles(path);
    if (!entry.isFile() || entry.name.includes(".test.")) return [];
    return [path];
  });
}

describe("testnet guard", () => {
  test("no mainnet chain id or USDC.e address in the mpp sources", () => {
    const files = sourceFiles(MPP_SOURCE_DIR);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(file, "utf8").toLowerCase();
      for (const marker of FORBIDDEN_MARKERS) {
        expect({ file, marker, found: text.includes(marker) }).toEqual({ file, marker, found: false });
      }
    }
  });
});
