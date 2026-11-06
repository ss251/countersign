/**
 * Buyer side of the gateway rail: sign an x402 v2 "exact" payment under Circle's
 * GatewayWalletBatched scheme. The buyer signs locally; Circle Gateway debits the
 * buyer's deposit and later credits the seller in a batch.
 */

import { BatchEvmScheme } from "@circle-fin/x402-batching/client";
import type { LocalAccount } from "viem";
import type { PaymentPayload, PaymentRequirements } from "@countersign/core";

export const GATEWAY_BATCHED = "GatewayWalletBatched";

/** True for a requirement this rail can sign: exact, batched through Gateway. */
export function isGatewayRequirement(req: PaymentRequirements): boolean {
  return req.scheme === "exact" && req.extra?.name === GATEWAY_BATCHED;
}

/**
 * Sign a Gateway payment for `requirements`. `signer` is a viem local account;
 * its signTypedData already matches what BatchEvmScheme needs.
 */
export async function gatewayPayment(
  signer: LocalAccount,
  requirements: PaymentRequirements,
): Promise<PaymentPayload> {
  const scheme = new BatchEvmScheme({
    address: signer.address,
    signTypedData: (params) => signer.signTypedData(params),
  });
  const created = await scheme.createPaymentPayload(2, requirements);
  return {
    x402Version: 2,
    accepted: requirements,
    payload: created.payload as unknown as Record<string, unknown>,
  };
}
