import type { MiddlewareHandler } from "hono";
import type { Address } from "viem";

export const PAYMENT_RETRY_HEADER: "PAYMENT-RETRY";

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

export function whitechainPaywall(options: PaywallOptions): MiddlewareHandler;
