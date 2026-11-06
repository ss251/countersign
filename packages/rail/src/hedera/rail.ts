// The hedera rail: USDC (HTS) on Hedera testnet, settled by an x402 v2 `exact` facilitator.
// Direct rail: the buyer's countersigned transfer is final once Hedera reaches consensus.
import {
  canonicalJson,
  offerHash,
  type Offer,
  type PaymentPayload,
  type PaymentRequirements,
  type SettleResult,
  type VerifyResult,
} from "@countersign/core";
import { createHederaVerifyPayerSignature } from "@x402/hedera";
import type { ChallengeContext, Rail, RailDeclaration } from "../rail.ts";
import { FACILITATORS, HASHSCAN_TESTNET, HEDERA_TESTNET, USDC_DECIMALS, USDC_TESTNET } from "./constants.ts";
import { httpFacilitator, type Facilitator, type X402Payload, type X402Requirements } from "./facilitator.ts";
import { checkTransfer, decodeTransfer, InspectError, type TransferRefusal } from "./inspect.ts";
import { getTransaction, netFor, type MirrorOptions } from "./mirror.ts";
import { offerMemo } from "./memo.ts";

const ACCOUNT_ID = /^0\.0\.\d+$/;
const OFFER_HASH = /^0x[0-9a-f]{64}$/;

export type HederaRefusal =
  | TransferRefusal
  | "requirements_mismatch"
  | "not_hedera"
  | "malformed"
  | "unknown_fee_payer"
  | "signature_invalid"
  | "not_yet_valid"
  | "validity_too_long"
  | "replay"
  | "facilitator_refused"
  | "facilitator_unavailable";

/** Countersign wording for each refusal, for the hub to show the buyer. */
export const HEDERA_REFUSALS: Record<HederaRefusal, string> = {
  wrong_fee_payer: "Refused. The payment names the wrong fee payer.",
  offer_mismatch: "Refused. The payment was signed for a different offer.",
  amount_mismatch: "Refused. The price moved after you signed.",
  wrong_payee: "Refused. The payment does not pay this seller.",
  wrong_asset: "Refused. The payment is in the wrong token.",
  extra_transfers: "Refused. The payment moves more than the price.",
  expired: "Refused. The signed payment expired before it was settled.",
  unsigned: "Refused. The payment carries no signature.",
  not_yet_valid: "Refused. The signed payment is not valid yet.",
  validity_too_long: "Refused. The signed payment stays valid longer than this offer allows.",
  requirements_mismatch: "Refused. The price moved after you signed.",
  not_hedera: "Refused. This payment is not for the hedera rail.",
  malformed: "Refused. The payment could not be read.",
  unknown_fee_payer: "Refused. The payment names a facilitator this hub does not use.",
  signature_invalid: "Refused. The payer's signature does not match its account key.",
  replay: "Refused. This payment was already used.",
  facilitator_refused: "Refused by the facilitator.",
  facilitator_unavailable: "Not settled. The facilitator did not answer; nothing was charged.",
};

export interface SettledStore {
  has(id: string): boolean | Promise<boolean>;
  /** Records the id atomically; false when it was already there. */
  claim(id: string): boolean | Promise<boolean>;
}

export interface HederaRailOptions {
  /** Preference order. Defaults to the hosted facilitators in constants.ts. */
  facilitators?: Facilitator[];
  /** How long the buyer's signed transfer may wait for settlement. Hedera allows at most 180 s. */
  maxTimeoutSeconds?: number;
  /** Unix seconds. */
  now?: () => number;
  mirror?: MirrorOptions;
  /** Payer signature check against the payer's on-chain key. Defaults to the x402 mirror-node check. */
  verifyPayerSignature?: (p: { payer: string; transaction: string; network: string }) => Promise<{ ok: boolean }>;
  /** How long to look for a transaction on the mirror node after a facilitator fails to answer. */
  confirmTimeoutMs?: number;
  /** How often to re-ask the facilitators for their fee payers. 0 turns it off. */
  refreshEveryMs?: number;
  /** Transaction ids already seen. Defaults to an in-memory store. */
  seen?: SettledStore;
  /** Seconds of clock slack when comparing a mirror consensus time with the attempt's start. */
  clockSkewSeconds?: number;
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

export interface HederaRail extends Rail {
  /** Ask every facilitator for its fee payer again; the first that answers becomes active. */
  refresh(): Promise<void>;
  readonly active: { name: string; feePayer: string } | null;
}

export const HEDERA_DECLARATION: RailDeclaration = {
  id: "hedera",
  network: HEDERA_TESTNET,
  scheme: "exact",
  asset: { network: HEDERA_TESTNET, address: USDC_TESTNET, symbol: "USDC", decimals: USDC_DECIMALS },
  kind: "direct",
  gasPaidBy: "facilitator",
  finality: "Final at Hedera consensus, a few seconds after the facilitator submits.",
  explorerTx: `${HASHSCAN_TESTNET}/transaction/{tx}`,
  finalitySeconds: 5,
  cost: { tollBps: 0, fixed: "0" },
};

function toX402Requirements(r: PaymentRequirements): X402Requirements {
  return { ...r, extra: r.extra ?? {} };
}

function toX402Payload(p: PaymentPayload): X402Payload {
  return { ...p, accepted: toX402Requirements(p.accepted) };
}

export async function createHederaRail(opts: HederaRailOptions = {}): Promise<HederaRail> {
  const facilitators = opts.facilitators ?? FACILITATORS.map((f) => httpFacilitator(f.name, f.url));
  const maxTimeoutSeconds = Math.min(Math.max(opts.maxTimeoutSeconds ?? 120, 30), 180);
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  const verifySig = opts.verifyPayerSignature ?? createHederaVerifyPayerSignature();
  const clockSkewSeconds = opts.clockSkewSeconds ?? 5;
  // Transaction ids already claimed. A claim is never released: a failed payment is re-signed, not retried.
  const seen = opts.seen ?? memoryStore();
  const byFeePayer = new Map<string, Facilitator>();
  let active: { name: string; feePayer: string } | null = null;

  async function refresh(): Promise<void> {
    let first: typeof active = null;
    for (const f of facilitators) {
      try {
        const feePayer = await f.feePayer();
        if (!feePayer) continue;
        byFeePayer.set(feePayer, f);
        first ??= { name: f.name, feePayer };
      } catch {
        // Down or unreachable: the next one in order takes over.
      }
    }
    active = first;
  }

  type Checked =
    | { ok: true; payer: string; transaction: string; transactionId: string; facilitator: Facilitator }
    | { ok: false; reason: HederaRefusal; payer?: string };

  function check(payment: PaymentPayload, requirements: PaymentRequirements): Checked {
    if (requirements.network !== HEDERA_TESTNET || requirements.scheme !== "exact") return { ok: false, reason: "not_hedera" };
    if (payment?.x402Version !== 2 || !payment.accepted) return { ok: false, reason: "malformed" };
    // The fee payer is the one field the buyer may take from an earlier challenge: it only picks which
    // known facilitator pays the network fee. Everything that decides what the seller gets must match.
    const feePayer = payment.accepted.extra?.feePayer;
    const strip = (r: PaymentRequirements) => ({ ...r, extra: { ...r.extra, feePayer: null } });
    if (canonicalJson(strip(payment.accepted)) !== canonicalJson(strip(requirements))) {
      return { ok: false, reason: "requirements_mismatch" };
    }
    const hash = requirements.extra?.offerHash;
    const transaction = payment.payload?.transaction;
    if (typeof feePayer !== "string" || typeof hash !== "string" || typeof transaction !== "string") {
      return { ok: false, reason: "malformed" };
    }
    const facilitator = byFeePayer.get(feePayer);
    if (!facilitator) return { ok: false, reason: "unknown_fee_payer" };
    let amount: bigint;
    try {
      amount = BigInt(requirements.amount);
    } catch {
      return { ok: false, reason: "malformed" };
    }
    let inspected;
    try {
      inspected = decodeTransfer(transaction);
    } catch (e) {
      if (e instanceof InspectError) return { ok: false, reason: "malformed" };
      throw e;
    }
    const result = checkTransfer(
      inspected,
      {
        asset: requirements.asset,
        amount,
        payTo: requirements.payTo,
        feePayer,
        offerHash: hash,
        maxTimeoutSeconds: requirements.maxTimeoutSeconds,
      },
      now(),
    );
    if (!result.ok) return { ok: false, reason: result.reason };
    return { ok: true, payer: result.payer, transaction, transactionId: inspected.transactionId, facilitator };
  }

  /** After a facilitator failed to answer, the chain decides whether this attempt landed the payment. */
  async function confirmOnChain(
    transactionId: string,
    requirements: PaymentRequirements,
    payer: string,
    timeoutMs: number,
    startedAt: number,
  ): Promise<"settled" | "replay" | "none"> {
    const deadline = Date.now() + timeoutMs;
    const oldest = startedAt - clockSkewSeconds;
    for (;;) {
      const tx = await getTransaction(transactionId, opts.mirror).catch(() => null);
      if (tx) {
        const moved = tx.tokens[requirements.asset] ?? [];
        const exact =
          tx.result === "SUCCESS" &&
          netFor(moved, requirements.payTo) === BigInt(requirements.amount) &&
          netFor(moved, payer) === -BigInt(requirements.amount);
        if (!exact) return "none";
        const consensusSeconds = Number(tx.consensusTimestamp.split(".")[0]);
        return consensusSeconds >= oldest ? "settled" : "replay";
      }
      if (Date.now() > deadline) return "none";
      await new Promise((r) => setTimeout(r, 2_000));
    }
  }

  const rail: HederaRail = {
    declaration: HEDERA_DECLARATION,
    get active() {
      return active;
    },
    refresh,

    challenge(offer: Offer, _ctx: ChallengeContext): PaymentRequirements {
      const payTo = offer.payTo?.hedera;
      if (!payTo || !ACCOUNT_ID.test(payTo)) throw new Error("offer has no Hedera payee: set payTo.hedera to an account id");
      if (!active) throw new Error("no facilitator currently lists exact on hedera:testnet");
      const hash = offerHash(offer);
      if (!OFFER_HASH.test(hash)) throw new Error(`unexpected offer hash ${hash}`);
      offerMemo(hash); // throws if the hash could not be carried in a memo
      return {
        scheme: "exact",
        network: HEDERA_TESTNET,
        amount: offer.price,
        asset: USDC_TESTNET,
        payTo,
        maxTimeoutSeconds,
        extra: { feePayer: active.feePayer, offerHash: hash },
      };
    },

    async verify(payment, requirements): Promise<VerifyResult> {
      const c = check(payment, requirements);
      if (!c.ok) return { isValid: false, invalidReason: c.reason, payer: c.payer };
      if (await seen.has(c.transactionId)) return { isValid: false, invalidReason: "replay", payer: c.payer };
      const sig = await verifySig({ payer: c.payer, transaction: c.transaction, network: HEDERA_TESTNET }).catch(() => ({
        ok: false,
      }));
      if (!sig.ok) return { isValid: false, invalidReason: "signature_invalid", payer: c.payer };
      let remote: Awaited<ReturnType<Facilitator["verify"]>>;
      try {
        remote = await c.facilitator.verify(toX402Payload(payment), toX402Requirements(payment.accepted));
      } catch {
        void refresh();
        return { isValid: false, invalidReason: "facilitator_unavailable", payer: c.payer };
      }
      if (!remote.isValid) {
        return { isValid: false, invalidReason: remote.invalidReason ?? "facilitator_refused", payer: c.payer };
      }
      return { isValid: true, payer: c.payer };
    },

    async settle(payment, requirements): Promise<SettleResult> {
      const c = check(payment, requirements);
      if (!c.ok) return { success: false, errorReason: c.reason, payer: c.payer, transaction: "", network: HEDERA_TESTNET };
      const sig = await verifySig({ payer: c.payer, transaction: c.transaction, network: HEDERA_TESTNET }).catch(() => ({
        ok: false,
      }));
      if (!sig.ok) {
        return { success: false, errorReason: "signature_invalid", payer: c.payer, transaction: "", network: HEDERA_TESTNET };
      }
      if (!(await seen.claim(c.transactionId))) {
        return { success: false, errorReason: "replay", payer: c.payer, transaction: "", network: HEDERA_TESTNET };
      }
      // A signed payload names one facilitator's fee payer, so it can only ever settle through that one.
      const startedAt = now();
      let remote: Awaited<ReturnType<Facilitator["settle"]>> | null = null;
      try {
        remote = await c.facilitator.settle(toX402Payload(payment), toX402Requirements(payment.accepted));
      } catch {
        remote = null;
        void refresh();
      }
      if (remote?.success) {
        if (remote.transaction && remote.transaction !== c.transactionId) {
          // The id is fixed by what the buyer signed; any other answer is not this payment.
          return { success: false, errorReason: "facilitator_refused", payer: c.payer, transaction: "", network: HEDERA_TESTNET };
        }
        return { success: true, payer: c.payer, transaction: c.transactionId, network: HEDERA_TESTNET };
      }
      // No answer, or a failure: before telling the buyer nothing was charged, ask the chain.
      const confirmMs = opts.confirmTimeoutMs ?? 20_000;
      const waitMs = remote === null ? confirmMs : Math.min(confirmMs, 6_000);
      const outcome = await confirmOnChain(c.transactionId, requirements, c.payer, waitMs, startedAt);
      if (outcome === "settled") {
        return { success: true, payer: c.payer, transaction: c.transactionId, network: HEDERA_TESTNET };
      }
      if (outcome === "replay") {
        return { success: false, errorReason: "replay", payer: c.payer, transaction: "", network: HEDERA_TESTNET };
      }
      return {
        success: false,
        errorReason: remote === null ? "facilitator_unavailable" : (remote.errorReason ?? "facilitator_refused"),
        payer: c.payer,
        transaction: "",
        network: HEDERA_TESTNET,
      };
    },
  };

  await refresh();
  const every = opts.refreshEveryMs ?? 60_000;
  if (every > 0) setInterval(() => void refresh(), every).unref();
  return rail;
}
