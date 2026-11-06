/**
 * The protocol objects. Every lane builds against these shapes.
 *
 * Wire rules: amounts are atomic digit strings (see amount.ts); hashes are 0x-prefixed
 * lowercase hex; times are unix seconds as integers; networks are CAIP-2 ids.
 */

import type { Address, Hex } from "viem";

// ---------------------------------------------------------------------------
// Networks, assets, rails

/** CAIP-2 network id: "eip155:5042002" (Arc testnet), "eip155:1874" (Whitechain Sepolia), "hedera:testnet". */
/** MPP is not a chain: "mpp:stripe" is a card through a shared payment token, "mpp:tempo" its stablecoin method. */
export type Network = `eip155:${number}` | "hedera:testnet" | "hedera:mainnet" | "mpp:stripe" | "mpp:tempo";

/**
 * A settlement path. The id matches its directory in packages/rail/src.
 * - escrow:     CountersignedEscrow on Arc, USDC, the buyer's EIP-3009 authorisation names the escrow
 * - eip3009:    direct USDC transfer on Arc, no escrow
 * - gateway:    Circle Gateway nanopayment on Arc, credited to the seller in a batch
 * - erc8183:    ERC-8183 job escrow with the JobHook committing the slip
 * - whitechain: CountersignedEscrow on Whitechain Sepolia, USDT, gas paid by our relayer
 * - hedera:     HTS USDC on Hedera testnet through an x402 facilitator, every spend on an HCS topic
 * - mpp:        Stripe Machine Payments Protocol, the fourth rail; the slip carries the MPP receipt id
 */
export type RailId = "escrow" | "eip3009" | "gateway" | "erc8183" | "whitechain" | "hedera" | "mpp";

export const RAIL_IDS: readonly RailId[] = ["escrow", "eip3009", "gateway", "erc8183", "whitechain", "hedera", "mpp"];

export interface Asset {
  network: Network;
  /** EVM token address, or a Hedera token id such as "0.0.429274". */
  address: string;
  symbol: string;
  decimals: number;
}

// ---------------------------------------------------------------------------
// Offer

/** A JSON Schema document (draft 2020-12 subset). Kept opaque here; validation lives in the runner and buyer. */
export type JsonSchema = { [key: string]: unknown };

export type AdapterKind = "skill" | "mcp" | "openapi";

/**
 * What a seller publishes. offerHash = canonicalHash(offer). Any change, including the
 * price, is a new offer with a new hash, which is how a moved price is caught.
 */
export interface Offer {
  v: 1;
  /** The seller's identity key. It signs every slip and is the payee on EVM rails unless payTo says otherwise. */
  seller: Address;
  title: string;
  summary: string;
  adapter: AdapterKind;
  /** For catalogue items: where the artifact comes from, and its licence. */
  upstream?: { url: string; licence: string };
  input: JsonSchema;
  output: JsonSchema;
  /** Atomic units of a 6-decimal USD stablecoin (USDC or USDT). */
  price: string;
  /** Seconds the seller has to deliver once the escrow is funded. */
  deadline: number;
  /** Atomic amount the seller declares as bond. Declared only; no contract collects it yet. */
  bond: string;
  /** Accepted rails, most preferred first. */
  rails: RailId[];
  /** Payee per rail where it is not `seller`, e.g. a Hedera account id "0.0.1234". */
  payTo?: Partial<Record<RailId, string>>;
  issuedAt: number;
}

// ---------------------------------------------------------------------------
// x402 v2 wire shapes (https://github.com/coinbase/x402, version 2)

export type Scheme = "exact" | "countersign";

export interface PaymentRequirements {
  scheme: Scheme;
  network: Network;
  /** Atomic amount in `asset`. */
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  /** Scheme-specific. For "countersign" see CountersignExtra; for EVM "exact" the token's EIP-712 name/version. */
  extra?: Record<string, unknown>;
}

export interface PaymentRequired {
  x402Version: 2;
  error?: string;
  resource: { url: string; description?: string; mimeType?: string };
  accepts: PaymentRequirements[];
  /** x402 v2 extensions, e.g. `bazaar` discovery metadata. */
  extensions?: Record<string, unknown>;
}

export interface PaymentPayload {
  x402Version: 2;
  accepted: PaymentRequirements;
  /** Scheme-specific. For "countersign" see CountersignPayload. */
  payload: Record<string, unknown>;
  resource?: { url: string };
}

export interface VerifyResult {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
}

export interface SettleResult {
  success: boolean;
  errorReason?: string;
  payer?: string;
  /** EVM tx hash, a Hedera transaction id such as "0.0.1234@1730880000.123456789", or a Stripe payment reference. */
  transaction: string;
  network: Network;
  /** A receipt id the rail returns besides the transaction, e.g. the MPP Payment-Receipt id. */
  receipt?: string;
}

// ---------------------------------------------------------------------------
// Countersignature (scheme "countersign")

/** The terms the buyer agrees to. jobId = EIP-712 hash of these under the escrow's domain. */
export interface CountersignTerms {
  offerHash: Hex;
  buyer: Address;
  payee: Address;
  amount: string;
  /** Unix seconds; release must happen before it, refund only after it. */
  deadline: number;
  /** Buyer-chosen uniqueness, decimal string of a uint256. */
  salt: string;
}

/**
 * The buyer's one signature: an EIP-3009 ReceiveWithAuthorization naming the escrow as `to`,
 * whose nonce is the jobId. Signing it binds offer hash, payee, amount, deadline, chain and escrow.
 */
export interface CountersignPayload {
  terms: CountersignTerms;
  authorization: {
    from: Address;
    to: Address;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: Hex;
  };
  signature: Hex;
}

/** `extra` of a "countersign" PaymentRequirements entry. */
export interface CountersignExtra {
  rail: RailId;
  escrow: Address;
  chainId: number;
  offerHash: Hex;
  /** Seconds from funding to the delivery deadline. */
  deadlineSeconds: number;
  /** The token's EIP-712 domain, needed to sign the authorisation. */
  tokenName: string;
  tokenVersion: string;
}

// ---------------------------------------------------------------------------
// Slip

/** The hashed part of a slip. slipHash = canonicalHash(body). */
export interface SlipBody {
  v: 1;
  rail: RailId;
  network: Network;
  offerHash: Hex;
  /** Escrow job id, or the payment nonce on rails without an escrow. */
  jobId: Hex;
  buyer: string;
  seller: Address;
  payTo: string;
  asset: string;
  amount: string;
  /** canonicalHash of the input the buyer sent and of the output the seller returned. */
  inputHash: Hex;
  outputHash: Hex;
  deliveredAt: number;
  /** Slip hashes of purchases the seller made while serving this call. The root commits its children. */
  children: Hex[];
  /** EIP-712 domain of the seller signature: present on escrow rails, where the contract checks it. */
  escrow?: Address;
  chainId?: number;
}

export interface Slip {
  body: SlipBody;
  hash: Hex;
  /** Seller's EIP-712 signature over Release(jobId, slipHash). */
  sellerSig: Hex;
  /** The buyer's payment exactly as it was sent. */
  payment: PaymentPayload;
  /** Where the money finished: release tx hash, transfer tx hash, Hedera tx id or Stripe payment reference. */
  settlement: { transaction: string; network: Network; url?: string; receipt?: string };
}

// ---------------------------------------------------------------------------
// Envelope

/** The human's limits on what the agent may spend. Amounts are atomic 6-decimal USD stablecoin. */
export interface Envelope {
  v: 1;
  /** The agent key allowed to countersign under this envelope. */
  agent: Address;
  /** Total budget. */
  cap: string;
  /** Default limit per seller. */
  perMerchant: string;
  /** Overrides per seller address (lowercase). */
  merchantLimits?: Record<string, string>;
  /** Seller addresses (lowercase) or offer hashes that may be paid. Empty means any. */
  allowlist: string[];
  revoked: boolean;
  /** Unix seconds after which nothing may be approved. */
  expiresAt?: number;
  /** Atomic amount above which the agent holds the call for the human's countersignature. Absent: never holds. */
  askAbove?: string;
}

/** What has been spent so far under an envelope. */
export interface EnvelopeSpend {
  total: string;
  /** By seller address (lowercase). */
  bySeller: Record<string, string>;
}

export type EnvelopeRefusal = "revoked" | "expired" | "not-allowlisted" | "over-cap" | "over-merchant-limit";

export type EnvelopeDecision = { ok: true } | { ok: false; reason: EnvelopeRefusal; message: string };
