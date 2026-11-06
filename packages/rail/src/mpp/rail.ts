// The mpp rail: Machine Payments Protocol. One rail id ("mpp") with two
// methods: pathUSD on Tempo Moderato (always offered) and a card through Stripe
// (only when a client is configured). The MPP challenge travels in
// `extra.mpp.wwwAuthenticate`; credentials come back as `payload.credential`.
import {
  offerHash,
  type Offer,
  type PaymentPayload,
  type PaymentRequirements,
  type SettleResult,
  type VerifyResult,
} from "@countersign/core";
import { Challenge, Credential, Receipt, Store } from "mppx";
import { Mppx, stripe, tempo } from "mppx/server";
import { Methods as StripeMethods } from "mppx/stripe";
import { getAddress, type Address } from "viem";
import type { ChallengeContext, Rail, RailDeclaration } from "../rail.ts";
import {
  CARD_DECIMALS,
  CARD_FLOOR,
  ATOMIC_PER_CENT,
  MPP_STRIPE,
  MPP_TEMPO,
  STABLECOIN_FLOOR,
  TEMPO_ASSET,
  TEMPO_CHAIN_ID,
  TEMPO_CURRENCY,
  TEMPO_DECIMALS,
} from "./constants.ts";
import type { StripeClientLike } from "./types.ts";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export type MppRefusal =
  | "not_mpp"
  | "malformed"
  | "unsupported_method"
  | "method_not_offered"
  | "challenge_not_ours"
  | "offer_mismatch"
  | "amount_mismatch"
  | "currency_mismatch"
  | "chain_mismatch"
  | "expired"
  | "replay"
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
  chain_mismatch: "Refused. The payment is for a different Tempo chain.",
  expired: "Refused. The payment challenge expired before it was settled.",
  replay: "Refused. This payment was already used.",
  payment_failed: "Not settled. The payment was not confirmed.",
};

export interface SettledStore {
  has(id: string): boolean | Promise<boolean>;
  /** Records the id atomically; false when it was already there. */
  claim(id: string): boolean | Promise<boolean>;
}

export interface MppRailOptions {
  /** Tempo payee address. Required: the rail always offers Tempo. */
  recipient: string;
  /** HMAC secret for challenge ids, at least 32 bytes. Not a Stripe key. */
  secretKey: string;
  /** Challenge realm, e.g. "hub.example.com". */
  realm: string;
  /** Optional card method. Without it the rail offers Tempo only. */
  stripe?: { client: StripeClientLike; networkId: string };
  /** How long a challenge may be paid. Defaults to 300 seconds. */
  maxTimeoutSeconds?: number;
  /** Challenge ids already settled. Defaults to an in-memory store. */
  seen?: SettledStore;
}

const DECLARED = {
  id: "mpp",
  network: MPP_TEMPO,
  scheme: "exact",
  asset: TEMPO_ASSET,
  kind: "direct",
  gasPaidBy: "buyer",
  finality: "Final when the Tempo transaction is included on Moderato.",
  explorerTx: "https://explore.testnet.tempo.xyz/tx/{tx}",
} satisfies Omit<RailDeclaration, "gasPaidBy"> & { gasPaidBy: string };

export const MPP_DECLARATION: RailDeclaration = DECLARED as RailDeclaration;

/**
 * Requires a checksummed or lowercase 20-byte hex address that is not zero.
 * The original string is kept so the challenge echoes exactly what was
 * configured, rather than a normalised form.
 */
export function assertTempoRecipient(value: unknown): asserts value is Address {
  if (typeof value !== "string") throw new Error("mpp rail requires a Tempo recipient address");
  let normalised: Address;
  try {
    normalised = getAddress(value);
  } catch {
    throw new Error("mpp rail recipient is not a valid 20-byte hex address");
  }
  if (normalised === ZERO_ADDRESS) throw new Error("mpp rail recipient is the zero address");
}

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

function atomicAmount(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) return null;
  return BigInt(value);
}

function tempoAmount(requirements: PaymentRequirements): bigint | null {
  const amount = atomicAmount(requirements.amount);
  if (amount === null) return null;
  if (requirements.network === MPP_TEMPO) return amount;
  if (requirements.network === MPP_STRIPE) return amount * ATOMIC_PER_CENT;
  return null;
}

type MppChallenge = ReturnType<typeof Challenge.deserialize>;

export interface MppInspectionOptions {
  secretKey: string;
  realm: string;
  recipient: string;
}

export type MppInspection =
  | { ok: true; method: "stripe" | "tempo"; challenge: MppChallenge; credential: string }
  | { ok: false; reason: MppRefusal };

/**
 * Checks a credential against the requirements in front of it without trusting
 * the challenge id. The hub re-issues requirements on the paid retry, so a
 * freshly issued challenge has a different id; the credential's challenge is
 * instead proved by its HMAC and checked field by field against the current
 * requirements.
 */
export function inspectMppPayment(
  payment: PaymentPayload,
  requirements: PaymentRequirements,
  options: MppInspectionOptions,
): MppInspection {
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
  if (!methods.every((method) => typeof method === "string")) {
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
  if (challenge.intent !== "charge") return { ok: false, reason: "malformed" };
  if (!Challenge.verify(challenge, { secretKey: options.secretKey })) {
    return { ok: false, reason: "challenge_not_ours" };
  }
  if (challenge.realm !== options.realm) return { ok: false, reason: "challenge_not_ours" };
  if (!methods.includes(challenge.method)) return { ok: false, reason: "method_not_offered" };
  if (challenge.request.externalId !== hash) return { ok: false, reason: "offer_mismatch" };

  if (challenge.method === "tempo") {
    const expected = tempoAmount(requirements);
    if (expected === null || challenge.request.amount !== expected.toString()) {
      return { ok: false, reason: "amount_mismatch" };
    }
    if (requirements.network === MPP_TEMPO && requirements.asset !== TEMPO_CURRENCY) {
      return { ok: false, reason: "currency_mismatch" };
    }
    if (requirements.network === MPP_STRIPE && requirements.asset !== "usd") {
      return { ok: false, reason: "currency_mismatch" };
    }
    if (challenge.request.currency !== TEMPO_CURRENCY) {
      return { ok: false, reason: "currency_mismatch" };
    }
    if (challenge.request.recipient !== options.recipient) {
      return { ok: false, reason: "offer_mismatch" };
    }
    if (requirements.network === MPP_TEMPO && requirements.payTo !== options.recipient) {
      return { ok: false, reason: "offer_mismatch" };
    }
    const details = challenge.request.methodDetails as { chainId?: unknown } | undefined;
    if (details?.chainId !== TEMPO_CHAIN_ID) return { ok: false, reason: "chain_mismatch" };
  } else {
    if (requirements.asset !== "usd") return { ok: false, reason: "currency_mismatch" };
    if (challenge.request.currency !== "usd") return { ok: false, reason: "currency_mismatch" };
    if (requirements.amount !== challenge.request.amount) return { ok: false, reason: "amount_mismatch" };
  }

  const expires = challenge.expires;
  if (!expires) return { ok: false, reason: "expired" };
  const expiresAt = Date.parse(expires);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return { ok: false, reason: "expired" };

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

export type MppRail = Rail;

export function createMppRail(options: MppRailOptions): MppRail {
  const recipient = options.recipient;
  assertTempoRecipient(recipient);
  const { secretKey, realm } = options;
  const maxTimeoutSeconds = options.maxTimeoutSeconds ?? 300;
  const stripeOptions = options.stripe;
  const seen = options.seen ?? memoryStore();

  const tempoCharge = tempo.charge({
    testnet: true,
    recipient,
    currencies: [TEMPO_CURRENCY],
    store: Store.memory(),
  })[0]!;

  const stripeCharge = stripeOptions
    ? stripe.charge({
        client: stripeOptions.client,
        networkId: stripeOptions.networkId,
        currency: "usd",
        decimals: CARD_DECIMALS,
        paymentMethodTypes: ["card"],
      })
    : undefined;

  const mppx = Mppx.create({
    methods: stripeCharge ? [tempoCharge, stripeCharge] : [tempoCharge],
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
      return Challenge.fromMethod(tempoCharge, {
        realm,
        secretKey,
        expires,
        description: offer.title,
        request: {
          amount: toDecimal(price, TEMPO_DECIMALS),
          currency: TEMPO_CURRENCY,
          decimals: TEMPO_DECIMALS,
          recipient,
          externalId: hash,
          chainId: TEMPO_CHAIN_ID,
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
        networkId: stripeOptions!.networkId,
        paymentMethodTypes: ["card"],
        externalId: hash,
      },
    });
  }

  function inspect(payment: PaymentPayload, requirements: PaymentRequirements): MppInspection {
    return inspectMppPayment(payment, requirements, { secretKey, realm, recipient });
  }

  return {
    declaration: MPP_DECLARATION,

    challenge(offer: Offer, ctx: ChallengeContext): PaymentRequirements {
      const price = atomicPrice(offer.price);
      if (price < STABLECOIN_FLOOR) {
        throw new Error(
          `offer price ${offer.price} is below the 0.01 pathUSD stablecoin floor (${STABLECOIN_FLOOR.toString()} atomic units)`,
        );
      }
      const card =
        stripeOptions !== undefined && price >= CARD_FLOOR && price % ATOMIC_PER_CENT === 0n;
      const hash = offerHash(offer);
      const expires = new Date((ctx.now + maxTimeoutSeconds) * 1000).toISOString();
      const methods: Array<"tempo" | "stripe"> = card ? ["tempo", "stripe"] : ["tempo"];
      const challenges = methods.map((method) => challengeFor(offer, price, expires, hash, method));
      const wwwAuthenticate = challenges.map((challenge) => Challenge.serialize(challenge)).join(", ");
      return {
        scheme: "exact",
        network: card ? MPP_STRIPE : MPP_TEMPO,
        amount: card ? (price / ATOMIC_PER_CENT).toString() : price.toString(),
        asset: card ? "usd" : TEMPO_CURRENCY,
        payTo: card ? stripeOptions!.networkId : recipient,
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
      if (await seen.has(inspected.challenge.id)) {
        return { isValid: false, invalidReason: "replay" };
      }
      if (inspected.method === "tempo") {
        try {
          await mppx.validateCredential(inspected.credential);
        } catch {
          return { isValid: false, invalidReason: "payment_failed" };
        }
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
        if (!(await seen.claim(inspected.challenge.id))) {
          return { success: false, errorReason: "replay", transaction: "", network: MPP_TEMPO };
        }
        try {
          const receipt = await mppx.broadcastCredential(inspected.credential);
          return {
            success: true,
            transaction: receipt.reference,
            network: MPP_TEMPO,
            receipt: Receipt.serialize(receipt),
          };
        } catch {
          return { success: false, errorReason: "payment_failed", transaction: "", network: MPP_TEMPO };
        }
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
