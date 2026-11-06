import { timingSafeEqual } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { getAddress, toHex } from "viem";
import type { Address } from "viem";
import {
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  fromBase64Json,
  parseUnits,
  toBase64Json,
} from "@countersign/core";
import { NETWORK, USDT } from "./chain.ts";
import { PAYMENT_RETRY_HEADER } from "./headers.ts";
import type { WireAuthorization } from "./eip3009.ts";
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyRequest,
  VerifyResponse,
} from "./exact.ts";

export { PAYMENT_RETRY_HEADER };

export type PaywallFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type PaywallOptions = {
  /** Decimal USDT price, for example "0.05". */
  price: string;
  /** The merchant address that receives the payment. */
  payTo: Address | string;
  /** The relay base URL. */
  facilitator: string;
  description?: string;
  mimeType?: string;
  maxTimeoutSeconds?: number;
  /** Milliseconds to wait before retrying a settle whose reply was lost. Defaults to 1000. */
  settleRetryDelayMs?: number;
  /**
   * When to settle relative to the handler. Defaults to "after".
   * "after" keeps read-only handlers cheap and gives no goods when settle fails.
   * "before" charges first, so a handler with side effects never runs unpaid.
   */
  settle?: "after" | "before";
  /** Unix seconds. Defaults to the wall clock. */
  now?: () => number;
  /** Injectable for tests. Defaults to the global fetch at request time. */
  fetch?: PaywallFetch;
};

type PaymentRequired = {
  x402Version: 2;
  error: string;
  resource: { url: string; description: string; mimeType: string };
  accepts: PaymentRequirements[];
};

type Claim = {
  state: "in_flight" | "settled" | "pending";
  /** Unix seconds after which a settled claim may be forgotten. */
  validBefore: number;
  /** The settle transaction, once one is pending. */
  txHash: string | null;
  /** The token handed only to the requester whose payment went pending. */
  retryToken: string | null;
};

const MAX_CLAIMS = 10_000;
const ALREADY_USED = "Refused. This payment was already used.";
const STILL_SETTLING = "Refused. This payment is still settling.";

/**
 * Puts a USDT price on a Hono route. A request without payment gets an x402 v2
 * 402; a paid request is verified through the relay, served, then settled.
 *
 * Settle order:
 * - `"after"` (default): verify, run the handler, then settle. The handler should be read-only or
 *   idempotent, because a balance that moves between verify and settle still ran it.
 * - `"before"`: verify, settle, then run the handler. Use this for handlers with side effects;
 *   the buyer pays before the work happens.
 *
 * The authorisation is claimed by `from:nonce` before the handler runs. A second request
 * presenting the same authorisation gets 409, both while the first is in flight and after it
 * settled. A claim is released when the request is refused before settlement (bad verify, a
 * handler error in "after" mode, or a settle that failed outright), so an unused authorisation
 * can be retried. A settle that answers `settlement_pending` keeps the claim until `validBefore`
 * plus a minute, because the transaction may still land.
 */
export function whitechainPaywall(options: PaywallOptions): MiddlewareHandler {
  const amount = parseUnits(options.price, USDT.decimals);
  const payTo = getAddress(options.payTo);
  const facilitator = options.facilitator.replace(/\/+$/, "");
  const mimeType = options.mimeType ?? "application/json";
  const maxTimeoutSeconds = options.maxTimeoutSeconds ?? 120;
  const settleRetryDelayMs = options.settleRetryDelayMs ?? 1000;
  const settleOrder = options.settle ?? "after";
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  const claims = new Map<string, Claim>();

  function prune(at: number): void {
    for (const [key, claim] of claims) {
      if (claim.state === "settled" && at > claim.validBefore) claims.delete(key);
      // A pending transaction can still land until the token refuses the authorisation.
      if (claim.state === "pending" && at > claim.validBefore + 60) claims.delete(key);
    }
    if (claims.size >= MAX_CLAIMS) {
      for (const [key, claim] of claims) {
        if (claim.state === "settled") claims.delete(key);
        if (claims.size < MAX_CLAIMS) break;
      }
    }
  }

  function claimOf(payment: PaymentPayload): { key: string; validBefore: number } | null {
    const wire = payment.payload?.authorization as Partial<WireAuthorization> | undefined;
    if (!wire || typeof wire.from !== "string" || typeof wire.nonce !== "string") return null;
    const seconds = Number(wire.validBefore);
    return {
      key: `${wire.from.toLowerCase()}:${wire.nonce.toLowerCase()}`,
      validBefore:
        Number.isSafeInteger(seconds) && seconds > 0 ? seconds : now() + maxTimeoutSeconds,
    };
  }

  function release(key: string): void {
    if (claims.get(key)?.state === "in_flight") claims.delete(key);
  }

  function settleClaim(key: string, validBefore: number): void {
    claims.set(key, {
      state: "settled",
      validBefore: Math.max(validBefore, now() + 60),
      txHash: null,
      retryToken: null,
    });
  }

  function pendingClaim(
    key: string,
    validBefore: number,
    txHash: string | null,
    retryToken: string,
  ): void {
    claims.set(key, { state: "pending", validBefore, txHash, retryToken });
  }

  return async (c, next) => {
    const url = c.req.url;
    const requirements = requirementsFor(amount, payTo, maxTimeoutSeconds);
    const signature = c.req.header(PAYMENT_SIGNATURE_HEADER);

    if (!signature) {
      return required(c, requirements, url, "Payment required.", options);
    }

    let payment: PaymentPayload;
    try {
      const decoded = fromBase64Json<unknown>(signature);
      if (!isRecord(decoded) || !isRecord(decoded.accepted) || !isRecord(decoded.payload)) {
        throw new Error("bad payment shape");
      }
      payment = decoded as unknown as PaymentPayload;
    } catch {
      return required(
        c,
        requirements,
        url,
        "Refused. The payment header does not parse.",
        options,
      );
    }

    const send = options.fetch ?? globalThis.fetch;
    const request: VerifyRequest = {
      x402Version: 2,
      paymentPayload: payment,
      paymentRequirements: requirements,
    };
    const claim = claimOf(payment);
    if (claim) {
      prune(now());
      const existing = claims.get(claim.key);
      if (existing) {
        if (existing.state !== "pending") return alreadyUsed(c);
        const retryToken = existing.retryToken;
        if (retryToken === null || !sameToken(retryToken, c.req.header(PAYMENT_RETRY_HEADER))) {
          return stillSettling(c);
        }
        const txHash = existing.txHash;
        if (txHash) {
          const status = await orderStatus(
            send,
            `${facilitator}/orders/${encodeURIComponent(txHash)}`,
          );
          if (status === "paid" || status === "partially_refunded") {
            // The payment landed. Re-read the claim so a concurrent retry cannot serve twice.
            const landed = claims.get(claim.key);
            if (!landed || landed.state !== "pending") return alreadyUsed(c);
            settleClaim(claim.key, landed.validBefore);
            await next();
            return withLanded(c, txHash, requirements, payment);
          }
          return stillSettling(c);
        }
        // The claim went pending because the settle reply was lost. Ask the relay to
        // settle the same authorisation once; its ledger makes that idempotent per nonce.
        const settle = (await post(send, `${facilitator}/settle`, request)) as SettleResponse | null;
        if (settle && settle.success === true) {
          // The payment has settled. Re-read the claim so a concurrent retry cannot serve twice.
          const landed = claims.get(claim.key);
          if (!landed || landed.state !== "pending") return alreadyUsed(c);
          settleClaim(claim.key, landed.validBefore);
          await next();
          return withSettle(c, settle);
        }
        if (settle && settle.errorReason === "settlement_pending" && settle.transaction) {
          // A concurrent retry may have settled and served this claim while our reply was in
          // flight; re-pending it then would let a later retry be served a second time.
          const current = claims.get(claim.key);
          if (current && current.state === "pending") {
            pendingClaim(claim.key, current.validBefore, settle.transaction, retryToken);
          }
        }
        return stillSettling(c);
      }
      claims.set(claim.key, {
        state: "in_flight",
        validBefore: claim.validBefore,
        txHash: null,
        retryToken: null,
      });
    }

    const verify = (await post(send, `${facilitator}/verify`, request)) as VerifyResponse | null;
    if (!verify) {
      if (claim) release(claim.key);
      return unreachable(c);
    }
    if (verify.isValid !== true) {
      if (claim) release(claim.key);
      return required(
        c,
        requirements,
        url,
        `Refused. ${verify.invalidReason ?? "invalid_payload"}`,
        options,
      );
    }

    const settlePayment = async (): Promise<
      { kind: "settled"; settle: SettleResponse } | { kind: "refused"; response: Response }
    > => {
      let settle = (await post(send, `${facilitator}/settle`, request)) as SettleResponse | null;
      let retried = false;
      if (!settle) {
        // The reply may have been lost after the relay settled. Retry the same request once;
        // the relay's ledger answers a repeat with replayed: true.
        retried = true;
        await delay(settleRetryDelayMs);
        settle = (await post(send, `${facilitator}/settle`, request)) as SettleResponse | null;
      }
      if (!settle) {
        if (!claim) return { kind: "refused", response: unreachable(c) };
        // The relay may have settled without us hearing about it. Keep the claim pending
        // with no transaction so the requester can retry with the token.
        const retryToken = newRetryToken();
        pendingClaim(claim.key, claim.validBefore, null, retryToken);
        const response = required(c, requirements, url, "Refused. settlement_pending", options);
        response.headers.set(PAYMENT_RETRY_HEADER, retryToken);
        return { kind: "refused", response };
      }
      if (settle.success !== true) {
        // After our own retry, the relay answers a payment it still holds as pending with
        // invalid_transaction_state and that payment's transaction. The transaction can still
        // charge, so the claim stays pending behind a token, exactly as for settlement_pending.
        const ownPending =
          retried &&
          settle.errorReason === "invalid_transaction_state" &&
          typeof settle.transaction === "string" &&
          settle.transaction !== "";
        if (settle.errorReason === "settlement_pending" || ownPending) {
          // The transaction may still land, so keep the payment claimed until it cannot.
          const retryToken = newRetryToken();
          if (claim) pendingClaim(claim.key, claim.validBefore, settle.transaction, retryToken);
          const response = required(
            c,
            requirements,
            url,
            "Refused. settlement_pending",
            options,
          );
          response.headers.set(PAYMENT_RESPONSE_HEADER, toBase64Json(settle));
          response.headers.set(PAYMENT_RETRY_HEADER, retryToken);
          return { kind: "refused", response };
        }
        if (claim) release(claim.key);
        return {
          kind: "refused",
          response: required(
            c,
            requirements,
            url,
            `Refused. ${settle.errorReason ?? "settlement_failed"}`,
            options,
          ),
        };
      }
      if (settle.replayed === true) {
        if (claim) settleClaim(claim.key, claim.validBefore);
        // A replay of our own retry means the first settle landed but its reply was lost.
        if (!retried) return { kind: "refused", response: alreadyUsed(c) };
        return { kind: "settled", settle };
      }
      if (claim) settleClaim(claim.key, claim.validBefore);
      return { kind: "settled", settle };
    };

    if (settleOrder === "before") {
      const outcome = await settlePayment();
      if (outcome.kind === "refused") return outcome.response;
      await next();
      return withSettle(c, outcome.settle);
    }

    try {
      await next();
    } catch (error) {
      if (claim) release(claim.key);
      throw error;
    }
    const response = c.res;
    if (response.status >= 400) {
      if (claim) release(claim.key);
      return response;
    }

    const outcome = await settlePayment();
    if (outcome.kind === "refused") {
      c.res = outcome.response;
      return c.res;
    }
    return withSettle(c, outcome.settle);
  };

  function required(
    c: Context,
    requirements: PaymentRequirements,
    url: string,
    error: string,
    opts: PaywallOptions,
  ): Response {
    const body: PaymentRequired = {
      x402Version: 2,
      error,
      resource: { url, description: opts.description ?? "", mimeType },
      accepts: [requirements],
    };
    c.header(PAYMENT_REQUIRED_HEADER, toBase64Json(body));
    return c.json(body, 402);
  }
}

function withLanded(
  c: Context,
  txHash: string,
  requirements: PaymentRequirements,
  payment: PaymentPayload,
): Response {
  const response = c.res;
  const headers = new Headers(response.headers);
  headers.set(
    PAYMENT_RESPONSE_HEADER,
    toBase64Json({
      success: true,
      transaction: txHash,
      network: requirements.network,
      payer: payment.payload.authorization.from,
    }),
  );
  c.res = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
  return c.res;
}

function withSettle(c: Context, settle: SettleResponse): Response {
  const response = c.res;
  const headers = new Headers(response.headers);
  headers.set(PAYMENT_RESPONSE_HEADER, toBase64Json(settle));
  c.res = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
  return c.res;
}

function alreadyUsed(c: Context): Response {
  return c.json({ error: ALREADY_USED }, 409);
}

function stillSettling(c: Context): Response {
  return c.json({ error: STILL_SETTLING }, 409);
}

function sameToken(expected: string | null, presented: string | undefined): boolean {
  if (expected === null || presented === undefined) return false;
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(presented, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function newRetryToken(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(16)));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requirementsFor(
  amount: bigint,
  payTo: Address,
  maxTimeoutSeconds: number,
): PaymentRequirements {
  return {
    scheme: "exact",
    network: NETWORK,
    amount: amount.toString(10),
    asset: USDT.address,
    payTo,
    maxTimeoutSeconds,
    extra: {
      assetTransferMethod: "eip3009",
      name: USDT.name,
      version: USDT.version,
    },
  };
}

async function orderStatus(send: PaywallFetch, url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await send(url, { method: "GET", signal: controller.signal });
    if (!response.ok) return null;
    const body = (await response.json()) as unknown;
    if (!isRecord(body) || typeof body.status !== "string") return null;
    return body.status;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function post(
  send: PaywallFetch,
  url: string,
  body: VerifyRequest,
): Promise<unknown | null> {
  try {
    const response = await send(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) return null;
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

function unreachable(c: Context): Response {
  return c.json({ error: "The payment service is unreachable." }, 503);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
