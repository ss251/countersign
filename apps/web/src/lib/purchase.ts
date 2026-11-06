import { useRef, useState } from "react";
import {
  authorizationTypedData,
  jobIdOf,
  offerHash as hashOf,
  countersignPayload,
  fromBase64Json,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  toBase64Json,
  type AuthorizationInput,
  type CountersignExtra,
  type CountersignTerms,
  type PaymentPayload,
  type PaymentRequired,
  type PaymentRequirements,
  type SettleResult,
} from "@countersign/core";
import { getAddress } from "viem";
import { useAccount, useSignTypedData } from "wagmi";
import { ARC_CHAIN_ID, ARC_PINS, pinFor, type ArcPin } from "./arc-pin.ts";
import { hubBase } from "./hub.ts";
import type { Address, Hex, Listing } from "./types.ts";

/**
 * The real purchase path, shared by the start desk and the assistant's card: the hub's
 * terms, the wallet's own signature, and only the hub's answer shown afterwards.
 */

export type TrustedRequirement =
  | { ok: true; req: PaymentRequirements; pin: ArcPin }
  | { ok: false; message: string };

/** The escrow version and bond sentence a hub's 402 must use before this page signs it. */
const WRONG_VERSION = "The hub's terms use an escrow version this page did not pin, so nothing was signed.";
const WRONG_BOND_WINDOW = "The hub's bond or review window is not this offer's, so nothing was signed.";

/** The Arc countersign terms this page will sign, or the sentence saying why it will not. */
/**
 * The Arc countersign terms this page will sign, or the sentence saying why it will not. It signs only
 * the offer it shows, as the buyer agent's checkTerms does (packages/buyer/src/terms.ts): the listing's
 * own hash, its price, its deadline and its payee, on the pinned escrow. A hub chosen by a link can
 * name any terms in its 402, so none of them is taken on trust (cs-w1's B24).
 */
export function trustedRequirement(accepts: PaymentRequirements[], listing: Listing): TrustedRequirement {
  const req = accepts.find((r) => r.scheme === "countersign" && r.network === "eip155:5042002");
  if (!req) return { ok: false, message: "This hub offered no Arc countersign terms for this offer." };
  const extra = req.extra;
  const named = isRecord(extra) && "escrow" in extra ? extra.escrow : undefined;
  const pin = pinFor(named);
  if (!pin) {
    return {
      ok: false,
      message: "The hub's terms name an escrow this page does not trust, so nothing was signed.",
    };
  }
  const offer = listing.offer;
  const terms = isRecord(extra) ? extra : {};
  if (pin.version !== 2 && terms.escrowVersion === 2) {
    return { ok: false, message: WRONG_VERSION };
  }
  if (pin.version === 2) {
    if (terms.escrowVersion !== 2) return { ok: false, message: WRONG_VERSION };
    const reviewWindow = (offer as { reviewWindow?: number }).reviewWindow ?? 0;
    if (terms.bond !== (offer.bond ?? "0") || terms.reviewWindow !== reviewWindow) {
      return { ok: false, message: WRONG_BOND_WINDOW };
    }
  }
  if (!sameHex(listing.hash, hashOf(offer))) {
    return { ok: false, message: "This listing's hash is not its offer's, so nothing was signed." };
  }
  if (typeof terms.offerHash !== "string" || !sameHex(terms.offerHash, listing.hash)) {
    return { ok: false, message: "The hub's terms are for another offer than the one shown, so nothing was signed." };
  }
  if (typeof req.payTo !== "string" || !sameAddress(req.payTo, offer.payTo?.escrow ?? offer.seller)) {
    return { ok: false, message: "The hub's terms pay someone other than this offer's seller, so nothing was signed." };
  }
  if (req.amount !== offer.price) {
    return { ok: false, message: "The hub asked for another amount than this offer's price, so nothing was signed." };
  }
  if (terms.deadlineSeconds !== offer.deadline) {
    return { ok: false, message: "The hub's deadline is not this offer's, so nothing was signed." };
  }
  return { ok: true, req, pin };
}

function sameHex(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * The time a person may spend in the wallet's sign dialog. It stays well under the rail's 300 s
 * maximum, and it only ever gives the seller more time, never less.
 */
export const SIGN_SLACK_SECONDS = 120;

/** The authorization the wallet signs, built from the pin and the hub's own terms. */
export function buildAuthorization(
  req: PaymentRequirements,
  address: Address,
  nowSeconds: number,
  salt: string,
  slackSeconds = 0,
  pin: ArcPin = ARC_PINS[0]!,
): AuthorizationInput {
  const extra = req.extra as (Partial<CountersignExtra> & { bond?: unknown; reviewWindow?: unknown }) | undefined;
  if (!extra || typeof extra.offerHash !== "string" || typeof extra.deadlineSeconds !== "number") {
    throw new Error("The hub's terms are missing the offer hash or deadline, so nothing was signed.");
  }
  const terms: CountersignTerms = {
    offerHash: extra.offerHash as Hex,
    buyer: address,
    payee: req.payTo as Address,
    amount: req.amount,
    deadline: nowSeconds + extra.deadlineSeconds + slackSeconds,
    salt: coreSalt(salt),
    // Only a pin pinned as v2 signs the v2 struct, which derives the v2 job id.
    ...(pin.version === 2
      ? {
          bond: typeof extra.bond === "string" ? extra.bond : "0",
          reviewWindow: typeof extra.reviewWindow === "number" ? extra.reviewWindow : 0,
        }
      : {}),
  };
  return {
    terms,
    chainId: pin.chainId,
    escrow: pin.escrow,
    token: pin.token,
    tokenName: pin.tokenName,
    tokenVersion: pin.tokenVersion,
    validAfter: 0,
    validBefore: nowSeconds + 600,
  };
}

/**
 * idle, then asking (the first call, for the hub's 402), then review (the terms on screen, the wallet still
 * closed), then signing (the wallet open for exactly the job shown), then sending (the signed call).
 */
export type PurchasePhase = "idle" | "asking" | "review" | "signing" | "sending";

export type PurchaseOutcome =
  | { kind: "paid"; transaction: string | null; slipHash: Hex | null }
  /** nothingMoved: the refusal came before any payment, or the hub says nothing was charged. */
  | { kind: "refused"; message: string; faucet: boolean; nothingMoved: boolean };

/** Everything one signature commits to, shown in plain words before the wallet opens (STEER-2225). */
export interface PendingPurchase {
  listing: Listing;
  input: unknown;
  req: PaymentRequirements;
  authorization: AuthorizationInput;
  /** The one job this signature can fund: the authorization's nonce, so it can never be reused for another. */
  jobId: Hex;
  base: string;
  /** Unix seconds when these terms were prepared for review. */
  preparedAt: number;
  /** The escrow pin these terms were built for; a refetch must name the same one. */
  pin: ArcPin;
}

export function pendingOf(
  listing: Listing,
  input: unknown,
  req: PaymentRequirements,
  authorization: AuthorizationInput,
  base: string,
  preparedAt = 0,
  pin: ArcPin = ARC_PINS[0]!,
): PendingPurchase {
  return {
    listing,
    input,
    req,
    authorization,
    jobId: jobIdOf(authorization.terms, authorization.chainId, authorization.escrow),
    base,
    preparedAt,
    pin,
  };
}

export type Refresh =
  | { kind: "ready"; pending: PendingPurchase }
  | { kind: "changed"; pending: PendingPurchase }
  | { kind: "failed"; message: string };

/** A refetched 402 with the escrow pin its own terms name. */
export interface RefetchedTerms {
  req: PaymentRequirements;
  pin: ArcPin;
}

/**
 * Rebuilds the authorization for the moment the person actually signs. Older terms are checked
 * against a fresh 402 first; anything material that moved, or an escrow pin that changed, goes
 * back for review.
 */
export async function freshTerms(deps: {
  pending: PendingPurchase;
  address: Address;
  nowSeconds: number;
  salt: string;
  /** A bare requirement is still read for older callers; its pin comes from its own escrow. */
  refetch: () => Promise<RefetchedTerms | PaymentRequirements | null>;
}): Promise<Refresh> {
  const { pending, address, nowSeconds, salt, refetch } = deps;
  let req = pending.req;
  let pin = pending.pin;

  if (nowSeconds - pending.preparedAt > 30) {
    let answer: RefetchedTerms | PaymentRequirements | null;
    try {
      answer = await refetch();
    } catch {
      answer = null;
    }
    if (!answer) {
      return {
        kind: "failed",
        message: "These terms expired, and fresh ones could not be fetched, so nothing was signed.",
      };
    }
    const next: RefetchedTerms =
      "req" in answer
        ? answer
        : { req: answer, pin: pinFor(isRecord(answer.extra) ? answer.extra.escrow : undefined) ?? pending.pin };
    if (pinMoved(next.pin, pending.pin) || materiallyDifferent(next.req, pending.req)) {
      return {
        kind: "changed",
        pending: pendingOf(
          pending.listing,
          pending.input,
          next.req,
          buildAuthorization(next.req, address, nowSeconds, salt, SIGN_SLACK_SECONDS, next.pin),
          pending.base,
          nowSeconds,
          next.pin,
        ),
      };
    }
    req = next.req;
    pin = next.pin;
  }

  return {
    kind: "ready",
    pending: pendingOf(
      pending.listing,
      pending.input,
      req,
      buildAuthorization(req, address, nowSeconds, salt, SIGN_SLACK_SECONDS, pin),
      pending.base,
      nowSeconds,
      pin,
    ),
  };
}

function pinMoved(a: ArcPin, b: ArcPin): boolean {
  return a.version !== b.version || !sameAddress(a.escrow, b.escrow);
}

function materiallyDifferent(a: PaymentRequirements, b: PaymentRequirements): boolean {
  if (a.network !== b.network || a.amount !== b.amount) return true;
  if (!sameAddress(a.payTo, b.payTo) || !sameAddress(a.asset, b.asset)) return true;
  const aExtra = isRecord(a.extra) ? a.extra : {};
  const bExtra = isRecord(b.extra) ? b.extra : {};
  const aHash = aExtra.offerHash;
  const bHash = bExtra.offerHash;
  if (typeof aHash !== "string" || typeof bHash !== "string") {
    if (aHash !== bHash) return true;
  } else if (!sameHex(aHash, bHash)) {
    return true;
  }
  return aExtra.deadlineSeconds !== bExtra.deadlineSeconds;
}

/**
 * One press, one call: while a call is in flight every other call returns at once without running
 * the work, and a settled or thrown call releases the guard for the next press.
 */
export function makeOnce<A extends unknown[]>(fn: (...args: A) => Promise<void>): (...args: A) => Promise<void> {
  let busy = false;
  return async (...args: A) => {
    if (busy) return;
    busy = true;
    try {
      await fn(...args);
    } finally {
      busy = false;
    }
  };
}

/** One purchase: ask the hub for its terms, show them, and only then open the wallet for that one job. */
export function usePurchase(): {
  phase: PurchasePhase;
  pending: PendingPurchase | null;
  signature: Hex | null;
  /** The wallet that signed the pending job, named on the receipt line. */
  signer: Address | null;
  outcome: PurchaseOutcome | null;
  note: string | null;
  /** Asks the hub for its 402 and checks the terms. It never opens the wallet; confirm() does. */
  buy: (listing: Listing, input: unknown) => Promise<void>;
  /** Opens the wallet for exactly the pending job, then sends the signed call. */
  confirm: () => Promise<void>;
  cancel: () => void;
  reset: () => void;
} {
  const account = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const [phase, setPhase] = useState<PurchasePhase>("idle");
  const [pending, setPending] = useState<PendingPurchase | null>(null);
  const [signature, setSignature] = useState<Hex | null>(null);
  const [signer, setSigner] = useState<Address | null>(null);
  const [outcome, setOutcome] = useState<PurchaseOutcome | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const busy = useRef(false);

  const buy = async (listing: Listing, input: unknown) => {
    const offerHash = listing.hash;
    if (!offerHash || !account.address || account.chainId !== ARC_CHAIN_ID || phase !== "idle") return;
    const base = hubBase();
    let next: PurchasePhase = "idle";
    setPhase("asking");
    setPending(null);
    setSignature(null);
    setSigner(null);
    setOutcome(null);
    setNote(null);
    try {
      if (!base) {
        setNote("No hub is chosen, so there is nothing to buy from this page.");
        return;
      }

      const now = Math.floor(Date.now() / 1000);
      const first = await postCall(base, offerHash, input);
      const firstBody = await readJson(first);
      if (first.status !== 402) {
        if (first.ok) {
          setNote(`The hub answered ${first.status} without asking for payment, so nothing was signed.`);
          return;
        }
        const message = refusalMessage(firstBody, `The hub answered ${first.status}.`);
        setOutcome({ kind: "refused", message, faucet: needsFaucet(message), nothingMoved: true });
        return;
      }
      const required = paymentRequiredOf(firstBody, first);
      if (!required) {
        setOutcome({ kind: "refused", message: "The hub's 402 carried no payment terms.", faucet: false, nothingMoved: true });
        return;
      }

      const choice = trustedRequirement(required.accepts, listing);
      if (!choice.ok) {
        setNote(choice.message);
        return;
      }

      try {
        setPending(
          pendingOf(
            listing,
            input,
            choice.req,
            buildAuthorization(choice.req, account.address, now, randomSalt(), 0, choice.pin),
            base,
            now,
            choice.pin,
          ),
        );
        next = "review";
      } catch (error) {
        setNote(messageOf(error));
      }
    } catch {
      setNote("The hub did not answer, so nothing was signed.");
    } finally {
      setPhase(next);
    }
  };

  const confirm = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const reviewed = pending;
      if (!reviewed || phase !== "review") return;
      // The terms on screen name one buyer; a wallet that changed since would sign for someone else.
      if (
        !account.address ||
        account.address.toLowerCase() !== reviewed.authorization.terms.buyer.toLowerCase() ||
        account.chainId !== ARC_CHAIN_ID
      ) {
        setPending(null);
        setPhase("idle");
        setNote("The wallet or its chain changed since these terms were shown, so nothing was signed. Ask again.");
        return;
      }

      const refetch = async (): Promise<RefetchedTerms | null> => {
        const response = await postCall(reviewed.base, reviewed.listing.hash, reviewed.input);
        if (response.status !== 402) return null;
        const body = await readJson(response);
        const required = paymentRequiredOf(body, response);
        if (!required) return null;
        const choice = trustedRequirement(required.accepts, reviewed.listing);
        return choice.ok ? { req: choice.req, pin: choice.pin } : null;
      };

      setNote("Preparing fresh terms…");
      let fresh: Refresh;
      try {
        fresh = await freshTerms({
          pending: reviewed,
          address: account.address,
          nowSeconds: Math.floor(Date.now() / 1000),
          salt: randomSalt(),
          refetch,
        });
      } catch {
        fresh = { kind: "failed", message: "These terms expired, and fresh ones could not be fetched, so nothing was signed." };
      }
      if (fresh.kind === "failed") {
        setNote(fresh.message);
        return;
      }
      if (fresh.kind === "changed") {
        setPending(fresh.pending);
        setPhase("review");
        setNote("The hub's terms changed since you reviewed them. Check them again before signing.");
        return;
      }

      const p = fresh.pending;
      setPending(p);
      setNote(null);
      setPhase("signing");
      try {
        let sig: Hex;
        try {
          sig = await signTypedDataAsync(authorizationTypedData(p.authorization));
        } catch {
          setNote("The wallet did not sign, so nothing was sent.");
          return;
        }
        setSignature(sig);
        setSigner(p.authorization.terms.buyer);
        setPhase("sending");

        const payment: PaymentPayload = {
          x402Version: 2,
          accepted: p.req,
          payload: countersignPayload(p.authorization, sig) as unknown as Record<string, unknown>,
        };

        let second: Response;
        try {
          second = await postCall(p.base, p.listing.hash, p.input, payment);
        } catch {
          setNote("The hub did not answer, so this page cannot say whether the payment reached it.");
          return;
        }

        const secondBody = await readJson(second);
        if (second.ok) {
          const settleHeader = second.headers.get(PAYMENT_RESPONSE_HEADER);
          const settle = settleHeader ? settleOf(settleHeader) : null;
          if (settle && settle.success === false) {
            const message = settle.errorReason ?? "The hub's settle result did not say the payment succeeded.";
            setOutcome({ kind: "refused", message, faucet: needsFaucet(message), nothingMoved: chargedNothing(message) });
            return;
          }
          setOutcome({
            kind: "paid",
            transaction: transactionOf(secondBody, settle),
            slipHash: slipHashOf(secondBody),
          });
          return;
        }

        // After the signed call the money may already be in escrow (a failed delivery, a release that did
        // not land, a fund that lands after the hub stopped waiting), so "nothing moved" needs the hub's word.
        const message = refusalMessage(secondBody, `The hub answered ${second.status}.`);
        setOutcome({ kind: "refused", message, faucet: needsFaucet(message), nothingMoved: chargedNothing(message) });
      } catch {
        setNote("The hub did not answer, so nothing here can say what happened.");
      } finally {
        setPending(null);
        setPhase("idle");
      }
    } finally {
      busy.current = false;
    }
  };

  const cancel = () => {
    if (phase !== "review") return;
    setPending(null);
    setPhase("idle");
    setNote("Nothing was signed.");
  };

  const reset = () => {
    setPhase("idle");
    setPending(null);
    setSignature(null);
    setSigner(null);
    setOutcome(null);
    setNote(null);
  };

  return { phase, pending, signature, signer, outcome, note, buy, confirm, cancel, reset };
}

function randomSalt(): Hex {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** Core carries a salt as a decimal uint256; the page draws its bytes and hands them over that way. */
function coreSalt(salt: string): string {
  return /^0x[0-9a-fA-F]+$/.test(salt) ? BigInt(salt).toString(10) : salt;
}

function sameAddress(a: string, b: string): boolean {
  try {
    return getAddress(a) === getAddress(b);
  } catch {
    return false;
  }
}

async function postCall(base: string, offerHash: string, input: unknown, payment?: PaymentPayload): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (payment) headers[PAYMENT_SIGNATURE_HEADER] = toBase64Json(payment);
  return fetch(`${base}/offers/${offerHash}/call`, {
    method: "POST",
    headers,
    body: JSON.stringify({ input }),
  });
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function paymentRequiredOf(body: unknown, res: Response): PaymentRequired | null {
  if (isRecord(body) && Array.isArray(body.accepts)) return body as unknown as PaymentRequired;
  const header = res.headers.get(PAYMENT_REQUIRED_HEADER);
  if (!header) return null;
  try {
    const parsed = fromBase64Json<PaymentRequired>(header);
    return Array.isArray(parsed.accepts) ? parsed : null;
  } catch {
    return null;
  }
}

function settleOf(header: string): SettleResult | null {
  try {
    return fromBase64Json<SettleResult>(header);
  } catch {
    return null;
  }
}

function transactionOf(body: unknown, settle: SettleResult | null): string | null {
  if (settle && typeof settle.transaction === "string" && settle.transaction !== "") return settle.transaction;
  if (isRecord(body) && isRecord(body.slip) && isRecord(body.slip.settlement)) {
    const tx = body.slip.settlement.transaction;
    if (typeof tx === "string" && tx !== "") return tx;
  }
  return null;
}

function slipHashOf(body: unknown): Hex | null {
  if (!isRecord(body) || !isRecord(body.slip)) return null;
  const hash = body.slip.hash;
  return typeof hash === "string" && /^0x[0-9a-fA-F]{64}$/.test(hash) ? (hash as Hex) : null;
}

function refusalMessage(body: unknown, fallback: string): string {
  if (isRecord(body)) {
    if (typeof body.message === "string" && body.message !== "") return body.message;
    if (typeof body.error === "string" && body.error !== "") return body.error;
  }
  return fallback;
}

/** The faucet helps only when the wallet is short of test USDC, never on every 402. */
function needsFaucet(message: string): boolean {
  return /balance|funds|allowance|insufficient/i.test(message);
}

function chargedNothing(message: string): boolean {
  return /nothing was charged/i.test(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
