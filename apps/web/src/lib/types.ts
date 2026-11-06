/**
 * The protocol objects come from @countersign/core unchanged. The types below are
 * the hub's views over them: a listing is an offer plus what the registry knows,
 * a purchase is a job as the buyer's phone lists it.
 */

import type { AdapterKind, Envelope, EnvelopeSpend, Offer, RailId, Slip } from "@countersign/core";
import type { RailDeclaration } from "@countersign/rail";

export type {
  AdapterKind,
  Envelope,
  EnvelopeSpend,
  JsonSchema,
  Network,
  Offer,
  PaymentPayload,
  RailId,
  Slip,
  SlipBody,
  CountersignPayload,
} from "@countersign/core";
export type { RailDeclaration } from "@countersign/rail";

export type Hex = `0x${string}`;
export type Address = `0x${string}`;

/** Display form of an amount: atomic digits plus what they count. */
export interface Money {
  amount: string;
  asset: { symbol: string; decimals: number };
}

/** An offer as the registry lists it. */
export interface Listing {
  hash: Hex;
  offer: Offer;
  seller: { name: string; agentId?: string };
  /** Derived from slips, never self-reported. Absent until the hub reports it. */
  stats?: { calls: number; released: number; refunded: number };
  status: "listed" | "delisted";
  /** Whether the seller's runner is connected to the hub right now. */
  online?: boolean;
  /** Why the canary delisted it. */
  reason?: string;
}

export type DiscoverySource = "circle" | "registry";

/** A call above the envelope's ask threshold, held for the human. */
export interface Approval {
  id: string;
  agentName: string;
  listing: Listing;
  /** Atomic amount the agent proposes to countersign. */
  amount: string;
  rail: RailId;
  discoveredVia: DiscoverySource;
  /** Unix seconds. */
  requestedAt: number;
}

export type JobStatus = "countersigned" | "held" | "delivered" | "released" | "refused" | "refunded";

export interface Purchase {
  jobId: Hex;
  offerHash: Hex;
  title: string;
  adapter: AdapterKind;
  seller: { name: string; address: Address };
  amount: string;
  rail: RailId;
  status: JobStatus;
  /** Unix seconds. */
  at: number;
  slipHash?: Hex;
  approvedBy: "envelope" | "you";
  /** The sentence a person reads for a refusal or a refund. */
  reason?: string;
}

/** The envelope, what has been spent under it, and the names the phone shows. */
export interface EnvelopeView {
  envelope: Envelope;
  spent: EnvelopeSpend;
  agentName: string;
  /** Atomic. Calls above it wait for the human's hold. */
  askAbove: string;
  /** Seller address (lowercase) to display name. */
  names: Record<string, string>;
  /** Circle Gateway deposit that nanopayments draw from. */
  gatewayBalance?: string;
}

/** A slip with the offer title the hub knows for it. */
export interface SlipView {
  slip: Slip;
  title: string;
  sellerName: string;
  declaration: RailDeclaration;
}

/** A receipt tree: the root slip and every slip it commits, by hash. */
export interface TreeView {
  root: Hex;
  nodes: Record<string, { slip: Slip; title: string; sellerName: string }>;
}

/** A seller as the hub's /sellers reports it: counts derived from its jobs and slips. */
export interface SellerRecord {
  address: string;
  name: string | null;
  payees: Partial<Record<RailId, string>>;
  offers: Array<{ offerHash: string; title: string; price: string; rails: RailId[]; online: boolean }>;
  calls: number;
  released: number;
  settled: number;
  refunded: number;
  failed: number;
  /** Atomic sum of released and settled amounts. */
  volume: string;
  erc8004: { agentId: string; identityRegistry: string; reputation: null | { count: number; score: number } } | null;
}

/** One ranked result from the hub's offer search, with the hub's own reasons. */
export interface SearchResult {
  offerHash: string;
  offer: Offer;
  online: boolean;
  score: number;
  why: string[];
}

/** A release or a refund, as the overview lists it. */
export interface Settlement {
  jobId: string;
  offerHash: string;
  title: string;
  seller: string;
  /** Atomic. */
  amount: string;
  rail: RailId;
  network: string;
  /** released: an escrow paid the seller; settled: a direct rail paid; refunded: the money went back. */
  kind: "released" | "settled" | "refunded";
  tx: string;
  /** Explorer link for tx, when the hub knows one. */
  explorer?: string | null;
  slipHash?: string | null;
  /** Unix seconds. */
  at: number;
}
