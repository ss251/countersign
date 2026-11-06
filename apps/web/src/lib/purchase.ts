import { useState } from "react";
import {
  authorizationTypedData,
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
import { ARC_CHAIN_ID, ARC_PIN } from "./arc-pin.ts";
import { hubBase } from "./hub.ts";
import type { Address, Hex, Listing } from "./types.ts";

/**
 * The real purchase path, shared by the start desk and the assistant's card: the hub's
 * terms, the wallet's own signature, and only the hub's answer shown afterwards.
 */

export type TrustedRequirement =
  | { ok: true; req: PaymentRequirements }
  | { ok: false; message: string };

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
  if (named !== undefined && (typeof named !== "string" || !sameAddress(named, ARC_PIN.escrow))) {
    return {
      ok: false,
      message: "The hub's terms name an escrow this page does not trust, so nothing was signed.",
    };
  }
  const offer = listing.offer;
  const terms = isRecord(extra) ? extra : {};
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
  return { ok: true, req };
}

function sameHex(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** The authorization the wallet signs, built from the pin and the hub's own terms. */
export function buildAuthorization(
  req: PaymentRequirements,
  address: Address,
  nowSeconds: number,
  salt: string,
): AuthorizationInput {
  const extra = req.extra as Partial<CountersignExtra> | undefined;
  if (!extra || typeof extra.offerHash !== "string" || typeof extra.deadlineSeconds !== "number") {
    throw new Error("The hub's terms are missing the offer hash or deadline, so nothing was signed.");
  }
  const terms: CountersignTerms = {
    offerHash: extra.offerHash as Hex,
    buyer: address,
    payee: req.payTo as Address,
    amount: req.amount,
    deadline: nowSeconds + extra.deadlineSeconds,
    salt: coreSalt(salt),
  };
  return {
    terms,
    chainId: ARC_PIN.chainId,
    escrow: ARC_PIN.escrow,
    token: ARC_PIN.token,
    tokenName: ARC_PIN.tokenName,
    tokenVersion: ARC_PIN.tokenVersion,
    validAfter: 0,
    validBefore: nowSeconds + 600,
  };
}

export type PurchasePhase = "idle" | "signing" | "sending";

export type PurchaseOutcome =
  | { kind: "paid"; transaction: string | null; slipHash: Hex | null }
  /** nothingMoved: the refusal came before any payment, or the hub says nothing was charged. */
  | { kind: "refused"; message: string; faucet: boolean; nothingMoved: boolean };

/** One purchase, from the first 402 to the hub's final answer. */
export function usePurchase(): {
  phase: PurchasePhase;
  signature: Hex | null;
  outcome: PurchaseOutcome | null;
  note: string | null;
  buy: (listing: Listing, input: unknown) => Promise<void>;
  reset: () => void;
} {
  const account = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const [phase, setPhase] = useState<PurchasePhase>("idle");
  const [signature, setSignature] = useState<Hex | null>(null);
  const [outcome, setOutcome] = useState<PurchaseOutcome | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const buy = async (listing: Listing, input: unknown) => {
    const offerHash = listing.hash;
    if (!offerHash || !account.address || account.chainId !== ARC_CHAIN_ID || phase !== "idle") return;
    const base = hubBase();
    setPhase("signing");
    setSignature(null);
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

      let authorization: AuthorizationInput;
      try {
        authorization = buildAuthorization(choice.req, account.address, now, randomSalt());
      } catch (error) {
        setNote(messageOf(error));
        return;
      }

      let sig: Hex;
      try {
        sig = await signTypedDataAsync(authorizationTypedData(authorization));
      } catch {
        setNote("The wallet did not sign, so nothing was sent.");
        return;
      }
      setSignature(sig);
      setPhase("sending");

      const payment: PaymentPayload = {
        x402Version: 2,
        accepted: choice.req,
        payload: countersignPayload(authorization, sig) as unknown as Record<string, unknown>,
      };

      let second: Response;
      try {
        second = await postCall(base, offerHash, input, payment);
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
      setPhase("idle");
    }
  };

  const reset = () => {
    setPhase("idle");
    setSignature(null);
    setOutcome(null);
    setNote(null);
  };

  return { phase, signature, outcome, note, buy, reset };
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
