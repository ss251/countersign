import type { Context, MiddlewareHandler } from "hono";
import { getAddress } from "viem";
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
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyRequest,
  VerifyResponse,
} from "./exact.ts";

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
  /** Injectable for tests. Defaults to the global fetch at request time. */
  fetch?: PaywallFetch;
};

type PaymentRequired = {
  x402Version: 2;
  error: string;
  resource: { url: string; description: string; mimeType: string };
  accepts: PaymentRequirements[];
};

/**
 * Puts a USDT price on a Hono route. A request without payment gets an x402 v2
 * 402; a paid request is verified through the relay, served, then settled.
 */
export function whitechainPaywall(options: PaywallOptions): MiddlewareHandler {
  const amount = parseUnits(options.price, USDT.decimals);
  const payTo = getAddress(options.payTo);
  const facilitator = options.facilitator.replace(/\/+$/, "");
  const mimeType = options.mimeType ?? "application/json";
  const maxTimeoutSeconds = options.maxTimeoutSeconds ?? 120;

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

    const request: VerifyRequest = {
      x402Version: 2,
      paymentPayload: payment,
      paymentRequirements: requirements,
    };
    const send = options.fetch ?? globalThis.fetch;

    const verify = (await post(send, `${facilitator}/verify`, request)) as VerifyResponse | null;
    if (!verify) return unreachable(c);
    if (verify.isValid !== true) {
      return required(
        c,
        requirements,
        url,
        `Refused. ${verify.invalidReason ?? "invalid_payload"}`,
        options,
      );
    }

    await next();
    const response = c.res;
    if (response.status >= 400) return response;

    const settle = (await post(send, `${facilitator}/settle`, request)) as SettleResponse | null;
    if (!settle) {
      c.res = unreachable(c);
      return c.res;
    }
    if (settle.success !== true) {
      c.res = required(
        c,
        requirements,
        url,
        `Refused. ${settle.errorReason ?? "settlement_failed"}`,
        options,
      );
      return c.res;
    }

    const headers = new Headers(response.headers);
    headers.set(PAYMENT_RESPONSE_HEADER, toBase64Json(settle));
    c.res = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
    return c.res;
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
