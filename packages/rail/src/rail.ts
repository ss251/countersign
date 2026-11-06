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
import type { Address, Hex } from "viem";

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

/** The review a v2 escrow opens when a delivery is committed. Times are unix seconds. */
export interface ReviewState {
  window: number;
  deliveredAt: number;
  endsAt: number;
}

/** Every status an escrow can report. v2 adds delivered (5) and disputed (6). */
export type EscrowStatus =
  | "none"
  | "funded"
  | "released"
  | "refunded"
  | "failed"
  | "delivered"
  | "disputed";

/** Closing a funded job on an escrow rail. Each call returns the tx that did it. */
export interface EscrowOps {
  /**
   * `countersign` is the seller's signed release, for rails whose release is a seller signature
   * the hub submits; the Arc escrow ignores it.
   */
  release(jobId: Hex, slipHash: Hex, sellerSig: Hex, countersign?: string): Promise<SettleResult>;
  /** Permissionless once the deadline has passed. */
  refund(jobId: Hex): Promise<SettleResult>;
  /** The seller hands the money back before the deadline. */
  cancel(jobId: Hex, sellerSig: Hex): Promise<SettleResult>;
  /** The arbiter's verdict that delivery failed; the buyer is paid the amount plus the bond. */
  failDelivery?(jobId: Hex): Promise<SettleResult>;
  /** The payee's free (unlocked) bond, in atomic units. */
  bondOfPayee?(payee: Hex): Promise<string>;
  /** Escrow v2: the buyer accepts a delivered job, paying the seller before the window ends. */
  accept?(jobId: Hex, buyerSig: Hex): Promise<SettleResult>;
  /** Escrow v2: the buyer disputes a funded or delivered job, refunding itself at once. */
  dispute?(jobId: Hex, status: number, buyerSig: Hex): Promise<SettleResult>;
  /** Escrow v2: anyone releases a delivered job after its review window. */
  releaseAfterWindow?(jobId: Hex): Promise<SettleResult>;
  /** Escrow v2: the delivery's review window, when it was recorded. */
  reviewOf?(jobId: Hex): Promise<ReviewState>;
  /** Escrow v2: pays the accrued toll to the treasury. */
  sweepToll?(): Promise<SettleResult>;
  /** Seconds after the deadline in which release and failDelivery may land. 0 on v1, 600 on v2. */
  disputeWindowSeconds?: number;
  status(jobId: Hex): Promise<EscrowStatus>;
  /** The contract's toll in basis points. Reads the view once per rail instance, then caches it. */
  tollBps?(): Promise<number>;
}

export interface Rail {
  readonly declaration: RailDeclaration;
  /** The address that submits fund for this rail. A payee's Lock names it. */
  readonly funder?: Address;
  challenge(offer: Offer, ctx: ChallengeContext): PaymentRequirements;
  verify(payment: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResult>;
  /** `lockSig` is the payee's Lock(jobId, funder) signature; only the escrow v2 rail uses it. */
  settle(payment: PaymentPayload, requirements: PaymentRequirements, opts?: { lockSig?: Hex }): Promise<SettleResult>;
  /** True when the hub must verify, deliver, check the delivery, and only then settle. */
  readonly settlesAfterDelivery?: boolean;
  /**
   * For a rail that settles after delivery: the settlement id this payment will get and the last
   * unix second at which it can still settle, read from the payment without submitting anything.
   * null when this payment cannot wait (the hub then settles before dispatch, as today).
   */
  pending?(payment: PaymentPayload): { transaction: string; validUntil: number } | null;
  /** Present exactly when declaration.kind is "escrow". */
  readonly escrow?: EscrowOps;
}

/** Fill an explorer template. */
export function explorerUrl(decl: RailDeclaration, tx: string): string {
  return decl.explorerTx.replace("{tx}", encodeURIComponent(tx));
}
