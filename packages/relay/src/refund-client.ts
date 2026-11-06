import { getAddress } from "viem";
import { toAccount } from "viem/accounts";
import type { Address, Hex, LocalAccount } from "viem";
import { parseAtomic } from "@countersign/core";
import { sameAddress } from "./eip3009.ts";
import { signCancel, signRefund } from "./merchant.ts";

/** The relay's accepted refund reasons, kept here so the browser entry reads no ledger module. */
export type RefundReason =
  | "requested_by_customer"
  | "duplicate"
  | "not_delivered"
  | "other";

/** The Whitechain escrow; the browser entry reads no deployment module. */
const WHITECHAIN_ESCROW: Address = "0x9279D3edeef4c3738a0b200D762e2985Ff3B7eb4";

/** An order as the relay returns it, before refunding. */
export type RefundOrderView = {
  id: string;
  kind: string;
  status: string;
  customer: string;
  merchant: string;
  amount: string | bigint;
  refunded?: string | bigint;
  escrow?: string;
};

export type RefundOrderInput = {
  relayUrl: string;
  merchant: LocalAccount;
  order: RefundOrderView;
  amount?: bigint;
  reason?: RefundReason;
  escrow?: Address;
  now?: () => number;
  fetch?: typeof fetch;
};

export type RefundOrderReply =
  | ({ ok: true } & Record<string, unknown>)
  | ({ ok: false; reason: string } & Record<string, unknown>)
  | { ok: "unknown"; reason: string };

const MAY_HAVE_GONE =
  "The refund may have been sent. Reload to see whether it settled before refunding again.";

/**
 * A connected wallet as the account `createPayFetch` and `refundOrder` accept. Only typed-data
 * signatures are supported; sending a message or a transaction throws.
 */
export function walletAccount(
  address: Address,
  signTypedData: LocalAccount["signTypedData"],
): LocalAccount {
  const unsupported = async (): Promise<Hex> => {
    throw new Error("only typed-data signatures are supported");
  };
  return toAccount({
    address,
    signMessage: unsupported,
    signTransaction: unsupported,
    signTypedData,
  });
}

/** Refund one order through the same path the merchant service uses. */
export async function refundOrder(input: RefundOrderInput): Promise<RefundOrderReply> {
  return (await refundOrderWithStatus(input)).reply;
}

/** The same refund path, keeping the HTTP status the merchant service answers with. */
export async function refundOrderWithStatus(
  input: RefundOrderInput,
): Promise<{ reply: RefundOrderReply; status: number }> {
  const { merchant, order } = input;
  if (!sameAddress(order.merchant, merchant.address)) {
    return { reply: { ok: false, reason: "not_your_order" }, status: 403 };
  }

  const relayUrl = input.relayUrl.replace(/\/+$/, "");
  const now = input.now ?? (() => Math.floor(Date.now() / 1000));
  const send = input.fetch ?? globalThis.fetch;

  if (order.kind === "escrow" && (order.status === "held" || order.status === "in_review")) {
    const full = atomicOf(order.amount);
    if (input.amount !== undefined && input.amount !== full) {
      return { reply: { ok: false, reason: "partial_cancel_not_possible" }, status: 400 };
    }
    const escrow = (order.escrow ?? input.escrow ?? WHITECHAIN_ESCROW) as Address;
    const sellerSig = await signCancel({ merchant, escrow, jobId: order.id as Hex });
    return post(send, `${relayUrl}/escrow/cancel`, {
      jobId: order.id,
      sellerSig,
      ...(input.reason ? { reason: input.reason } : {}),
    });
  }

  if (order.status === "paid" || order.status === "partially_refunded") {
    let signed;
    try {
      signed = await signRefund({
        merchant,
        payment: {
          id: order.id,
          payer: getAddress(order.customer),
          payTo: getAddress(order.merchant),
          amount: atomicOf(order.amount),
          refunded: order.refunded === undefined ? 0n : atomicOf(order.refunded),
        },
        amount: input.amount,
        now: now(),
      });
    } catch {
      return { reply: { ok: false, reason: "refund_not_possible" }, status: 400 };
    }
    return post(send, `${relayUrl}/refund`, {
      paymentId: order.id,
      ...signed,
      ...(input.reason ? { reason: input.reason } : {}),
    });
  }

  return { reply: { ok: false, reason: "not_refundable" }, status: 409 };
}

function atomicOf(value: string | bigint): bigint {
  return typeof value === "bigint" ? value : parseAtomic(value);
}

async function post(
  send: typeof fetch,
  url: string,
  payload: unknown,
): Promise<{ reply: RefundOrderReply; status: number }> {
  let response: Response;
  try {
    response = await send(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    return { reply: { ok: "unknown", reason: MAY_HAVE_GONE }, status: 502 };
  }
  if (response.status >= 500) {
    return { reply: { ok: "unknown", reason: MAY_HAVE_GONE }, status: 502 };
  }
  try {
    return { reply: (await response.json()) as RefundOrderReply, status: response.status };
  } catch {
    return { reply: { ok: "unknown", reason: MAY_HAVE_GONE }, status: 502 };
  }
}
