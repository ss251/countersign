import { keccak256, toBytes, type Hex } from "viem";
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
import { gatewayPayment, TRANSFER_WITH_AUTHORIZATION_TYPES } from "@countersign/rail";
import { HEDERA_TESTNET, USDC_TESTNET } from "@countersign/rail/hedera";
import { type Address, getAddress } from "viem";
import { hederaPayment, type HederaPayer } from "./hedera/signer.ts";
import { trustedHederaFeePayers } from "./hedera/trust.ts";
import {
  KNOWN_DIRECTS,
  KNOWN_GATEWAYS,
  knownDirectFor,
  knownGatewayFor,
  pinnedDirectFor,
  type KnownDirect,
  type KnownGateway,
  type KnownRail,
} from "./known-rails.ts";

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
      const extra = req.extra as unknown as CountersignExtra & { bond?: unknown; reviewWindow?: unknown };
      const terms: CountersignTerms = {
        offerHash: extra.offerHash,
        buyer: account.address,
        payee: req.payTo as Address,
        amount: req.amount,
        deadline: ctx.now + extra.deadlineSeconds,
        salt: randomSalt(),
        // Only a rail pinned as v2 signs the v2 struct, which derives the v2 jobId.
        ...((rail.version ?? 1) === 2
          ? {
              bond: typeof extra.bond === "string" ? extra.bond : "0",
              reviewWindow: typeof extra.reviewWindow === "number" ? extra.reviewWindow : 0,
            }
          : {}),
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

/** Signs a direct EIP-3009 transfer, but only under a pinned token's own domain. */
export function eip3009Payer(account: LocalAccount, known: KnownDirect[] = KNOWN_DIRECTS): Payer {
  return {
    account,
    canPay(req) {
      return knownDirectFor(req, known) !== undefined;
    },
    async pay(req, ctx) {
      // The domain comes from the pinned token, never from the hub's entry.
      const direct = pinnedDirectFor(req, known);
      if (!direct) throw new Error("Refused. This rail is not one this agent knows.");
      const nonce = randomNonce();
      const validAfter = ctx.now - 5;
      const validBefore = ctx.now + Math.min(req.maxTimeoutSeconds, 300);
      const to = getAddress(req.payTo as Address);
      const signature = await account.signTypedData({
        domain: {
          name: direct.name,
          version: direct.version,
          chainId: direct.chainId,
          verifyingContract: getAddress(direct.asset),
        },
        types: TRANSFER_WITH_AUTHORIZATION_TYPES,
        primaryType: "TransferWithAuthorization",
        message: {
          from: getAddress(account.address),
          to,
          value: BigInt(req.amount),
          validAfter: BigInt(validAfter),
          validBefore: BigInt(validBefore),
          nonce,
        },
      });
      const payment: PaymentPayload = {
        x402Version: 2,
        accepted: req,
        payload: {
          signature,
          authorization: {
            from: getAddress(account.address),
            to,
            value: req.amount,
            validAfter: String(validAfter),
            validBefore: String(validBefore),
            nonce,
          },
        },
        ...(ctx.resource !== undefined ? { resource: ctx.resource } : {}),
      };
      return { payment, jobId: nonce };
    },
  };
}

/** Pays an x402 `exact` requirement on Hedera testnet, but only from a hedera wallet this agent holds. */
export function hederaPayer(
  payer: HederaPayer,
  opts: { trusted?: () => Promise<Set<string>> } = {},
): Payer {
  const trusted = opts.trusted ?? trustedHederaFeePayers;
  return {
    canPay(req) {
      return req.scheme === "exact" && req.network === HEDERA_TESTNET && req.asset === USDC_TESTNET;
    },
    async pay(req, ctx) {
      const feePayer = req.extra?.feePayer;
      if (typeof feePayer !== "string" || !(await trusted()).has(feePayer)) {
        throw new Error("Refused. The hub named a fee payer this agent does not trust.");
      }
      const { payment, transactionId } = await hederaPayment(payer, req, ctx.resource?.url);
      // The hub keys a Hedera job by the transfer's transaction id.
      return { payment, jobId: keccak256(toBytes(transactionId)) };
    },
  };
}

export { hubHederaAccount, hubHederaSigner } from "./hedera/hub-signer.ts";
export type { HederaAccount, HubSession } from "./hedera/hub-signer.ts";

function randomNonce(): Hex {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
