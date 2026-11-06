import { offerHash, type Offer, type RailId, type Slip, type SlipBody } from "@countersign/core";
import type { RailDeclaration } from "@countersign/rail";
import type { Address, Approval, EnvelopeView, Hex, Listing, Purchase, SlipView, TreeView } from "../lib/types.ts";

/**
 * Stand-in data until the hub endpoints land. Every screen that shows these says
 * "Fixture data". Hashes, addresses and signatures here are generated, not real.
 */

/** Deterministic hex from a label, so fixtures are stable across reloads. */
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

const addr = (label: string) => fakeHex(`addr:${label}`, 20) as Address;
const now = () => Math.floor(Date.now() / 1000);
const ago = (minutes: number) => now() - Math.round(minutes * 60);

/* Rails */

const ARC = "eip155:5042002" as const;
const WHITECHAIN = "eip155:1874" as const;

export const rails: Record<RailId, RailDeclaration> = {
  escrow: {
    id: "escrow",
    network: ARC,
    scheme: "countersign",
    asset: { network: ARC, address: "0x3600000000000000000000000000000000000000", symbol: "USDC", decimals: 6 },
    kind: "escrow",
    escrow: addr("escrow-arc"),
    gasPaidBy: "hub",
    finality: "Final one Arc block after release.",
    explorerTx: "https://testnet.arcscan.app/tx/{tx}",
  },
  eip3009: {
    id: "eip3009",
    network: ARC,
    scheme: "exact",
    asset: { network: ARC, address: "0x3600000000000000000000000000000000000000", symbol: "USDC", decimals: 6 },
    kind: "direct",
    gasPaidBy: "hub",
    finality: "Final one Arc block after the transfer.",
    explorerTx: "https://testnet.arcscan.app/tx/{tx}",
  },
  gateway: {
    id: "gateway",
    network: ARC,
    scheme: "exact",
    asset: { network: ARC, address: "0x3600000000000000000000000000000000000000", symbol: "USDC", decimals: 6 },
    kind: "batched",
    gasPaidBy: "gateway",
    finality: "The buyer is debited at once. The seller is credited in Gateway's next batch.",
    explorerTx: "https://testnet.arcscan.app/tx/{tx}",
  },
  erc8183: {
    id: "erc8183",
    network: ARC,
    scheme: "countersign",
    asset: { network: ARC, address: "0x3600000000000000000000000000000000000000", symbol: "USDC", decimals: 6 },
    kind: "escrow",
    escrow: addr("escrow-8183"),
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
    escrow: addr("escrow-wc"),
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
    finality: "Final when the facilitator's transfer reaches consensus, about three seconds.",
    explorerTx: "https://hashscan.io/testnet/transaction/{tx}",
  },
};

/* Offers: the catalogue */

const SKILLS = "https://github.com/circlefin/skills";
const SKILL_IO = {
  input: {
    type: "object",
    required: ["task"],
    properties: { task: { type: "string", description: "What the agent is trying to do" } },
  },
  output: {
    type: "object",
    required: ["guidance"],
    properties: { guidance: { type: "string", description: "Guidance text from SKILL.md" } },
  },
};

interface Draft {
  title: string;
  summary: string;
  seller: string;
  price: string;
  adapter?: Offer["adapter"];
  upstream: { url: string; licence: string };
  rails: RailId[];
  deadline?: number;
  stats?: Listing["stats"];
}

function listing(d: Draft): Listing {
  const offer: Offer = {
    v: 1,
    seller: addr(d.seller),
    title: d.title,
    summary: d.summary,
    adapter: d.adapter ?? "skill",
    upstream: d.upstream,
    ...SKILL_IO,
    price: d.price,
    deadline: d.deadline ?? 60,
    bond: "1000000",
    rails: d.rails,
    issuedAt: ago(300),
  };
  return {
    hash: offerHash(offer),
    offer,
    seller: { name: d.seller },
    stats: d.stats ?? { calls: 0, released: 0, refunded: 0 },
    status: "listed",
  };
}

export const listings: Listing[] = [
  listing({
    title: "use-arc",
    summary: "Build on Arc: chain facts, USDC as gas, deploy and verify.",
    seller: "circle-skills",
    price: "50000",
    upstream: { url: SKILLS, licence: "Apache-2.0" },
    rails: ["escrow", "gateway"],
    stats: { calls: 42, released: 41, refunded: 1 },
  }),
  listing({
    title: "use-usdc",
    summary: "Move USDC correctly: transfers, approvals, authorisations.",
    seller: "circle-skills",
    price: "50000",
    upstream: { url: SKILLS, licence: "Apache-2.0" },
    rails: ["escrow", "gateway"],
    stats: { calls: 18, released: 18, refunded: 0 },
  }),
  listing({
    title: "use-gateway",
    summary: "Circle Gateway: deposit once, spend on any chain.",
    seller: "circle-skills",
    price: "40000",
    upstream: { url: SKILLS, licence: "Apache-2.0" },
    rails: ["gateway", "escrow"],
    stats: { calls: 10, released: 9, refunded: 1 },
  }),
  listing({
    title: "use-smart-contract-platform",
    summary: "Deploy and call contracts through Circle's platform.",
    seller: "circle-skills",
    price: "60000",
    upstream: { url: SKILLS, licence: "Apache-2.0" },
    rails: ["escrow"],
  }),
  listing({
    title: "bridge-stablecoin",
    summary: "Bridge USDC between chains with CCTP.",
    seller: "circle-skills",
    price: "50000",
    upstream: { url: SKILLS, licence: "Apache-2.0" },
    rails: ["escrow"],
  }),
  listing({
    title: "whitechain-dev",
    summary: "Build on Whitechain: network facts, tokens, deploy and verify.",
    seller: "whitechain-skills",
    price: "50000",
    upstream: { url: "https://github.com/whitechain-labs/skills", licence: "None published; reproduced verbatim, see NOTICE" },
    rails: ["whitechain"],
    stats: { calls: 6, released: 6, refunded: 0 },
  }),
  listing({
    title: "hedera-agent-kit",
    summary: "Hedera tools over MCP, returning unsigned transaction bytes.",
    seller: "hedera-tools",
    price: "10000",
    adapter: "mcp",
    upstream: { url: "https://www.npmjs.com/package/@hashgraph/hedera-agent-kit-mcp", licence: "Apache-2.0" },
    rails: ["hedera"],
    deadline: 30,
    stats: { calls: 12, released: 12, refunded: 0 },
  }),
  listing({
    title: "circle-codegen",
    summary: "Circle's codegen MCP server, metered per call.",
    seller: "codegen-proxy",
    price: "20000",
    adapter: "mcp",
    upstream: { url: "https://api.circle.com/v1/codegen/mcp", licence: "n/a" },
    rails: ["gateway"],
    deadline: 45,
    stats: { calls: 7, released: 7, refunded: 0 },
  }),
  listing({
    title: "merchant-invoice",
    summary: "Issue an invoice and refund it in one call.",
    seller: "merchant-desk",
    price: "100000",
    adapter: "openapi",
    upstream: { url: "https://opensource.org/license/mit", licence: "MIT" },
    rails: ["whitechain", "escrow"],
  }),
];

export const listingByHash = (hash: string) => listings.find((l) => l.hash === hash);
export const listingByTitle = (title: string) => listings.find((l) => l.offer.title === title);

const L = (title: string) => listingByTitle(title)!;

/* The buyer */

const AGENT = "research-agent";
const BUYER = addr("buyer-agent");

export const names: Record<string, string> = Object.fromEntries(
  listings.map((l) => [l.offer.seller.toLowerCase(), l.seller.name]),
);

export const envelope: EnvelopeView = {
  envelope: {
    v: 1,
    agent: BUYER,
    cap: "5000000",
    perMerchant: "1000000",
    allowlist: [L("use-arc").offer.seller, L("hedera-agent-kit").offer.seller, L("whitechain-dev").offer.seller].map((a) =>
      a.toLowerCase(),
    ),
    revoked: false,
  },
  spent: {
    total: "420000",
    bySeller: { [L("use-arc").offer.seller.toLowerCase()]: "150000" },
  },
  agentName: AGENT,
  askAbove: "40000",
  names,
  gatewayBalance: "4580000",
};

export const approvals: Approval[] = [
  {
    id: "ap-1",
    agentName: AGENT,
    listing: L("use-arc"),
    amount: "50000",
    rail: "escrow",
    discoveredVia: "circle",
    requestedAt: ago(1),
  },
];

function purchase(
  n: number,
  title: string,
  status: Purchase["status"],
  minutes: number,
  extra: Partial<Purchase> = {},
): Purchase {
  const l = L(title);
  return {
    jobId: fakeHex(`job:${n}`),
    offerHash: l.hash,
    title,
    adapter: l.offer.adapter,
    seller: { name: l.seller.name, address: l.offer.seller },
    amount: l.offer.price,
    rail: l.offer.rails[0]!,
    status,
    at: ago(minutes),
    slipHash: status === "released" ? fakeHex(`slip:${n}`) : undefined,
    approvedBy: "envelope",
    ...extra,
  };
}

export const purchases: Purchase[] = [
  purchase(8, "use-arc", "refused", 3, { approvedBy: "you", reason: "Refused. The price moved after you signed." }),
  purchase(7, "hedera-agent-kit", "released", 9),
  purchase(6, "circle-codegen", "released", 14),
  purchase(5, "use-gateway", "refunded", 26, { rail: "escrow", reason: "Refunded. The deadline passed." }),
  purchase(4, "use-usdc", "released", 41, { approvedBy: "you" }),
  purchase(3, "whitechain-dev", "released", 70),
  purchase(2, "use-arc", "released", 60 * 26),
  purchase(1, "use-usdc", "released", 60 * 27),
];

/* Slips */

function slipOf(p: Purchase, children: Hex[] = []): SlipView {
  const l = listingByHash(p.offerHash)!;
  const decl = rails[p.rail];
  const escrowRail = decl.kind === "escrow";
  const chainId = decl.network.startsWith("eip155:") ? Number(decl.network.slice(7)) : undefined;
  const body: SlipBody = {
    v: 1,
    rail: p.rail,
    network: decl.network,
    offerHash: p.offerHash,
    jobId: p.jobId,
    buyer: p.rail === "hedera" ? "0.0.11337064" : BUYER,
    seller: l.offer.seller,
    payTo: p.rail === "hedera" ? "0.0.11337065" : l.offer.seller,
    asset: decl.asset.address,
    amount: p.amount,
    inputHash: fakeHex(`in:${p.jobId}`),
    outputHash: fakeHex(`out:${p.jobId}`),
    deliveredAt: p.at - 2,
    children,
    ...(escrowRail && chainId ? { escrow: decl.escrow as Address, chainId } : {}),
  };
  const tx = p.rail === "hedera" ? "0.0.9185802@1793957141.182486461" : fakeHex(`tx:${p.jobId}`);
  const slip: Slip = {
    body,
    hash: p.slipHash!,
    sellerSig: fakeHex(`sig:${p.jobId}`, 65),
    payment: {
      x402Version: 2,
      accepted: {
        scheme: decl.scheme,
        network: decl.network,
        amount: p.amount,
        asset: decl.asset.address,
        payTo: body.payTo,
        maxTimeoutSeconds: l.offer.deadline,
      },
      payload: { signature: fakeHex(`cs:${p.jobId}`, 65) },
    },
    settlement: { transaction: tx, network: decl.network, url: decl.explorerTx.replace("{tx}", tx) },
  };
  return { slip, title: p.title, sellerName: p.seller.name, declaration: decl };
}

const released = purchases.filter((p) => p.status === "released");

const childA = { ...purchase(61, "use-arc", "released", 14), amount: "5000", rail: "gateway" as const };
const childB = { ...purchase(62, "use-usdc", "released", 14), amount: "5000", rail: "gateway" as const };
const childSlips = [slipOf(childA), slipOf(childB)];

export const slips: SlipView[] = released.map((p) =>
  p.title === "circle-codegen" ? slipOf(p, childSlips.map((c) => c.slip.hash)) : slipOf(p),
);

export const slipByHash = (hash: string) => [...slips, ...childSlips].find((s) => s.slip.hash === hash);

const treeRoot = slips.find((s) => s.title === "circle-codegen")!;

export const tree: TreeView = {
  root: treeRoot.slip.hash,
  nodes: Object.fromEntries(
    [treeRoot, ...childSlips].map((s) => [s.slip.hash, { slip: s.slip, title: s.title, sellerName: s.sellerName }]),
  ),
};
