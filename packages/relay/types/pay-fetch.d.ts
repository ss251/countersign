import type { Abi, Address, LocalAccount } from "viem";

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type PayFetchOptions = {
  account: LocalAccount;
  /** Decimal USDT cap for one call. Defaults to "1.00". */
  maxPerCall?: string;
  /** Decimal USDT cap across every signed call. */
  budget?: string;
  /** When set, a payment to any other address is refused before it is signed. */
  payTo?: string[];
  /** Reads authorizationState during reconcile(). Without one, a spend is never released. */
  reader?: {
    readContract(call: {
      address: Address;
      abi: Abi;
      functionName: string;
      args?: readonly unknown[];
    }): Promise<unknown>;
  };
  /** Injectable for tests. Defaults to the global fetch at creation time. */
  fetch?: FetchLike;
  /** Milliseconds to wait before each retry of a pending payment. Defaults to 2000. */
  retryDelayMs?: number;
  /** Injectable for tests. Defaults to a setTimeout promise. */
  sleep?: (ms: number) => Promise<void>;
  /** Unix seconds. Defaults to the wall clock. */
  now?: () => number;
};

export type PaymentReceipt = {
  transaction: string;
  url: string;
  amount: string;
};

export type PayFetch = {
  (input: string | URL | Request, init?: RequestInit): Promise<PaidResponse>;
  /** Total signed, as a decimal USDT string, including authorisations without a receipt. */
  spent: () => string;
  /** Release expired authorisations that the chain never used, when a reader is configured. */
  reconcile: () => Promise<void>;
};

export class SpendLimitError extends Error {
  name: "SpendLimitError";
}

/** The return value is a Response subclass with an optional `payment` receipt. */
export class PaidResponse extends Response {
  readonly payment?: PaymentReceipt;
  constructor(body: BodyInit | null, init: ResponseInit, payment?: PaymentReceipt);
}

export function createPayFetch(options: PayFetchOptions): PayFetch;
