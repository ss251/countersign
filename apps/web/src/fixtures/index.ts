import type { Approval, Asset, Envelope, Hex, Money, Offer, Purchase, Slip, TreeNode } from "../lib/types.ts";

/**
 * Stand-in data until the hub endpoints land. Every screen says when it is
 * showing fixtures. Hashes and addresses here are generated, not real.
 */

export const USDC: Asset = { symbol: "USDC", decimals: 6 };
export const USDT: Asset = { symbol: "USDT", decimals: 6 };

export function usdc(decimal: string): Money {
  const [w = "0", f = ""] = decimal.split(".");
  return { amount: (BigInt(w) * 1_000_000n + BigInt(f.padEnd(6, "0") || "0")).toString(), asset: USDC };
}

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

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

const seller = (name: string) => ({ name, address: fakeHex(`seller:${name}`, 20) });

const CIRCLE_SKILLS = "https://github.com/circlefin/skills";

function skill(id: string, summary: string, price: string, extra: Partial<Offer> = {}): Offer {
  return {
    id,
    hash: fakeHex(`offer:${id}`),
    name: id,
    summary,
    adapter: "skill",
    upstream: { label: "circlefin/skills", url: CIRCLE_SKILLS, licence: "Apache-2.0" },
    seller: seller("circle-skills"),
    price: usdc(price),
    bond: usdc("1"),
    deadlineSeconds: 60,
    rails: ["arc", "arc-gateway"],
    tollBps: 100,
    input: {
      type: "object",
      required: ["task"],
      properties: { task: { type: "string", description: "What the agent is trying to do" } },
    },
    output: {
      type: "object",
      required: ["guidance"],
      properties: { guidance: { type: "string", description: "Markdown guidance from SKILL.md" } },
    },
    rating: { released: 0, refunded: 0 },
    status: "listed",
    publishedAt: minutesAgo(300),
    ...extra,
  };
}

export const offers: Offer[] = [
  skill("use-arc", "Build on Arc: chain facts, USDC as gas, deploy and verify.", "0.05", {
    rating: { released: 41, refunded: 1 },
  }),
  skill("use-usdc", "Move USDC correctly: transfers, approvals, authorisations.", "0.05", {
    rating: { released: 18, refunded: 0 },
  }),
  skill("use-gateway", "Circle Gateway: deposit once, spend on any chain.", "0.04", {
    rating: { released: 9, refunded: 0 },
  }),
  skill("use-smart-contract-platform", "Deploy and call contracts through Circle's platform.", "0.06"),
  skill("bridge-stablecoin", "Bridge USDC between chains with CCTP.", "0.05"),
  skill("whitechain-dev", "Build on Whitechain: network facts, tokens, deploy and verify.", "0.05", {
    upstream: {
      label: "whitechain-labs/skills",
      url: "https://github.com/whitechain-labs/skills",
      licence: "None published, reproduced verbatim (see NOTICE)",
    },
    seller: seller("whitechain-skills"),
    rails: ["whitechain"],
    price: { amount: "50000", asset: USDT },
    bond: { amount: "1000000", asset: USDT },
  }),
  {
    ...skill("hedera-agent-kit", "Hedera tools over MCP, returning unsigned transaction bytes.", "0.01"),
    adapter: "mcp",
    upstream: {
      label: "@hashgraph/hedera-agent-kit-mcp",
      url: "https://www.npmjs.com/package/@hashgraph/hedera-agent-kit-mcp",
      licence: "Apache-2.0",
    },
    seller: seller("hedera-tools"),
    rails: ["hedera"],
    deadlineSeconds: 30,
    rating: { released: 12, refunded: 0 },
  },
  {
    ...skill("circle-codegen", "Circle's codegen MCP server, metered per call.", "0.02"),
    adapter: "mcp",
    upstream: { label: "api.circle.com/v1/codegen/mcp", url: "https://api.circle.com/v1/codegen/mcp", licence: "n/a" },
    seller: seller("circle-codegen-proxy"),
    rails: ["arc-gateway"],
    deadlineSeconds: 45,
  },
  {
    ...skill("merchant-invoice", "Issue an invoice and refund it in one call.", "0.10"),
    adapter: "openapi",
    upstream: { label: "this repository", url: "#/registry", licence: "MIT" },
    seller: seller("merchant-desk"),
    rails: ["whitechain", "arc"],
  },
];

export function offerById(id: string): Offer | undefined {
  return offers.find((o) => o.id === id);
}

const AGENT = "research-agent";

export const envelope: Envelope = {
  agent: AGENT,
  period: "day",
  cap: usdc("5"),
  spent: usdc("0.42"),
  perMerchant: usdc("1"),
  askAbove: usdc("0.04"),
  allowlist: [seller("circle-skills"), seller("hedera-tools"), seller("whitechain-skills")],
  revoked: false,
  gatewayBalance: usdc("4.58"),
};

export const approvals: Approval[] = [
  {
    id: "ap-1",
    agent: AGENT,
    offer: offers[0]!,
    amount: usdc("0.05"),
    rail: "arc",
    discoveredVia: "circle",
    requestedAt: minutesAgo(1),
  },
];

function purchase(
  n: number,
  offer: Offer,
  status: Purchase["status"],
  mins: number,
  extra: Partial<Purchase> = {},
): Purchase {
  return {
    id: `job-${n}`,
    offerId: offer.id,
    offerName: offer.name,
    adapter: offer.adapter,
    seller: offer.seller,
    amount: offer.price,
    status,
    rail: offer.rails[0]!,
    at: minutesAgo(mins),
    slipId: status === "released" ? `slip-${n}` : undefined,
    approvedBy: "envelope",
    ...extra,
  };
}

const [useArc, useUsdc, useGateway, , , whitechainDev, hederaKit, codegen] = offers as [
  Offer,
  Offer,
  Offer,
  Offer,
  Offer,
  Offer,
  Offer,
  Offer,
];

export const history: Purchase[] = [
  purchase(8, useArc, "refused", 3, { approvedBy: "you", reason: "The price moved after you signed." }),
  purchase(7, hederaKit, "released", 9),
  purchase(6, codegen, "released", 14, { rail: "arc-gateway", amount: usdc("0.02") }),
  purchase(5, useGateway, "refunded", 26, { reason: "The deadline passed. Anyone could return it." }),
  purchase(4, useUsdc, "released", 41, { approvedBy: "you" }),
  purchase(3, whitechainDev, "released", 70),
  purchase(2, useArc, "released", 60 * 26),
  purchase(1, useUsdc, "released", 60 * 27),
];

function slipFor(p: Purchase): Slip {
  const offer = offerById(p.offerId)!;
  const toll = ((BigInt(p.amount.amount) * BigInt(offer.tollBps)) / 10_000n).toString();
  const funded = new Date(new Date(p.at).getTime() - 20_000).toISOString();
  const deadline = new Date(new Date(funded).getTime() + offer.deadlineSeconds * 1000).toISOString();
  const rail = p.rail;
  return {
    id: p.slipId!,
    hash: fakeHex(`slip:${p.id}`),
    jobId: fakeHex(`job:${p.id}`),
    offerHash: offer.hash,
    offerId: offer.id,
    offerName: offer.name,
    adapter: offer.adapter,
    buyer: fakeHex(`buyer:${AGENT}`, 20),
    seller: offer.seller,
    amount: p.amount,
    toll: { amount: toll, asset: p.amount.asset },
    rail: {
      id: rail,
      network: rail === "whitechain" ? "Whitechain Sepolia" : rail === "hedera" ? "Hedera testnet" : "Arc testnet",
      chainId: rail === "whitechain" ? "1874" : rail === "hedera" ? "hedera:testnet" : "5042002",
      tx: rail === "hedera" ? "0.0.5291847@1762415321.441203117" : fakeHex(`tx:${p.id}`),
      explorer: "",
    },
    outputHash: fakeHex(`out:${p.id}`),
    countersignature: fakeHex(`cs:${p.id}`, 65),
    sellerSignature: fakeHex(`ss:${p.id}`, 65),
    fundedAt: funded,
    releasedAt: p.at,
    deadline,
    tree: p.id === "job-6" ? { root: fakeHex("tree:job-6") } : undefined,
  };
}

export const slips: Slip[] = history.filter((p) => p.slipId).map(slipFor);

export function slipById(id: string): Slip | undefined {
  return slips.find((s) => s.id === id);
}

export const tree: TreeNode = {
  slipId: "slip-6",
  hash: fakeHex("tree:job-6"),
  offerName: "circle-codegen",
  seller: "circle-codegen-proxy",
  amount: usdc("0.02"),
  rail: "arc-gateway",
  children: [
    {
      slipId: "slip-6a",
      hash: fakeHex("slip:6a"),
      offerName: "use-arc",
      seller: "circle-skills",
      amount: usdc("0.005"),
      rail: "arc-gateway",
      children: [],
    },
    {
      slipId: "slip-6b",
      hash: fakeHex("slip:6b"),
      offerName: "use-usdc",
      seller: "circle-skills",
      amount: usdc("0.005"),
      rail: "arc-gateway",
      children: [],
    },
  ],
};
