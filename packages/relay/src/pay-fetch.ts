import { getAddress, toHex } from "viem";
import type { Hex, LocalAccount } from "viem";
import {
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  formatUnits,
  fromBase64Json,
  parseAtomic,
  parseUnits,
  toBase64Json,
} from "@countersign/core";
import { NETWORK, USDT } from "./chain.ts";
import { authorizationToWire, sameAddress, signAuthorization, tokenAbi } from "./eip3009.ts";
import type { Authorization } from "./eip3009.ts";
import type { PaymentPayload, PaymentRequirements, SettleResponse } from "./exact.ts";
import type { ChainReader } from "./ports.ts";

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
  reader?: Pick<ChainReader, "readContract">;
  /** Injectable for tests. Defaults to the global fetch at creation time. */
  fetch?: FetchLike;
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
  override name = "SpendLimitError";
}

/** The return value is a Response subclass with an optional `payment` receipt. */
export class PaidResponse extends Response {
  readonly payment?: PaymentReceipt;

  constructor(body: BodyInit | null, init: ResponseInit, payment?: PaymentReceipt) {
    super(body, init);
    this.payment = payment;
  }
}

type PaymentRequired = {
  x402Version: 2;
  error?: string;
  resource?: { url?: string };
  accepts?: PaymentRequirements[];
};

type SignedAuthorization = {
  nonce: Hex;
  amount: bigint;
  /** Unix seconds. */
  validBefore: number;
};

const MAX_TIMEOUT_SECONDS = 300;

export function createPayFetch(options: PayFetchOptions): PayFetch {
  const account = options.account;
  const maxPerCall = parseUnits(options.maxPerCall ?? "1.00", USDT.decimals);
  const budget =
    options.budget === undefined ? null : parseUnits(options.budget, USDT.decimals);
  const allowlist = options.payTo?.map((value) => getAddress(value)) ?? null;
  const reader = options.reader ?? null;
  const send = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  let spentAtomic = 0n;
  const signed: SignedAuthorization[] = [];

  const pay = (async (input: string | URL | Request, init?: RequestInit) => {
    const first = await send(input, init);
    if (first.status !== 402) return wrap(first);

    const required = await readRequired(first);
    if (!required) return wrap(first);
    const requirements = pick(required);
    if (!requirements) return wrap(first);

    let amount: bigint;
    try {
      amount = parseAtomic(requirements.amount);
    } catch {
      return wrap(first);
    }

    const payTo = getAddress(requirements.payTo);
    if (allowlist && !allowlist.some((allowed) => sameAddress(allowed, payTo))) {
      throw new SpendLimitError(`${payTo} is not an allowed merchant.`);
    }
    if (amount > maxPerCall) {
      throw new SpendLimitError(
        `${formatUnits(amount, USDT.decimals)} USDT is over the ${formatUnits(maxPerCall, USDT.decimals)} USDT per-call limit.`,
      );
    }
    if (budget !== null && spentAtomic + amount > budget) {
      throw new SpendLimitError(
        `${formatUnits(amount, USDT.decimals)} USDT would pass the ${formatUnits(budget, USDT.decimals)} USDT budget.`,
      );
    }

    const signedAt = now();
    const timeout = Math.min(requirements.maxTimeoutSeconds ?? 120, MAX_TIMEOUT_SECONDS);
    const authorization: Authorization = {
      from: account.address,
      to: payTo,
      value: amount,
      validAfter: 0n,
      validBefore: BigInt(signedAt + timeout),
      nonce: toHex(crypto.getRandomValues(new Uint8Array(32))),
    };
    const reservation: SignedAuthorization = {
      nonce: authorization.nonce,
      amount,
      validBefore: signedAt + timeout,
    };
    // Reserve before signing: the budget counts the authorisation from this moment, because the
    // merchant can settle it whether or not it ever returns a receipt.
    signed.push(reservation);
    spentAtomic += amount;

    let signature: Hex;
    try {
      signature = await signAuthorization(account, authorization);
    } catch (error) {
      release(reservation);
      throw error;
    }
    const payment: PaymentPayload = {
      x402Version: 2,
      resource: required.resource,
      accepted: requirements,
      payload: { signature, authorization: authorizationToWire(authorization) },
    };
    const url = resourceUrl(required, input);

    const [retryInput, retryInit] = withSignature(input, init, toBase64Json(payment));
    const second = await send(retryInput, retryInit);
    const settle = readSettle(second);
    const receipt =
      second.ok && settle?.success === true && typeof settle.transaction === "string"
        ? {
            transaction: settle.transaction,
            url,
            amount: typeof settle.amount === "string" ? settle.amount : requirements.amount,
          }
        : undefined;
    return wrap(second, receipt);
  }) as PayFetch;

  pay.spent = () => formatUnits(spentAtomic, USDT.decimals);
  pay.reconcile = async () => {
    if (!reader) return;
    const at = now();
    for (const entry of [...signed]) {
      if (at <= entry.validBefore) continue;
      let used: unknown;
      try {
        used = await reader.readContract({
          address: USDT.address,
          abi: tokenAbi,
          functionName: "authorizationState",
          args: [account.address, entry.nonce],
        });
      } catch {
        continue;
      }
      if (used === false) release(entry);
    }
  };
  return pay;

  function release(entry: SignedAuthorization): void {
    const index = signed.indexOf(entry);
    if (index < 0) return;
    signed.splice(index, 1);
    spentAtomic -= entry.amount;
  }

  function wrap(response: Response, payment?: PaymentReceipt): PaidResponse {
    return new PaidResponse(
      response.body,
      {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      },
      payment,
    );
  }
}

async function readRequired(response: Response): Promise<PaymentRequired | null> {
  const header = response.headers.get(PAYMENT_REQUIRED_HEADER);
  if (header) {
    try {
      const decoded = fromBase64Json<unknown>(header);
      return isRecord(decoded) ? (decoded as PaymentRequired) : null;
    } catch {
      return null;
    }
  }
  try {
    const decoded = (await response.clone().json()) as unknown;
    return isRecord(decoded) ? (decoded as PaymentRequired) : null;
  } catch {
    return null;
  }
}

function pick(required: PaymentRequired): PaymentRequirements | null {
  const accepts = Array.isArray(required.accepts) ? required.accepts : [];
  for (const entry of accepts) {
    if (entry?.scheme !== "exact") continue;
    if (entry.network !== NETWORK) continue;
    if (typeof entry.asset !== "string" || !sameAddress(entry.asset, USDT.address)) continue;
    return entry;
  }
  return null;
}

function readSettle(response: Response): SettleResponse | null {
  const header = response.headers.get(PAYMENT_RESPONSE_HEADER);
  if (!header) return null;
  try {
    const decoded = fromBase64Json<unknown>(header);
    return isRecord(decoded) ? (decoded as SettleResponse) : null;
  } catch {
    return null;
  }
}

function resourceUrl(required: PaymentRequired, input: string | URL | Request): string {
  const url = required.resource?.url;
  if (typeof url === "string") return url;
  return input instanceof Request ? input.url : String(input);
}

function withSignature(
  input: string | URL | Request,
  init: RequestInit | undefined,
  header: string,
): [string | URL | Request, RequestInit | undefined] {
  if (input instanceof Request) {
    const base = input.clone();
    const headers = new Headers(base.headers);
    for (const [key, value] of new Headers(init?.headers)) headers.set(key, value);
    headers.set(PAYMENT_SIGNATURE_HEADER, header);
    return [new Request(base, { ...(init ?? {}), headers }), undefined];
  }
  const headers = new Headers(init?.headers);
  headers.set(PAYMENT_SIGNATURE_HEADER, header);
  return [input, { ...(init ?? {}), headers }];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
