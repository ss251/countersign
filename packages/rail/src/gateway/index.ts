/**
 * The gateway rail: Circle Gateway nanopayments on Arc testnet.
 *
 * The buyer pays from a Gateway deposit by signing an x402 v2 "exact" payment under
 * the GatewayWalletBatched scheme. Circle Gateway verifies and debits the buyer at
 * once, then credits the seller in a later batch. The hub never holds the money and
 * never pays gas.
 */

import { BatchFacilitatorClient } from "@circle-fin/x402-batching/server";
import type {
  Asset,
  Network,
  Offer,
  PaymentPayload,
  PaymentRequirements,
  SettleResult,
  VerifyResult,
} from "@countersign/core";
import type { ChallengeContext, Rail, RailDeclaration } from "../rail.ts";
import { GATEWAY_BATCHED } from "./payer.ts";

export * from "./payer.ts";

export const DEFAULT_FACILITATOR_URL = "https://gateway-api-testnet.circle.com";
export const GATEWAY_NETWORK = "eip155:5042002" as const;
const USDC_DECIMALS = 6;
const MISMATCH = "Refused. The payment does not match this offer.";

interface SupportedKind {
  scheme: string;
  network: string;
  extra?: Record<string, unknown>;
}

export interface FacilitatorLike {
  getSupported(): Promise<{ kinds: SupportedKind[] }>;
  verify(payment: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResult>;
  settle(
    payment: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<{
    success: boolean;
    errorReason?: string;
    payer?: string;
    transaction: string;
    network: string;
  }>;
}

export interface GatewayRailConfig {
  /** Default https://gateway-api-testnet.circle.com */
  facilitatorUrl?: string;
  /** Only Arc testnet is supported today. */
  network?: typeof GATEWAY_NETWORK;
  /** Injected in tests; by default a BatchFacilitatorClient. */
  facilitator?: FacilitatorLike;
}

export async function gatewayRail(cfg: GatewayRailConfig = {}): Promise<Rail> {
  const network: Network = cfg.network ?? GATEWAY_NETWORK;
  const facilitator =
    cfg.facilitator ??
    (new BatchFacilitatorClient({
      url: cfg.facilitatorUrl ?? DEFAULT_FACILITATOR_URL,
    }) as unknown as FacilitatorLike);

  const supported = await facilitator.getSupported();
  const kind = supported.kinds.find(
    (k) => k.scheme === "exact" && k.network === network && k.extra?.name === GATEWAY_BATCHED,
  );
  if (!kind) {
    throw new Error(`Circle Gateway offers no exact/${GATEWAY_BATCHED} payment kind on ${network}.`);
  }

  const { assets, minValiditySeconds, ...extra } = kind.extra ?? {};
  const usdc = usdcAddress(assets);
  if (
    typeof extra.name !== "string" ||
    typeof extra.version !== "string" ||
    typeof extra.verifyingContract !== "string"
  ) {
    throw new Error(`Circle Gateway's ${GATEWAY_BATCHED} kind on ${network} is missing its signing domain.`);
  }
  // Kept for the rail's metadata; the challenge carries only the signing domain.
  const info = { extra, usdc, minValiditySeconds };

  const asset: Asset = { network, address: info.usdc, symbol: "USDC", decimals: USDC_DECIMALS };
  const declaration: RailDeclaration = {
    id: "gateway",
    network,
    scheme: "exact",
    asset,
    kind: "batched",
    gasPaidBy: "gateway",
    finality: "The buyer's Gateway balance is debited at once; Circle Gateway credits the seller in its next batch.",
    explorerTx: "",
    finalitySeconds: 900,
    cost: { tollBps: 0, fixed: "0" },
  };

  function challenge(offer: Offer, _ctx: ChallengeContext): PaymentRequirements {
    return {
      scheme: "exact",
      network,
      amount: offer.price,
      asset: info.usdc,
      payTo: offer.payTo?.gateway ?? offer.seller,
      maxTimeoutSeconds: Math.max(offer.deadline, 60),
      extra: { ...info.extra },
    };
  }

  async function verify(payment: PaymentPayload, req: PaymentRequirements): Promise<VerifyResult> {
    if (!matches(payment.accepted, req)) return { isValid: false, invalidReason: MISMATCH };
    try {
      const result = await facilitator.verify(payment, req);
      if (result.isValid) {
        return { isValid: true, ...(result.payer ? { payer: result.payer } : {}) };
      }
      return {
        isValid: false,
        invalidReason: `Refused. ${result.invalidReason ?? "Circle Gateway refused the payment."}`,
        ...(result.payer ? { payer: result.payer } : {}),
      };
    } catch (e) {
      return { isValid: false, invalidReason: `Refused. ${short(e)}` };
    }
  }

  async function settle(payment: PaymentPayload, req: PaymentRequirements): Promise<SettleResult> {
    if (!matches(payment.accepted, req)) {
      return { success: false, errorReason: MISMATCH, transaction: "", network };
    }
    try {
      const result = await facilitator.settle(payment, req);
      return {
        success: result.success,
        ...(result.errorReason ? { errorReason: result.errorReason } : {}),
        ...(result.payer ? { payer: result.payer } : {}),
        transaction: result.transaction,
        network: result.network ? (result.network as Network) : network,
      };
    } catch (e) {
      return { success: false, errorReason: short(e), transaction: "", network };
    }
  }

  return { declaration, challenge, verify, settle };
}

/** The local pre-check: everything the buyer signed must name this exact offer. */
function matches(accepted: PaymentRequirements | undefined, req: PaymentRequirements): boolean {
  if (!accepted) return false;
  return (
    accepted.scheme === req.scheme &&
    accepted.network === req.network &&
    accepted.amount === req.amount &&
    typeof accepted.asset === "string" &&
    accepted.asset.toLowerCase() === req.asset.toLowerCase() &&
    typeof accepted.payTo === "string" &&
    accepted.payTo.toLowerCase() === req.payTo.toLowerCase()
  );
}

/** The USDC token address from the supported kind's asset list. */
function usdcAddress(assets: unknown): string {
  if (!Array.isArray(assets)) {
    throw new Error("Circle Gateway's supported kind does not list its assets.");
  }
  for (const asset of assets) {
    if (isRecord(asset) && asset.symbol === "USDC" && typeof asset.address === "string") {
      return asset.address;
    }
  }
  throw new Error("Circle Gateway's supported kind does not list USDC.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function short(e: unknown): string {
  const m = e instanceof Error ? ((e as { shortMessage?: string }).shortMessage ?? e.message) : String(e);
  return m.split("\n")[0]!.slice(0, 200) || "Circle Gateway refused the settlement.";
}
