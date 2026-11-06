import type { Hex } from "viem";
import { USDT, txUrl } from "./chain.ts";
import type { ExactContext } from "./exact.ts";
import { readNow } from "./exact.ts";
import {
  authorizationFromWire,
  recoverAuthorizer,
  sameAddress,
  tokenAbi,
} from "./eip3009.ts";
import type { Authorization, WireAuthorization } from "./eip3009.ts";
import type { RelayCall } from "./relayer.ts";

export type RefundInput = {
  paymentId: string;
  authorization: Authorization | WireAuthorization;
  signature: Hex;
};

export type RefundResult =
  | { ok: true; txHash: string; txUrl: string; refunded: bigint; remaining: bigint }
  | { ok: false; reason: string };

export async function refundPayment(
  input: RefundInput,
  ctx: ExactContext,
): Promise<RefundResult> {
  const payment = findRefundable(input.paymentId, ctx);
  if (!payment) return { ok: false, reason: "payment_not_found" };
  if (payment.status !== "settled") return { ok: false, reason: "payment_not_settled" };

  let auth: Authorization;
  try {
    auth = normalize(input.authorization);
  } catch {
    return { ok: false, reason: "invalid_payload" };
  }

  if (!sameAddress(auth.from, payment.payTo)) {
    return { ok: false, reason: "refund_from_not_merchant" };
  }
  if (!sameAddress(auth.to, payment.payer)) {
    return { ok: false, reason: "refund_to_not_payer" };
  }
  if (auth.value <= 0n || auth.value > ctx.ledger.refundable(payment.id)) {
    return { ok: false, reason: "refund_amount" };
  }

  const now = readNow(ctx.now);
  if (auth.validAfter > BigInt(now)) {
    return { ok: false, reason: "refund_not_yet_valid" };
  }
  if (auth.validBefore <= BigInt(now + 6)) {
    return { ok: false, reason: "refund_expired" };
  }

  let recovered: string;
  try {
    recovered = await recoverAuthorizer(auth, input.signature);
  } catch {
    return { ok: false, reason: "refund_signature" };
  }
  if (!sameAddress(recovered, auth.from)) {
    return { ok: false, reason: "refund_signature" };
  }

  let used: boolean;
  try {
    used = (await ctx.reader.readContract({
      address: USDT.address,
      abi: tokenAbi,
      functionName: "authorizationState",
      args: [auth.from, auth.nonce],
    })) as boolean;
  } catch {
    return { ok: false, reason: "refund_nonce_check_failed" };
  }
  if (used !== false) return { ok: false, reason: "refund_nonce_used" };

  const call: RelayCall = {
    kind: "transferWithAuthorization",
    token: USDT.address,
    auth,
    signature: input.signature,
  };
  const simulation = await ctx.relayer.simulate(call);
  if (!simulation.ok) {
    return { ok: false, reason: "refund_simulation_failed" };
  }

  return ctx.relayer.exclusive(async () => {
    const remaining = ctx.ledger.refundable(payment.id);
    if (auth.value <= 0n || auth.value > remaining) {
      return { ok: false, reason: "refund_amount" };
    }
    const outcome = await ctx.relayer.submitUnlocked(call, auth.from);
    if (outcome.status === "confirmed") {
      ctx.ledger.recordRefund({
        paymentId: payment.id,
        amount: auth.value,
        txHash: outcome.txHash,
        blockNumber: outcome.blockNumber,
        nonce: auth.nonce,
      });
      return {
        ok: true,
        txHash: outcome.txHash,
        txUrl: txUrl(outcome.txHash),
        refunded: auth.value,
        remaining: remaining - auth.value,
      };
    }
    if (outcome.status === "pending") return { ok: false, reason: "settlement_pending" };
    if (outcome.status === "reverted") return { ok: false, reason: "transaction_reverted" };
    return { ok: false, reason: outcome.reason };
  });
}

/** A direct payment, or an escrow job that has been released to the merchant. */
function findRefundable(
  id: string,
  ctx: ExactContext,
): { id: string; payTo: string; payer: string; status: "settled" | "pending" } | null {
  const payment = ctx.ledger.getPayment(id);
  if (payment) return payment;
  const job = ctx.ledger.getJob(id);
  if (!job) return null;
  return {
    id: job.jobId,
    payTo: job.payee,
    payer: job.buyer,
    status: job.status === "released" ? "settled" : "pending",
  };
}

function normalize(auth: Authorization | WireAuthorization): Authorization {
  if (isWireAuthorization(auth)) {
    return authorizationFromWire(auth);
  }
  return auth;
}

function isWireAuthorization(
  auth: Authorization | WireAuthorization,
): auth is WireAuthorization {
  return typeof (auth as WireAuthorization).value === "string";
}
