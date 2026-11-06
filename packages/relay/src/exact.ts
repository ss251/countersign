import type { Address, Hex } from "viem";
import { atomicToWire, parseAtomic } from "@countersign/core";
import { NETWORK, USDT } from "./chain.ts";
import type { Ledger } from "./ledger.ts";
import type { Relayer, RelayCall, RelayRefusalReason } from "./relayer.ts";
import type { ChainReader } from "./ports.ts";
import {
  authorizationFromWire,
  recoverAuthorizer,
  sameAddress,
  tokenAbi,
} from "./eip3009.ts";
import type { Authorization, WireAuthorization } from "./eip3009.ts";
import { reconcilePendingPayment } from "./reconcile.ts";

export type PaymentExtra = {
  assetTransferMethod?: string;
  name?: string;
  version?: string;
};

export type PaymentRequirements = {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: PaymentExtra;
};

export type PaymentPayload = {
  x402Version: number;
  resource?: string | { url?: string; description?: string; mimeType?: string };
  accepted: PaymentRequirements;
  payload: {
    signature: string;
    authorization: WireAuthorization;
  };
  extensions?: Record<string, unknown>;
};

export type VerifyRequest = {
  x402Version: number;
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
};

export type VerifyResponse = {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
};

export type SettleResponse = {
  success: boolean;
  errorReason?: string;
  payer?: string;
  transaction: string;
  network: string;
  amount?: string;
};

export type ExactClock = number | (() => number);

export type ExactContext = {
  reader: ChainReader;
  relayer: Relayer;
  ledger: Ledger;
  now: ExactClock;
};

export function readNow(clock: ExactClock): number {
  return typeof clock === "function" ? clock() : clock;
}

export async function verifyExact(
  input: VerifyRequest,
  ctx: ExactContext,
): Promise<VerifyResponse> {
  const body = input as VerifyRequest | null | undefined;
  if (!body || body.x402Version !== 2) return invalid("invalid_payload");

  const requirements = body.paymentRequirements;
  if (!requirements || typeof requirements !== "object") return invalid("invalid_payload");
  if (requirements.scheme !== "exact") return invalid("invalid_scheme");
  if (requirements.network !== NETWORK) return invalid("invalid_network");
  if (typeof requirements.asset !== "string" || !sameAddress(requirements.asset, USDT.address)) {
    return invalid("invalid_payload");
  }
  if (!validExtra(requirements.extra)) return invalid("invalid_payload");

  const payload = body.paymentPayload;
  if (!payload || typeof payload !== "object") return invalid("invalid_payload");
  const accepted = payload.accepted;
  if (!accepted || typeof accepted !== "object") return invalid("invalid_payload");
  if (!matchesAccepted(accepted, requirements)) return invalid("invalid_payload");

  const rawPayload = payload.payload;
  if (!rawPayload || typeof rawPayload !== "object") return invalid("invalid_payload");

  let auth: Authorization;
  try {
    auth = authorizationFromWire(rawPayload.authorization);
  } catch {
    return invalid("invalid_payload");
  }

  if (!sameAddress(auth.to, requirements.payTo)) {
    return invalid("invalid_exact_evm_payload_recipient_mismatch");
  }

  let amount: bigint;
  try {
    amount = parseAtomic(requirements.amount);
  } catch {
    return invalid("invalid_payload");
  }
  if (!ctx.relayer.isAllowedPayee(auth.to)) {
    return invalid("payee_not_registered");
  }
  if (amount < ctx.relayer.minAmount) {
    return invalid("amount_below_minimum");
  }
  if (auth.value !== amount) {
    return invalid("invalid_exact_evm_payload_authorization_value_mismatch");
  }

  const now = readNow(ctx.now);
  if (auth.validAfter > BigInt(now)) {
    return invalid("invalid_exact_evm_payload_authorization_valid_after");
  }
  if (auth.validBefore <= BigInt(now + 6)) {
    return invalid("invalid_exact_evm_payload_authorization_valid_before");
  }

  const signature = rawPayload.signature;
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature)) {
    return invalid("invalid_exact_evm_payload_signature");
  }
  let recovered: Address;
  try {
    recovered = await recoverAuthorizer(auth, signature as Hex);
  } catch {
    return invalid("invalid_exact_evm_payload_signature");
  }
  if (!sameAddress(recovered, auth.from)) {
    return invalid("invalid_exact_evm_payload_signature");
  }

  let balance: bigint;
  try {
    balance = (await ctx.reader.readContract({
      address: USDT.address,
      abi: tokenAbi,
      functionName: "balanceOf",
      args: [auth.from],
    })) as bigint;
  } catch {
    return invalid("insufficient_funds");
  }
  if (typeof balance !== "bigint" || balance < auth.value) {
    return invalid("insufficient_funds");
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
    return invalid("invalid_transaction_state");
  }
  if (used !== false) {
    return invalid("invalid_transaction_state");
  }

  const simulation = await ctx.relayer.simulate(relayCall(auth, signature as Hex));
  if (!simulation.ok) return invalid("invalid_transaction_state");

  return { isValid: true, payer: auth.from };
}

export async function settleExact(
  input: VerifyRequest,
  ctx: ExactContext,
): Promise<SettleResponse> {
  const payload = input?.paymentPayload;
  let existingAuth: Authorization | null = null;
  try {
    existingAuth = authorizationFromWire(payload?.payload?.authorization as WireAuthorization);
  } catch {
    existingAuth = null;
  }

  if (existingAuth) {
    const existing = ctx.ledger.findByAuthorization(existingAuth.from, existingAuth.nonce);
    if (existing) {
      if (existing.status === "pending" && (await reconcilePendingPayment(existing.id, ctx))) {
        const promoted = ctx.ledger.getPayment(existing.id) ?? existing;
        return {
          success: true,
          payer: promoted.payer,
          transaction: promoted.txHash,
          network: NETWORK,
          amount: atomicToWire(promoted.amount),
        };
      }
      if (existing.status === "settled") {
        return {
          success: true,
          payer: existing.payer,
          transaction: existing.txHash,
          network: NETWORK,
          amount: atomicToWire(existing.amount),
        };
      }
      return {
        success: false,
        errorReason: "invalid_transaction_state",
        payer: existing.payer,
        transaction: existing.txHash,
        network: NETWORK,
      };
    }
  }

  const verified = await verifyExact(input, ctx);
  if (!verified.isValid || !verified.payer) {
    return {
      success: false,
      errorReason: verified.invalidReason ?? "invalid_payload",
      transaction: "",
      network: NETWORK,
    };
  }

  const requirements = input.paymentRequirements;
  const wire = input.paymentPayload.payload.authorization;
  const auth = authorizationFromWire(wire);
  const signature = input.paymentPayload.payload.signature as Hex;
  const payer = verified.payer;

  const outcome = await ctx.relayer.submit(relayCall(auth, signature), payer as Address);

  if (outcome.status === "confirmed") {
    ctx.ledger.recordPayment({
      id: outcome.txHash,
      network: NETWORK,
      payer,
      payTo: auth.to,
      amount: auth.value,
      nonce: auth.nonce,
      txHash: outcome.txHash,
      blockNumber: outcome.blockNumber,
      settledAt: readNow(ctx.now) * 1000,
      resource: resourceUrl(input.paymentPayload.resource),
    });
    return {
      success: true,
      payer,
      transaction: outcome.txHash,
      network: NETWORK,
      amount: atomicToWire(auth.value),
    };
  }

  if (outcome.status === "pending") {
    ctx.ledger.recordPending({
      id: outcome.txHash,
      network: NETWORK,
      payer,
      payTo: auth.to,
      amount: auth.value,
      nonce: auth.nonce,
      txHash: outcome.txHash,
      blockNumber: 0n,
      settledAt: readNow(ctx.now) * 1000,
      resource: resourceUrl(input.paymentPayload.resource),
    });
    return {
      success: false,
      errorReason: "settlement_pending",
      payer,
      transaction: outcome.txHash,
      network: NETWORK,
    };
  }

  if (outcome.status === "reverted") {
    return {
      success: false,
      errorReason: "invalid_transaction_state",
      payer,
      transaction: outcome.txHash,
      network: NETWORK,
    };
  }

  return {
    success: false,
    errorReason: refusalReason(outcome.reason),
    transaction: "",
    network: NETWORK,
  };
}

function relayCall(auth: Authorization, signature: Hex): RelayCall {
  return { kind: "transferWithAuthorization", token: USDT.address, auth, signature };
}

function invalid(reason: string): VerifyResponse {
  return { isValid: false, invalidReason: reason };
}

function validExtra(extra: unknown): boolean {
  if (extra === undefined || extra === null) return true;
  if (typeof extra !== "object") return false;
  const value = extra as PaymentExtra;
  if (
    value.assetTransferMethod !== undefined &&
    value.assetTransferMethod !== "eip3009"
  ) {
    return false;
  }
  if (value.name !== undefined && value.name !== USDT.name) return false;
  if (value.version !== undefined && value.version !== USDT.version) return false;
  return true;
}

function matchesAccepted(
  accepted: PaymentRequirements,
  requirements: PaymentRequirements,
): boolean {
  if (accepted.scheme !== requirements.scheme) return false;
  if (accepted.network !== requirements.network) return false;
  if (accepted.amount !== requirements.amount) return false;
  if (typeof accepted.asset !== "string") return false;
  if (!sameAddress(accepted.asset, requirements.asset)) return false;
  if (typeof accepted.payTo !== "string" || typeof requirements.payTo !== "string") {
    return false;
  }
  return sameAddress(accepted.payTo, requirements.payTo);
}

function refusalReason(reason: RelayRefusalReason): string {
  switch (reason) {
    case "simulation_failed":
      return "invalid_transaction_state";
    case "ceiling_wei":
    case "ceiling_tx":
    case "ceiling_payer":
      return "relay_ceiling_reached";
    case "balance_floor":
      return "relay_balance_low";
    case "fee_too_high":
      return "relay_fee_too_high";
    case "not_allowed":
      return "invalid_payload";
  }
}

/** x402 v2 sends `resource` as a ResourceInfo object; older clients sent the bare URL. */
function resourceUrl(resource: PaymentPayload["resource"]): string | null {
  if (typeof resource === "string") return resource;
  if (resource && typeof resource === "object" && typeof resource.url === "string") return resource.url;
  return null;
}
