// Facilitators for x402 `exact` on hedera:testnet. A facilitator co-signs the buyer's transfer as
// fee payer and submits it. The hosted ones are used first; `localFacilitator` is the last resort,
// where our own operator account pays the fee through the x402 reference facilitator code.
import { HTTPFacilitatorClient } from "@x402/core/server";
import type {
  PaymentPayload as X402Payload,
  PaymentRequirements as X402Requirements,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import {
  createHederaClient,
  createHederaPreflightTransfer,
  createHederaSignAndSubmitTransaction,
  createHederaVerifyPayerSignature,
  toFacilitatorHederaSigner,
} from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/facilitator";
import type { PrivateKey } from "@hiero-ledger/sdk";
import { HEDERA_TESTNET } from "./constants.ts";

export type { SettleResponse, VerifyResponse, X402Payload, X402Requirements };

export interface Facilitator {
  readonly name: string;
  /** The fee payer it publishes for `exact` on hedera:testnet, or null when it does not list that kind. */
  feePayer(): Promise<string | null>;
  verify(payment: X402Payload, requirements: X402Requirements): Promise<VerifyResponse>;
  settle(payment: X402Payload, requirements: X402Requirements): Promise<SettleResponse>;
}

export function httpFacilitator(name: string, url: string, timeoutMs = 30_000): Facilitator {
  const client = new HTTPFacilitatorClient({ url, timeoutMs });
  return {
    name,
    async feePayer() {
      const supported = await client.getSupported();
      const kind = supported.kinds.find(
        (k) => k.x402Version === 2 && k.scheme === "exact" && k.network === HEDERA_TESTNET,
      );
      const feePayer = kind?.extra?.feePayer;
      return typeof feePayer === "string" ? feePayer : null;
    },
    verify: (payment, requirements) => client.verify(payment, requirements),
    settle: (payment, requirements) => client.settle(payment, requirements),
  };
}

/**
 * Our own operator account as fee payer, running the x402 reference `exact` facilitator in process.
 * It refuses payees that are bare aliases, so a payment can never pay for creating an account.
 */
export function localFacilitator(operatorId: string, operatorKey: PrivateKey): Facilitator {
  const signer = toFacilitatorHederaSigner({
    getAddresses: () => [operatorId],
    signAndSubmitTransaction: createHederaSignAndSubmitTransaction((network) => createHederaClient(network), operatorKey),
    verifyPayerSignature: createHederaVerifyPayerSignature(),
    preflightTransfer: createHederaPreflightTransfer(),
  });
  const scheme = new ExactHederaScheme(signer, { aliasPolicy: "reject" });
  return {
    name: "local",
    feePayer: async () => operatorId,
    verify: (payment, requirements) => scheme.verify(payment, requirements),
    settle: (payment, requirements) => scheme.settle(payment, requirements),
  };
}
