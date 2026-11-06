import type { RailId } from "@countersign/core";
import type { RailDeclaration } from "@countersign/rail";
import type { Approval, EnvelopeView, Hex, Listing, Purchase, SlipView } from "../lib/types.ts";
import catalogue from "./catalogue.json";

/**
 * Stand-in data until the hub endpoints land; every screen that shows it says "Fixture data".
 * catalogue.json is generated offline: offer hashes are real canonical hashes and every slip
 * is signed, by throwaway keys that were never stored, so the verifier passes on them.
 * Addresses, transaction hashes and times in it are not on any chain.
 */

/** Deterministic hex from a label, for stand-in transaction hashes. */
export function fakeHex(label: string, bytes = 32): Hex {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  let out = "";
  let x = h || 1;
  while (out.length < bytes * 2) {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    out += x.toString(16).padStart(8, "0");
  }
  return `0x${out.slice(0, bytes * 2)}`;
}

const ARC = "eip155:5042002" as const;
const WHITECHAIN = "eip155:1874" as const;
const ARC_USDC = { network: ARC, address: "0x3600000000000000000000000000000000000000", symbol: "USDC", decimals: 6 };

export const rails: Record<RailId, RailDeclaration> = {
  escrow: {
    id: "escrow",
    network: ARC,
    scheme: "countersign",
    asset: ARC_USDC,
    kind: "escrow",
    escrow: "0x7a3b6c1d9e8f0a2b4c6d8e0f1a3b5c7d9e1f2a4b",
    gasPaidBy: "hub",
    finality: "Final one Arc block after release.",
    explorerTx: "https://testnet.arcscan.app/tx/{tx}",
  },
  eip3009: {
    id: "eip3009",
    network: ARC,
    scheme: "exact",
    asset: ARC_USDC,
    kind: "direct",
    gasPaidBy: "hub",
    finality: "Final one Arc block after the transfer.",
    explorerTx: "https://testnet.arcscan.app/tx/{tx}",
  },
  gateway: {
    id: "gateway",
    network: ARC,
    scheme: "exact",
    asset: ARC_USDC,
    kind: "batched",
    gasPaidBy: "gateway",
    finality: "The buyer is debited at once. The seller is credited in Gateway's next batch.",
    explorerTx: "https://testnet.arcscan.app/tx/{tx}",
  },
  erc8183: {
    id: "erc8183",
    network: ARC,
    scheme: "countersign",
    asset: ARC_USDC,
    kind: "escrow",
    escrow: "0x5e7f9a1b3c5d7e9f1a3b5c7d9e1f3a5b7c9d1e3f",
    gasPaidBy: "hub",
    finality: "Final one Arc block after the hook commits the slip.",
    explorerTx: "https://testnet.arcscan.app/tx/{tx}",
  },
  whitechain: {
    id: "whitechain",
    network: WHITECHAIN,
    scheme: "countersign",
    asset: { network: WHITECHAIN, address: "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7", symbol: "USDT", decimals: 6 },
    kind: "escrow",
    escrow: "0x2c4e6a8b0d1f3a5c7e9b1d3f5a7c9e1b3d5f7a9c",
    gasPaidBy: "relayer",
    finality: "Final one Whitechain block after release.",
    explorerTx: "https://explorer.testnet.whitechain.io/tx/{tx}",
  },
  hedera: {
    id: "hedera",
    network: "hedera:testnet",
    scheme: "exact",
    asset: { network: "hedera:testnet", address: "0.0.429274", symbol: "USDC", decimals: 6 },
    kind: "direct",
    gasPaidBy: "facilitator",
    finality: "Final at consensus, about three seconds after the facilitator submits it.",
    explorerTx: "https://hashscan.io/testnet/transaction/{tx}",
  },
  "hedera-scheduled": {
    id: "hedera-scheduled",
    network: "hedera:testnet",
    scheme: "countersign",
    asset: { network: "hedera:testnet", address: "0.0.429274", symbol: "USDC", decimals: 6 },
    kind: "escrow",
    gasPaidBy: "buyer",
    finality: "Hedera consensus when the seller's countersignature lands",
    explorerTx: "https://hashscan.io/testnet/transaction/{tx}",
    finalitySeconds: 5,
    cost: { tollBps: 0, fixed: "0" },
  },
  mpp: {
    id: "mpp",
    network: "mpp:stripe",
    scheme: "exact",
    asset: { network: "mpp:stripe", address: "usd", symbol: "USD", decimals: 2 },
    kind: "direct",
    gasPaidBy: "facilitator",
    finality: "Final when Stripe confirms the payment; the slip carries the MPP receipt id.",
    explorerTx: "https://dashboard.stripe.com/test/payments/{tx}",
  },
};

export const listings = catalogue.listings as unknown as Listing[];
export const listingByHash = (hash: string) => listings.find((l) => l.hash === hash);
export const listingByTitle = (title: string) => listings.find((l) => l.offer.title === title);

export const envelope = catalogue.envelope as unknown as EnvelopeView;

export const approvals: Approval[] = catalogue.approvals.map((a) => ({
  id: a.id,
  agentName: a.agentName,
  listing: listingByHash(a.listingHash)!,
  amount: a.amount,
  rail: a.rail as RailId,
  discoveredVia: a.discoveredVia as Approval["discoveredVia"],
  requestedAt: a.requestedAt,
}));

export const purchases = catalogue.purchases as unknown as Purchase[];

export const slips: SlipView[] = (catalogue.slips as unknown as Array<Omit<SlipView, "declaration">>).map((s) => ({
  ...s,
  declaration: rails[s.slip.body.rail],
}));

export const slipByHash = (hash: string) => slips.find((s) => s.slip.hash === hash);

/** The slip a fixture release in the buyer flow points to: a signed use-arc on the escrow rail. */
export const demoSlipHash = slips.find((s) => s.title === "use-usdc" && s.slip.body.rail === "escrow")?.slip.hash;
