/**
 * The Rail interface. Everything above a rail (hub, buyer, runner, web) speaks only this;
 * nothing above it knows which chain it is on.
 *
 * The three methods are the x402 facilitator trio:
 *   challenge -> the PaymentRequirements entry for an offer (one item of the 402 `accepts` list)
 *   verify    -> check a buyer's payment without moving money
 *   settle    -> move the money. On a direct rail that is the final transfer; on an escrow
 *                rail it funds the escrow, and the job is closed later through `escrow`.
 */

import type {
  Asset,
  Network,
  Offer,
  PaymentPayload,
  PaymentRequirements,
  RailId,
  Scheme,
  SettleResult,
  VerifyResult,
} from "@countersign/core";
import type { Hex } from "viem";

/** What a rail is, in data. Shown on every receipt view and published in discovery metadata. */
export interface RailDeclaration {
  id: RailId;
  network: Network;
  scheme: Scheme;
  asset: Asset;
  /**
   * escrow:  funds lock in a contract until release or refund
   * direct:  one transfer, final when it lands
   * batched: the buyer is debited at once, the seller is credited in a later batch
   */
  kind: "escrow" | "direct" | "batched";
  /** Escrow contract, when kind is "escrow". */
  escrow?: string;
  /**
   * Who pays the network fee. On most rails it is the hub, a relayer, a facilitator or Gateway.
   * On mpp:tempo the buyer's own Tempo transaction pays it, a fraction of a cent in a stablecoin.
   */
  gasPaidBy: "hub" | "relayer" | "facilitator" | "gateway" | "buyer";
  /** One plain sentence on when money counts as settled, e.g. "One Arc block after release." */
  finality: string;
  /** Explorer URL template with {tx}, e.g. "https://testnet.arcscan.app/tx/{tx}". */
  explorerTx: string;
  /** How long the seller waits to be credited, in seconds. Absent when the rail does not say. */
  finalitySeconds?: number;
  /** What the rail costs on top of the price: a toll in basis points and a fixed atomic amount. */
  cost?: { tollBps: number; fixed: string };
}

export interface ChallengeContext {
  /** Absolute URL of the paid resource, echoed in the 402 body. */
  resource: string;
  /** Unix seconds. */
  now: number;
}

/** Closing a funded job on an escrow rail. Each call returns the tx that did it. */
export interface EscrowOps {
  release(jobId: Hex, slipHash: Hex, sellerSig: Hex): Promise<SettleResult>;
  /** Permissionless once the deadline has passed. */
  refund(jobId: Hex): Promise<SettleResult>;
  /** The seller hands the money back before the deadline. */
  cancel(jobId: Hex, sellerSig: Hex): Promise<SettleResult>;
  status(jobId: Hex): Promise<"none" | "funded" | "released" | "refunded">;
}

export interface Rail {
  readonly declaration: RailDeclaration;
  challenge(offer: Offer, ctx: ChallengeContext): PaymentRequirements;
  verify(payment: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResult>;
  settle(payment: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResult>;
  /** Present exactly when declaration.kind is "escrow". */
  readonly escrow?: EscrowOps;
}

/** Fill an explorer template. */
export function explorerUrl(decl: RailDeclaration, tx: string): string {
  return decl.explorerTx.replace("{tx}", encodeURIComponent(tx));
}
