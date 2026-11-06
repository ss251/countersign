// The mpp rail: Stripe Machine Payments Protocol. One rail id ("mpp") with two
// methods: a card through Stripe and USDC on Tempo. The MPP challenge travels in
// `extra.mpp.wwwAuthenticate`; credentials come back as `payload.credential`.
import {
  offerHash,
  type Offer,
  type PaymentPayload,
  type PaymentRequirements,
  type SettleResult,
  type VerifyResult,
} from "@countersign/core";
import { Challenge, Credential, Receipt } from "mppx";
import { Mppx, stripe } from "mppx/server";
import { Methods as StripeMethods } from "mppx/stripe";
import { Methods as TempoMethods } from "mppx/tempo";
import type { ChallengeContext, Rail, RailDeclaration } from "../rail.ts";
import {
  CARD_DECIMALS,
  CARD_FLOOR,
  ATOMIC_PER_CENT,
  MPP_STRIPE,
  MPP_TEMPO,
  PLACEHOLDER_TEMPO_RECIPIENT,
  STABLECOIN_FLOOR,
  TEMPO_ASSET,
  TEMPO_DECIMALS,
  TEMPO_USDC,
} from "./constants.ts";
import type { StripeClientLike } from "./types.ts";

export type MppRefusal =
  | "not_mpp"
  | "malformed"
  | "unsupported_method"
  | "method_not_offered"
  | "challenge_not_ours"
  | "offer_mismatch"
  | "amount_mismatch"
  | "currency_mismatch"
  | "expired"
  | "replay"
  | "tempo_verification_requires_rpc"
  | "tempo_settlement_requires_rpc"
  | "payment_failed";

/** Countersign wording for each refusal, for the hub to show the buyer. */
export const MPP_REFUSALS: Record<MppRefusal, string> = {
  not_mpp: "Refused. This payment is not for the mpp rail.",
  malformed: "Refused. The payment could not be read.",
  unsupported_method: "Refused. The payment names an MPP method this rail does not serve.",
  method_not_offered: "Refused. The payment names a method this offer did not offer.",
  challenge_not_ours: "Refused. The payment was not made for this challenge.",
  offer_mismatch: "Refused. The payment was made for a different offer.",
  amount_mismatch: "Refused. The price moved after you paid.",
  currency_mismatch: "Refused. The payment is in the wrong currency.",
  expired: "Refused. The payment challenge expired before it was settled.",
  replay: "Refused. This payment was already used.",
  tempo_verification_requires_rpc: "Not verified. Tempo payments need a live Tempo RPC.",
  tempo_settlement_requires_rpc: "Not settled. Tempo payments need a live Tempo RPC.",
  payment_failed: "Not settled. Stripe did not confirm the PaymentIntent.",
};

export interface SettledStore {
  has(id: string): boolean | Promise<boolean>;
  /** Records the id atomically; false when it was already there. */
  claim(id: string): boolean | Promise<boolean>;
}

export interface MppRailOptions {
  /** Stripe client. The mock implements the same duck-typed surface as the SDK. */
  client: StripeClientLike;
  /** Stripe business network profile id, used as the card payTo. */
  networkId: string;
  /** HMAC secret for challenge ids, at least 32 bytes. Not a Stripe key. */
  secretKey: string;
  /** Challenge realm, e.g. "hub.example.com". */
  realm: string;
  /** How long a challenge may be paid. Defaults to 300 seconds. */
  maxTimeoutSeconds?: number;
  /** Tempo payee. Defaults to a clear placeholder until a deposit address exists. */
  tempoRecipient?: string;
  /** Challenge ids already settled. Defaults to an in-memory store. */
  seen?: SettledStore;
}

export const MPP_DECLARATION: RailDeclaration = {
  id: "mpp",
  // The declaration describes the stablecoin method: it is the method that can
  // be exercised without Stripe credentials, and the one whose asset is concrete.
  network: MPP_TEMPO,
  scheme: "exact",
  asset: TEMPO_ASSET,
  kind: "direct",
  gasPaidBy: "facilitator",
  finality: "Final when Stripe confirms the PaymentIntent.",
  explorerTx: "https://dashboard.stripe.com/test/payments/{tx}",
};

function memoryStore(): SettledStore {
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

function atomicPrice(price: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(price)) throw new Error(`offer price is not an atomic digit string: ${price}`);
  return BigInt(price);
}

function toDecimal(value: bigint, decimals: number): string {
  const digits = value.toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

type MppChallenge = ReturnType<typeof Challenge.deserialize>;

type Inspected =
  | { ok: true; method: "stripe" | "tempo"; challenge: MppChallenge; credential: string }
  | { ok: false; reason: MppRefusal };

export type MppRail = Rail;

export function createMppRail(options: MppRailOptions): MppRail {
  const { client, networkId, secretKey, realm } = options;
  const maxTimeoutSeconds = options.maxTimeoutSeconds ?? 300;
  const tempoRecipient = options.tempoRecipient ?? PLACEHOLDER_TEMPO_RECIPIENT;
  const seen = options.seen ?? memoryStore();

  const mppx = Mppx.create({
    methods: [
      stripe.charge({
        client,
        networkId,
        currency: "usd",
        decimals: CARD_DECIMALS,
        paymentMethodTypes: ["card"],
      }),
    ],
    secretKey,
    realm,
  });

  function challengeFor(
    offer: Offer,
    price: bigint,
    expires: string,
    hash: string,
    method: "tempo" | "stripe",
  ): MppChallenge {
    if (method === "tempo") {
      return Challenge.fromMethod(TempoMethods.charge, {
        realm,
        secretKey,
        expires,
        description: offer.title,
        request: {
          amount: toDecimal(price, TEMPO_DECIMALS),
          currency: TEMPO_USDC,
          decimals: TEMPO_DECIMALS,
          recipient: tempoRecipient,
          externalId: hash,
        },
      });
    }
    return Challenge.fromMethod(StripeMethods.charge, {
      realm,
      secretKey,
      expires,
      description: offer.title,
      request: {
        amount: toDecimal(price / ATOMIC_PER_CENT, CARD_DECIMALS),
        currency: "usd",
        decimals: CARD_DECIMALS,
        networkId,
        paymentMethodTypes: ["card"],
        externalId: hash,
      },
    });
  }

  function inspect(payment: PaymentPayload, requirements: PaymentRequirements): Inspected {
    if (requirements.scheme !== "exact") return { ok: false, reason: "not_mpp" };
    if (requirements.network !== MPP_STRIPE && requirements.network !== MPP_TEMPO) {
      return { ok: false, reason: "not_mpp" };
    }
    const extra = requirements.extra as
      | { offerHash?: unknown; mpp?: { wwwAuthenticate?: unknown; methods?: unknown } }
      | undefined;
    const hash = extra?.offerHash;
    const header = extra?.mpp?.wwwAuthenticate;
    const methods = extra?.mpp?.methods;
    if (typeof hash !== "string" || typeof header !== "string" || !Array.isArray(methods)) {
      return { ok: false, reason: "malformed" };
    }
    if (payment?.x402Version !== 2) return { ok: false, reason: "malformed" };
    const raw = payment.payload?.credential;
    if (typeof raw !== "string") return { ok: false, reason: "malformed" };

    let credential: ReturnType<typeof Credential.deserialize>;
    try {
      credential = Credential.deserialize(raw);
    } catch {
      return { ok: false, reason: "malformed" };
    }
    const challenge = credential.challenge;
    if (challenge.method !== "stripe" && challenge.method !== "tempo") {
      return { ok: false, reason: "unsupported_method" };
    }
    if (!methods.includes(challenge.method)) return { ok: false, reason: "method_not_offered" };
    if (challenge.intent !== "charge") return { ok: false, reason: "malformed" };
    if (!Challenge.verify(challenge, { secretKey })) return { ok: false, reason: "challenge_not_ours" };
    if (challenge.realm !== realm) return { ok: false, reason: "challenge_not_ours" };

    let issued: MppChallenge | undefined;
    try {
      issued = Challenge.deserializeList(header).find(
        (candidate) => candidate.method === challenge.method && candidate.id === challenge.id,
      );
    } catch {
      return { ok: false, reason: "malformed" };
    }
    if (!issued) return { ok: false, reason: "challenge_not_ours" };
    if (challenge.request.externalId !== hash || issued.request.externalId !== hash) {
      return { ok: false, reason: "offer_mismatch" };
    }

    const expires = challenge.expires;
    if (!expires) return { ok: false, reason: "expired" };
    const expiresAt = Date.parse(expires);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return { ok: false, reason: "expired" };

    // Every field that decides what the seller receives must match the challenge
    // this rail issued, not just the HMAC-bound copy the buyer sent back.
    if (challenge.request.amount !== issued.request.amount) return { ok: false, reason: "amount_mismatch" };
    if (challenge.method === "stripe") {
      if (requirements.asset !== "usd") return { ok: false, reason: "currency_mismatch" };
      if (challenge.request.currency !== "usd") return { ok: false, reason: "currency_mismatch" };
      if (requirements.amount !== challenge.request.amount) return { ok: false, reason: "amount_mismatch" };
    } else {
      if (requirements.asset !== TEMPO_USDC) return { ok: false, reason: "currency_mismatch" };
      if (challenge.request.currency !== TEMPO_USDC) return { ok: false, reason: "currency_mismatch" };
      if (challenge.request.recipient !== tempoRecipient) return { ok: false, reason: "offer_mismatch" };
      if (requirements.network === MPP_TEMPO && requirements.amount !== challenge.request.amount) {
        return { ok: false, reason: "amount_mismatch" };
      }
    }

    const payload = credential.payload;
    if (!payload || typeof payload !== "object") return { ok: false, reason: "malformed" };
    if (challenge.method === "stripe") {
      const proof = payload as { spt?: unknown; externalId?: unknown };
      if (typeof proof.spt !== "string" || proof.spt.length === 0) return { ok: false, reason: "malformed" };
      if (proof.externalId !== undefined && proof.externalId !== hash) {
        return { ok: false, reason: "offer_mismatch" };
      }
    } else {
      const proof = payload as { type?: unknown; hash?: unknown; signature?: unknown };
      const shaped =
        (proof.type === "hash" && typeof proof.hash === "string") ||
        ((proof.type === "transaction" || proof.type === "proof") && typeof proof.signature === "string");
      if (!shaped) return { ok: false, reason: "malformed" };
    }

    return { ok: true, method: challenge.method, challenge, credential: raw };
  }

  return {
    declaration: MPP_DECLARATION,

    challenge(offer: Offer, ctx: ChallengeContext): PaymentRequirements {
      const price = atomicPrice(offer.price);
      if (price < STABLECOIN_FLOOR) {
        throw new Error(
          `offer price ${offer.price} is below the 0.01 USDC stablecoin floor (${STABLECOIN_FLOOR.toString()} atomic units)`,
        );
      }
      // The card method needs a whole number of cents and at least 0.50 USD.
      // Anything above the stablecoin floor still gets a Tempo challenge.
      const card = price >= CARD_FLOOR && price % ATOMIC_PER_CENT === 0n;
      const hash = offerHash(offer);
      const expires = new Date((ctx.now + maxTimeoutSeconds) * 1000).toISOString();
      const methods: Array<"tempo" | "stripe"> = card ? ["tempo", "stripe"] : ["tempo"];
      const challenges = methods.map((method) => challengeFor(offer, price, expires, hash, method));
      const wwwAuthenticate = challenges.map((challenge) => Challenge.serialize(challenge)).join(", ");
      return {
        scheme: "exact",
        network: card ? MPP_STRIPE : MPP_TEMPO,
        amount: card ? (price / ATOMIC_PER_CENT).toString() : price.toString(),
        asset: card ? "usd" : TEMPO_USDC,
        payTo: card ? networkId : tempoRecipient,
        maxTimeoutSeconds,
        extra: {
          offerHash: hash,
          mpp: { wwwAuthenticate, methods },
        },
      };
    },

    async verify(payment: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResult> {
      const inspected = inspect(payment, requirements);
      if (!inspected.ok) return { isValid: false, invalidReason: inspected.reason };
      if (inspected.method === "tempo") {
        // mppx's Tempo verifier reads the chain for the transaction or its
        // receipt. No live RPC is allowed in this lane, so stop after the
        // structural checks above until one is configured.
        return { isValid: false, invalidReason: "tempo_verification_requires_rpc" };
      }
      if (await seen.has(inspected.challenge.id)) {
        return { isValid: false, invalidReason: "replay" };
      }
      return { isValid: true };
    },

    async settle(payment: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResult> {
      const inspected = inspect(payment, requirements);
      if (!inspected.ok) {
        return {
          success: false,
          errorReason: inspected.reason,
          transaction: "",
          network: requirements.network,
        };
      }
      if (inspected.method === "tempo") {
        return {
          success: false,
          errorReason: "tempo_settlement_requires_rpc",
          transaction: "",
          network: MPP_TEMPO,
        };
      }
      // A claim is never released: a failed payment is re-signed, not retried.
      if (!(await seen.claim(inspected.challenge.id))) {
        return { success: false, errorReason: "replay", transaction: "", network: MPP_STRIPE };
      }
      try {
        const receipt = await mppx.broadcastCredential(inspected.credential);
        return {
          success: true,
          transaction: receipt.reference,
          network: MPP_STRIPE,
          receipt: Receipt.serialize(receipt),
        };
      } catch {
        return { success: false, errorReason: "payment_failed", transaction: "", network: MPP_STRIPE };
      }
    },
  };
}
