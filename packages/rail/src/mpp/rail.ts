// The mpp rail: Machine Payments Protocol. One rail id ("mpp") with two
// methods: pathUSD on Tempo Moderato (always offered) and a card through Stripe
// (only when a client is configured). The MPP challenge travels in
// `extra.mpp.wwwAuthenticate`; credentials come back as `payload.credential`.
import { randomBytes } from "node:crypto";
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
import {
  createPublicClient,
  erc20Abi,
  getAddress,
  http,
  isHex,
  keccak256,
  parseEventLogs,
  type Address,
  type Hex,
  type Log,
} from "viem";
import { tempoModerato } from "viem/chains";
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
  /**
   * Forgets an id after a settlement that did not happen. Optional so a store
   * written before claims could be released still satisfies the interface.
   */
  release?(id: string): void | Promise<void>;
}

export interface MppRailOptions {
  /**
   * Fallback Tempo payee. An offer's payee is its seller, or its `payTo.mpp`
   * when set, so this is used only when an offer names no payee at all. Kept
   * for the demo server.
   */
  recipient?: string;
  /** HMAC secret for challenge ids, at least 32 bytes. Not a Stripe key. */
  secretKey: string;
  /** Challenge realm, e.g. "hub.example.com". */
  realm: string;
  /** Optional card method. Without it the rail offers Tempo only. */
  stripe?: { client: StripeClientLike; networkId: string };
  /** Tests only: the mppx instance that validates and broadcasts Tempo credentials. */
  tempoMppx?: {
    validateCredential(credential: string): Promise<unknown>;
    broadcastCredential(credential: string): Promise<Receipt.Receipt>;
  };
  /**
   * Reads the actual payer of a Tempo transfer from the chain. Defaults to the
   * sender of the matching pathUSD Transfer log on Moderato.
   */
  payerOf?: (txHash: Hex, expect: { recipient: string; amount: bigint }) => Promise<string | undefined>;
  /** How long a challenge may be paid. Defaults to 300 seconds. */
  maxTimeoutSeconds?: number;
  /** Challenge ids already settled. Defaults to an in-memory store. */
  seen?: SettledStore;
}

export const MPP_DECLARATION: RailDeclaration = {
  id: "mpp",
  network: MPP_TEMPO,
  scheme: "exact",
  asset: TEMPO_ASSET,
  kind: "direct",
  gasPaidBy: "buyer",
  finality: "Final when the Tempo transaction is included on Moderato.",
  explorerTx: "https://explore.testnet.tempo.xyz/tx/{tx}",
};

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

function challengeKey(id: string): string {
  return `challenge:${id}`;
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
    release: (id) => {
      ids.delete(id);
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
}

export type MppInspection =
  | {
      ok: true;
      method: "stripe" | "tempo";
      challenge: MppChallenge;
      credential: string;
      /** What the payment moved: the tx hash or the signed transaction. */
      transferKey: string;
    }
  | { ok: false; reason: MppRefusal };

/** The sender of the matching ERC-20 Transfer log, checksummed. */
export function payerFromReceipt(
  receipt: { logs: readonly Log[] },
  expect: { currency: string; recipient: string; amount: bigint },
): string | undefined {
  const transfers = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: [...receipt.logs] });
  for (const transfer of transfers) {
    if (!sameAddress(transfer.address, expect.currency)) continue;
    if (!sameAddress(transfer.args.to, expect.recipient)) continue;
    if (transfer.args.value !== expect.amount) continue;
    return getAddress(transfer.args.from);
  }
  return undefined;
}

async function payerFromChain(
  txHash: Hex,
  expect: { recipient: string; amount: bigint },
): Promise<string | undefined> {
  try {
    const client = createPublicClient({ chain: tempoModerato, transport: http() });
    const receipt = await client.getTransactionReceipt({ hash: txHash });
    return payerFromReceipt(receipt, { currency: TEMPO_CURRENCY, ...expect });
  } catch {
    return undefined;
  }
}

function sameAddress(left: unknown, right: unknown): boolean {
  if (typeof left !== "string" || typeof right !== "string") return false;
  try {
    return getAddress(left) === getAddress(right);
  } catch {
    return false;
  }
}

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
    if (requirements.network === MPP_TEMPO && !sameAddress(challenge.request.recipient, requirements.payTo)) {
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
  let transferKey: string;
  if (challenge.method === "stripe") {
    const proof = payload as { spt?: unknown; externalId?: unknown };
    if (typeof proof.spt !== "string" || proof.spt.length === 0) return { ok: false, reason: "malformed" };
    if (proof.externalId !== undefined && proof.externalId !== hash) {
      return { ok: false, reason: "offer_mismatch" };
    }
    transferKey = `stripe-spt:${proof.spt}`;
  } else {
    const proof = payload as { type?: unknown; hash?: unknown; signature?: unknown };
    if (proof.type === "hash" && typeof proof.hash === "string") {
      transferKey = `tempo-hash:${proof.hash.toLowerCase()}`;
    } else if (
      proof.type === "transaction" &&
      typeof proof.signature === "string" &&
      isHex(proof.signature)
    ) {
      transferKey = `tempo-tx:${keccak256(proof.signature)}`;
    } else {
      // A proof credential cannot pay a priced offer (the floor is 0.01).
      return { ok: false, reason: "malformed" };
    }
  }

  return { ok: true, method: challenge.method, challenge, credential: raw, transferKey };
}

export type MppRail = Rail;

export function createMppRail(options: MppRailOptions): MppRail {
  const { secretKey, realm } = options;
  const fallbackRecipient = options.recipient;
  if (fallbackRecipient !== undefined) assertTempoRecipient(fallbackRecipient);
  const maxTimeoutSeconds = options.maxTimeoutSeconds ?? 300;
  const stripeOptions = options.stripe;
  const seen = options.seen ?? memoryStore();
  const payerOf = options.payerOf ?? payerFromChain;

  // One Tempo method serves every payee: mppx's standalone validate and broadcast
  // verify against the HMAC-bound challenge's own recipient, and the rail's
  // inspection pins that recipient to `requirements.payTo`.
  const tempoCharge = tempo.charge({
    testnet: true,
    currencies: [TEMPO_CURRENCY],
    store: Store.memory(),
  })[0]!;
  const tempoMppx = options.tempoMppx ?? Mppx.create({ methods: [tempoCharge], secretKey, realm });

  function tempoPayeeFor(offer: Offer): string {
    const payee: string | undefined = offer.payTo?.mpp ?? offer.seller ?? fallbackRecipient;
    assertTempoRecipient(payee);
    return payee;
  }

  const stripeCharge = stripeOptions
    ? stripe.charge({
        client: stripeOptions.client,
        networkId: stripeOptions.networkId,
        currency: "usd",
        decimals: CARD_DECIMALS,
        paymentMethodTypes: ["card"],
      })
    : undefined;

  const stripeMppx = stripeCharge
    ? Mppx.create({ methods: [stripeCharge], secretKey, realm })
    : undefined;

  function challengeFor(
    offer: Offer,
    payee: string,
    price: bigint,
    expires: string,
    hash: string,
    method: "tempo" | "stripe",
  ): MppChallenge {
    const nonce = randomBytes(16).toString("hex");
    if (method === "tempo") {
      return Challenge.fromMethod(tempoCharge, {
        realm,
        secretKey,
        expires,
        description: offer.title,
        meta: { nonce },
        request: {
          amount: toDecimal(price, TEMPO_DECIMALS),
          currency: TEMPO_CURRENCY,
          decimals: TEMPO_DECIMALS,
          recipient: payee,
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
      meta: { nonce },
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
    return inspectMppPayment(payment, requirements, { secretKey, realm });
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
      const payee = tempoPayeeFor(offer);
      const card =
        stripeOptions !== undefined && price >= CARD_FLOOR && price % ATOMIC_PER_CENT === 0n;
      const hash = offerHash(offer);
      const expires = new Date((ctx.now + maxTimeoutSeconds) * 1000).toISOString();
      const methods: Array<"tempo" | "stripe"> = card ? ["tempo", "stripe"] : ["tempo"];
      const challenges = methods.map((method) => challengeFor(offer, payee, price, expires, hash, method));
      const wwwAuthenticate = challenges.map((challenge) => Challenge.serialize(challenge)).join(", ");
      return {
        scheme: "exact",
        network: card ? MPP_STRIPE : MPP_TEMPO,
        amount: card ? (price / ATOMIC_PER_CENT).toString() : price.toString(),
        asset: card ? "usd" : TEMPO_CURRENCY,
        payTo: card ? stripeOptions!.networkId : payee,
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
      if (await seen.has(challengeKey(inspected.challenge.id))) {
        return { isValid: false, invalidReason: "replay" };
      }
      if (await seen.has(inspected.transferKey)) {
        return { isValid: false, invalidReason: "replay" };
      }
      if (inspected.method === "tempo") {
        try {
          await tempoMppx.validateCredential(inspected.credential);
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
      const network = inspected.method === "tempo" ? MPP_TEMPO : MPP_STRIPE;
      if (!(await seen.claim(challengeKey(inspected.challenge.id)))) {
        return { success: false, errorReason: "replay", transaction: "", network };
      }
      if (!(await seen.claim(inspected.transferKey))) {
        await seen.release?.(challengeKey(inspected.challenge.id));
        return { success: false, errorReason: "replay", transaction: "", network };
      }
      let receipt: Receipt.Receipt;
      try {
        receipt =
          inspected.method === "tempo"
            ? await tempoMppx.broadcastCredential(inspected.credential)
            : await stripeMppx!.broadcastCredential(inspected.credential);
      } catch {
        await seen.release?.(challengeKey(inspected.challenge.id));
        await seen.release?.(inspected.transferKey);
        return { success: false, errorReason: "payment_failed", transaction: "", network };
      }
      if (inspected.method === "tempo") {
        const amount = tempoAmount(requirements);
        const payer =
          amount === null || !isHex(receipt.reference)
            ? undefined
            : await payerOf(receipt.reference, {
                recipient: String(inspected.challenge.request.recipient),
                amount,
              });
        return {
          success: true,
          transaction: receipt.reference,
          network,
          receipt: Receipt.serialize(receipt),
          ...(payer ? { payer } : {}),
        };
      }
      return {
        success: true,
        transaction: receipt.reference,
        network,
        receipt: Receipt.serialize(receipt),
      };
    },
  };
}
