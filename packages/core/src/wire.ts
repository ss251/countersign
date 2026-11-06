/**
 * Wire formats between buyer, hub and runner.
 *
 * Buyer <-> hub is HTTP with x402 v2 headers:
 *   POST /offers/:offerHash/call  {input, lineage?}
 *     no payment            -> 402, body PaymentRequired, header PAYMENT-REQUIRED = base64(json)
 *     PAYMENT-SIGNATURE set -> 200 {output, slip}, header PAYMENT-RESPONSE = base64(json SettleResult)
 *
 * Hub <-> runner is one WebSocket the runner dials out to (the seller opens no port):
 *   hub: challenge -> runner: hello (signed) -> hub: ready
 *   hub: job -> runner: result | fail
 *   hub: ping -> runner: pong
 *   hub: canary -> runner: canary | canary-fail
 */

import type { Address, Hex } from "viem";
import type { Network, RailId, Slip, SlipBody } from "./types.ts";

export const PAYMENT_REQUIRED_HEADER = "PAYMENT-REQUIRED";
export const PAYMENT_SIGNATURE_HEADER = "PAYMENT-SIGNATURE";
export const PAYMENT_RESPONSE_HEADER = "PAYMENT-RESPONSE";
export const RUNNER_PATH = "/runner/connect";

/** base64 of the UTF-8 JSON. Uses btoa/atob so it runs in Bun and in browsers alike. */
export function toBase64Json(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function fromBase64Json<T = unknown>(header: string): T {
  const bin = atob(header);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

/** The text a runner signs with EIP-191 personal_sign to prove it holds the seller key. */
export function runnerAuthMessage(nonce: string): string {
  return `countersign runner ${nonce}`;
}

/** The text a seller signs with EIP-191 personal_sign to publish an offer. */
export function publishMessage(offerHash: Hex): string {
  return `countersign offer ${offerHash}`;
}

/** The text a seller signs with EIP-191 to delist an offer (D18). */
export function delistMessage(offerHash: Hex): string {
  return `countersign delist ${offerHash}`;
}

/** The text a runner signs with the seller's key to answer a canary (D18). */
export function canaryMessage(offerHash: Hex, nonce: string): string {
  return `countersign canary ${offerHash} ${nonce}`;
}

/** Everything a runner needs to serve one paid call and write its slip. */
export interface JobOrder {
  jobId: Hex;
  offerHash: Hex;
  input: unknown;
  rail: RailId;
  network: Network;
  buyer: string;
  payTo: string;
  asset: string;
  amount: string;
  /** Unix seconds by which the result must be released. */
  deadline: number;
  escrow?: Address;
  chainId?: number;
  /** A held payment: the buyer's schedule and the transaction that created it. */
  schedule?: { id: string; createTx: string };
  /** The purchases this call is nested inside, outermost first, as offer hashes or job ids. The hub refuses a cycle before payment (terms.md §2). */
  lineage: Hex[];
}

/**
 * The buyer's countersigned terms on a lock frame.
 * With the frame's offerHash, these are exactly the fields jobIdOf hashes.
 */
export interface LockTerms {
  buyer: Address;
  payee: Address;
  amount: string;
  deadline: number;
  salt: string;
  bond: string;
  reviewWindow: number;
}

export type HubToRunner =
  | { t: "challenge"; nonce: string }
  | { t: "ready"; seller: Address; offers: Hex[] }
  | { t: "job"; order: JobOrder }
  /** Ask the seller to accept a bonded job by signing its EIP-712 Lock(jobId, funder). */
  | {
      t: "lock";
      jobId: Hex;
      offerHash: Hex;
      escrow: Address;
      chainId: number;
      bond: string;
      funder: Address;
      terms: LockTerms;
    }
  | { t: "ping"; ts: number }
  | { t: "canary"; offerHash: Hex; nonce: string }
  | { t: "error"; message: string };

export type RunnerToHub =
  | { t: "hello"; seller: Address; offers: Hex[]; nonce: string; sig: Hex }
  /** `countersign` is the seller's signed ScheduleSign bytes (base64) on a held rail. */
  | {
      t: "result";
      jobId: Hex;
      output: unknown;
      slip: Pick<Slip, "body" | "hash" | "sellerSig">;
      countersign?: string;
    }
  | { t: "fail"; jobId: Hex; reason: string }
  /** The seller accepts a bonded job and locks its bond with this Lock(jobId, funder) signature. */
  | { t: "locked"; jobId: Hex; sig: Hex }
  /** The seller refuses to lock a bonded job, in a sentence a person can read. */
  | { t: "lock-refused"; jobId: Hex; reason: string }
  | { t: "canary"; offerHash: Hex; nonce: string; sig: Hex }
  | { t: "canary-fail"; offerHash: Hex; nonce: string; reason: string }
  | { t: "pong"; ts: number };

/** POST /offers body. */
export interface PublishRequest {
  offer: import("./types.ts").Offer;
  /** personal_sign of publishMessage(offerHash) by offer.seller. */
  sig: Hex;
}

/** POST /offers/:offerHash/call body. */
export interface CallRequest {
  input: unknown;
  lineage?: Hex[];
}

/** 200 body of a paid call. */
export interface CallResult {
  output: unknown;
  slip: Slip;
}

/** Every non-2xx body other than 402. `message` is the sentence a person reads. */
export interface ErrorBody {
  code: string;
  message: string;
}

/** The slip body a runner writes for an order. Pure, so hub and runner agree byte for byte. */
export function slipBodyFor(
  order: JobOrder,
  seller: Address,
  inputHash: Hex,
  outputHash: Hex,
  deliveredAt: number,
  children: Hex[] = [],
): SlipBody {
  const body: SlipBody = {
    v: 1,
    rail: order.rail,
    network: order.network,
    offerHash: order.offerHash,
    jobId: order.jobId,
    buyer: order.buyer,
    seller,
    payTo: order.payTo,
    asset: order.asset,
    amount: order.amount,
    inputHash,
    outputHash,
    deliveredAt,
    children,
  };
  if (order.escrow !== undefined) body.escrow = order.escrow;
  if (order.chainId !== undefined) body.chainId = order.chainId;
  return body;
}
