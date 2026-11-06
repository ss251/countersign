import type { Hex } from "viem";
import type { LocalAccount } from "viem/accounts";
import {
  authorizationTypedData,
  countersignPayload,
  jobIdOf,
  type AuthorizationInput,
  type CountersignExtra,
  type CountersignTerms,
  type PaymentPayload,
  type PaymentRequired,
  type PaymentRequirements,
} from "@countersign/core";
import { gatewayPayment } from "@countersign/rail";
import type { Address } from "viem";
import { KNOWN_GATEWAYS, knownGatewayFor, type KnownGateway, type KnownRail } from "./known-rails.ts";

export interface PayContext {
  now: number;
  /** Present for the countersign scheme; a gateway payment does not need an escrow rail. */
  rail?: KnownRail;
  /** The 402's resource, echoed into a Gateway payment so Circle can verify it. */
  resource?: PaymentRequired["resource"];
}

export interface Payer {
  /** The agent key that signs this payer's payments, when the payer has one. */
  readonly account?: LocalAccount;
  canPay(req: PaymentRequirements): boolean;
  pay(
    req: PaymentRequirements,
    ctx: PayContext,
  ): Promise<{ payment: PaymentPayload; jobId: Hex }>;
}

function randomSalt(): string {
  const words = crypto.getRandomValues(new Uint32Array(8));
  let n = 0n;
  for (const w of words) n = (n << 32n) | BigInt(w);
  return n.toString(10);
}

/** Signs typed data and nothing else. No gas, no chain access. */
export function countersignPayer(account: LocalAccount): Payer {
  return {
    account,
    canPay(req) {
      return req.scheme === "countersign" && req.network.startsWith("eip155:");
    },
    async pay(req, ctx) {
      const rail = ctx.rail;
      if (!rail) throw new Error("Refused. This rail is not one this agent knows.");
      const extra = req.extra as unknown as CountersignExtra;
      const terms: CountersignTerms = {
        offerHash: extra.offerHash,
        buyer: account.address,
        payee: req.payTo as Address,
        amount: req.amount,
        deadline: ctx.now + extra.deadlineSeconds,
        salt: randomSalt(),
      };
      const input: AuthorizationInput = {
        terms,
        chainId: rail.chainId,
        escrow: rail.escrow,
        token: rail.token,
        tokenName: rail.tokenName,
        tokenVersion: rail.tokenVersion,
        validAfter: 0,
        validBefore: ctx.now + 600,
      };
      const sig = await account.signTypedData(authorizationTypedData(input));
      return {
        payment: { x402Version: 2, accepted: req, payload: countersignPayload(input, sig) as unknown as Record<string, unknown> },
        jobId: jobIdOf(terms, rail.chainId, rail.escrow),
      };
    },
  };
}

/** Signs a Circle Gateway nanopayment, but only for a pinned Gateway and token. */
export function gatewayPayer(account: LocalAccount, known: KnownGateway[] = KNOWN_GATEWAYS): Payer {
  return {
    account,
    canPay(req) {
      return knownGatewayFor(req, known) !== undefined;
    },
    async pay(req, ctx) {
      if (!knownGatewayFor(req, known)) {
        throw new Error("Refused. This rail is not one this agent knows.");
      }
      const payment = await gatewayPayment(account, req, ctx.resource);
      const authorization = payment.payload.authorization;
      if (!isRecord(authorization) || typeof authorization.nonce !== "string") {
        throw new Error("Refused. Circle Gateway did not return an authorisation nonce.");
      }
      return { payment, jobId: authorization.nonce as Hex };
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
