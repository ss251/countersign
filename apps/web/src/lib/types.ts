/**
 * What the screens read. These mirror the protocol objects in docs/spec and are
 * filled from the hub, or from src/fixtures until a hub endpoint exists.
 * Amounts are atomic digit strings, as on the wire (docs/decisions.md D4).
 */

export type Hex = `0x${string}`;

export type RailId = "arc" | "arc-gateway" | "whitechain" | "hedera" | "erc8183";

export type Adapter = "skill" | "mcp" | "openapi";

export interface Asset {
  symbol: string;
  decimals: number;
}

export interface Money {
  /** Atomic units, base-10 digits. */
  amount: string;
  asset: Asset;
}

export interface Seller {
  name: string;
  address: Hex;
  /** ERC-8004 agent id, when the seller has one. */
  agentId?: string;
}

export interface Upstream {
  label: string;
  url: string;
  licence: string;
}

export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema & { description?: string }>;
  required?: string[];
  [key: string]: unknown;
}

export interface Offer {
  id: string;
  /** The hash the buyer countersigns. */
  hash: Hex;
  name: string;
  summary: string;
  adapter: Adapter;
  upstream: Upstream;
  seller: Seller;
  price: Money;
  bond: Money;
  deadlineSeconds: number;
  rails: RailId[];
  tollBps: number;
  input: JsonSchema;
  output: JsonSchema;
  /** Derived from slips, never self-reported. */
  rating?: { released: number; refunded: number };
  status: "listed" | "delisted";
  publishedAt: string;
}

/** Where the buyer's agent found the offer. */
export type DiscoverySource = "circle" | "registry";

export interface Approval {
  id: string;
  agent: string;
  offer: Offer;
  /** The amount the agent proposes to countersign. */
  amount: Money;
  rail: RailId;
  discoveredVia: DiscoverySource;
  requestedAt: string;
}

export type JobStatus = "countersigned" | "held" | "released" | "refunded" | "refused";

export interface Purchase {
  id: string;
  offerId: string;
  offerName: string;
  adapter: Adapter;
  seller: Seller;
  amount: Money;
  status: JobStatus;
  rail: RailId;
  at: string;
  /** Set once a slip exists. */
  slipId?: string;
  /** Who approved it: the envelope on its own, or the human with a hold. */
  approvedBy: "envelope" | "you";
  /** Plain reason for a refusal or a refund. */
  reason?: string;
}

export interface Envelope {
  agent: string;
  period: "day";
  cap: Money;
  spent: Money;
  perMerchant: Money;
  /** Calls above this amount wait for the human. */
  askAbove: Money;
  allowlist: Array<Pick<Seller, "name" | "address">>;
  revoked: boolean;
  /** Gateway deposit that nanopayments draw from, when the gateway rail is in use. */
  gatewayBalance?: Money;
}

export interface RailProof {
  id: RailId;
  network: string;
  chainId: string;
  /** Transaction hash or Hedera transaction id. */
  tx: string;
  explorer: string;
}

export interface Slip {
  id: string;
  hash: Hex;
  jobId: Hex;
  offerHash: Hex;
  offerId: string;
  offerName: string;
  adapter: Adapter;
  buyer: Hex;
  seller: Seller;
  amount: Money;
  toll: Money;
  rail: RailProof;
  /** Hash of the delivered output, checked against the output schema. */
  outputHash: Hex;
  countersignature: Hex;
  sellerSignature: Hex;
  fundedAt: string;
  releasedAt: string;
  deadline: string;
  /** Receipt tree this slip belongs to, if the call bought from others. */
  tree?: { root: Hex; parent?: string };
}

export interface TreeNode {
  slipId: string;
  hash: Hex;
  offerName: string;
  seller: string;
  amount: Money;
  rail: RailId;
  children: TreeNode[];
}
