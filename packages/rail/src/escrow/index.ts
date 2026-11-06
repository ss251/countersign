/**
 * The escrow rail: CountersignedEscrow on an EVM chain with an EIP-3009 stablecoin.
 * Arc (USDC) uses it as rail "escrow"; Whitechain (USDT) wraps it as rail "whitechain".
 *
 * settle() funds the escrow with the buyer's countersignature; the job then closes through
 * escrow.release (seller's slip), escrow.refund (anyone, after the deadline) or escrow.cancel
 * (the seller's early refund). The submitter pays gas; the buyer never does.
 */

import {
  type Address,
  type Chain,
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  type Hex,
  http,
  isAddress,
  isHex,
  type LocalAccount,
  parseSignature,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import {
  checkCountersign,
  type CountersignExtra,
  type CountersignPayload,
  type Network,
  type Offer,
  offerHash,
  type PaymentPayload,
  type PaymentRequirements,
  type SettleResult,
  type VerifyResult,
} from "@countersign/core";
import type { ChallengeContext, EscrowOps, Rail, RailDeclaration } from "../rail.ts";
import { escrowAbi } from "./abi.ts";

const erc3009ReadAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "authorizationState",
    stateMutability: "view",
    inputs: [
      { name: "authorizer", type: "address" },
      { name: "nonce", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export interface EscrowRailConfig {
  id: "escrow" | "whitechain";
  chainId: number;
  rpcUrl: string;
  escrow: Address;
  token: Address;
  tokenName: string;
  tokenVersion: string;
  symbol: string;
  decimals: number;
  explorerTx: string;
  finality: string;
  gasPaidBy: "hub" | "relayer";
  /** Sends fund, release, refund and cancel. Without one the rail can verify but not settle. */
  submitter?: LocalAccount;
  /** Allowed gap in seconds between the signed deadline and now + offer.deadline. Default 120. */
  deadlineSlack?: number;
  now?: () => number;
  /** Injected clients, for tests. */
  publicClient?: PublicClient<Transport, Chain>;
  walletClient?: WalletClient<Transport, Chain, LocalAccount>;
}

export const STATUS = ["none", "funded", "released", "refunded"] as const;

/** Offer prices are atomic 6-decimal USD; scale them to the token's decimals. */
export function priceInToken(price: string, decimals: number): string {
  if (decimals < 6) throw new Error(`token decimals ${decimals} below the 6 an offer price uses`);
  return (BigInt(price) * 10n ** BigInt(decimals - 6)).toString(10);
}

function isPayload(p: unknown): p is CountersignPayload {
  const v = p as Partial<CountersignPayload> | null;
  return (
    !!v &&
    typeof v === "object" &&
    !!v.terms &&
    !!v.authorization &&
    typeof v.signature === "string" &&
    isHex(v.signature) &&
    typeof v.terms.offerHash === "string" &&
    typeof v.terms.buyer === "string" &&
    isAddress(v.terms.buyer) &&
    typeof v.terms.payee === "string" &&
    isAddress(v.terms.payee) &&
    typeof v.terms.amount === "string" &&
    typeof v.terms.deadline === "number" &&
    typeof v.terms.salt === "string" &&
    typeof v.authorization.nonce === "string"
  );
}

export function escrowRail(cfg: EscrowRailConfig): Rail {
  const network: Network = `eip155:${cfg.chainId}`;
  const now = cfg.now ?? (() => Math.floor(Date.now() / 1000));
  const slack = cfg.deadlineSlack ?? 120;
  const chain = defineChain({
    id: cfg.chainId,
    name: network,
    nativeCurrency: { name: "native", symbol: "NATIVE", decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
  });
  const pub = cfg.publicClient ?? createPublicClient({ chain, transport: http(cfg.rpcUrl) });
  const wallet =
    cfg.walletClient ??
    (cfg.submitter ? createWalletClient({ chain, transport: http(cfg.rpcUrl), account: cfg.submitter }) : undefined);

  const declaration: RailDeclaration = {
    id: cfg.id,
    network,
    scheme: "countersign",
    asset: { network, address: getAddress(cfg.token), symbol: cfg.symbol, decimals: cfg.decimals },
    kind: "escrow",
    escrow: getAddress(cfg.escrow),
    gasPaidBy: cfg.gasPaidBy,
    finality: cfg.finality,
    explorerTx: cfg.explorerTx,
  };

  // One sender, one queue: transactions go out in order so nonces never collide.
  let queue: Promise<unknown> = Promise.resolve();
  function send(write: () => Promise<Hex>): Promise<Hex> {
    const next = queue.then(write, write);
    queue = next.catch(() => undefined);
    return next;
  }

  async function submit(label: string, write: () => Promise<Hex>, payer?: string): Promise<SettleResult> {
    if (!wallet) return { success: false, errorReason: `This rail has no submitter; it cannot ${label}.`, transaction: "", network };
    let hash: Hex;
    try {
      hash = await send(write);
    } catch (e) {
      return { success: false, errorReason: `Refused. ${label} would revert: ${short(e)}`, transaction: "", network };
    }
    const receipt = await pub.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      return { success: false, errorReason: `Refused. The chain reverted the ${label}.`, transaction: hash, network };
    }
    return { success: true, transaction: hash, network, ...(payer ? { payer } : {}) };
  }

  function challenge(offer: Offer, _ctx: ChallengeContext): PaymentRequirements {
    const extra: CountersignExtra = {
      rail: cfg.id,
      escrow: getAddress(cfg.escrow),
      chainId: cfg.chainId,
      offerHash: offerHash(offer),
      deadlineSeconds: offer.deadline,
      tokenName: cfg.tokenName,
      tokenVersion: cfg.tokenVersion,
    };
    return {
      scheme: "countersign",
      network,
      amount: priceInToken(offer.price, cfg.decimals),
      asset: getAddress(cfg.token),
      payTo: offer.payTo?.[cfg.id] ?? offer.seller,
      maxTimeoutSeconds: offer.deadline,
      extra: extra as unknown as Record<string, unknown>,
    };
  }

  async function verify(payment: PaymentPayload, req: PaymentRequirements): Promise<VerifyResult> {
    const p = payment.payload;
    if (!isPayload(p)) return { isValid: false, invalidReason: "Refused. The payment is not a countersignature." };
    const extra = req.extra as unknown as CountersignExtra | undefined;
    if (!extra || req.scheme !== "countersign" || req.network !== network) {
      return { isValid: false, invalidReason: "Refused. This rail does not take that payment." };
    }
    const t = p.terms;
    if (t.offerHash.toLowerCase() !== extra.offerHash.toLowerCase()) {
      return { isValid: false, invalidReason: "Refused. The countersignature names another offer." };
    }
    if (t.amount !== req.amount) return { isValid: false, invalidReason: "Refused. The price moved after you signed." };
    if (!isAddress(req.payTo) || getAddress(t.payee) !== getAddress(req.payTo)) {
      return { isValid: false, invalidReason: "Refused. The countersignature pays someone else." };
    }
    const at = now();
    if (t.deadline <= at + 10 || Math.abs(t.deadline - (at + extra.deadlineSeconds)) > slack) {
      return { isValid: false, invalidReason: "Refused. The signed deadline does not match the offer." };
    }
    const check = await checkCountersign(p, {
      chainId: cfg.chainId,
      escrow: cfg.escrow,
      token: cfg.token,
      tokenName: cfg.tokenName,
      tokenVersion: cfg.tokenVersion,
      now: at,
    });
    if (!check.ok) return { isValid: false, invalidReason: check.message };
    const [balance, used, job] = await Promise.all([
      pub.readContract({ address: cfg.token, abi: erc3009ReadAbi, functionName: "balanceOf", args: [check.buyer] }),
      pub.readContract({
        address: cfg.token,
        abi: erc3009ReadAbi,
        functionName: "authorizationState",
        args: [check.buyer, check.jobId],
      }),
      pub.readContract({ address: cfg.escrow, abi: escrowAbi, functionName: "jobOf", args: [check.jobId] }),
    ]);
    if (balance < BigInt(t.amount)) return { isValid: false, invalidReason: "Refused. The buyer cannot cover this amount." };
    if (used || job.status !== 0) return { isValid: false, invalidReason: "Refused. This countersignature was already used." };
    return { isValid: true, payer: check.buyer };
  }

  async function settle(payment: PaymentPayload, req: PaymentRequirements): Promise<SettleResult> {
    const v = await verify(payment, req);
    if (!v.isValid) return { success: false, errorReason: v.invalidReason, transaction: "", network };
    const p = payment.payload as unknown as CountersignPayload;
    const extra = req.extra as unknown as CountersignExtra;
    return submit(
      "funding",
      () => wallet!.writeContract({ address: cfg.escrow, abi: escrowAbi, functionName: "fund", args: fundArgs(extra.offerHash, p) }),
      v.payer,
    );
  }

  const escrow: EscrowOps = {
    release: (jobId, slipHash, sellerSig) =>
      submit("release", () =>
        wallet!.writeContract({ address: cfg.escrow, abi: escrowAbi, functionName: "release", args: [jobId, slipHash, sellerSig] }),
      ),
    refund: (jobId) =>
      submit("refund", () => wallet!.writeContract({ address: cfg.escrow, abi: escrowAbi, functionName: "refund", args: [jobId] })),
    cancel: (jobId, sellerSig) =>
      submit("cancel", () =>
        wallet!.writeContract({ address: cfg.escrow, abi: escrowAbi, functionName: "cancel", args: [jobId, sellerSig] }),
      ),
    status: async (jobId) => {
      const job = await pub.readContract({ address: cfg.escrow, abi: escrowAbi, functionName: "jobOf", args: [jobId] });
      return STATUS[job.status] ?? "none";
    },
  };

  return { declaration, challenge, verify, settle, escrow };
}

/** The contract's fund() arguments from a wire payload. Exported for the moved-price demo. */
export function fundArgs(offer: Hex, p: CountersignPayload) {
  const sig = parseSignature(p.signature);
  const v = sig.v !== undefined ? Number(sig.v) : (sig.yParity ?? 0) + 27;
  return [
    offer,
    {
      buyer: getAddress(p.terms.buyer),
      payee: getAddress(p.terms.payee),
      amount: BigInt(p.terms.amount),
      deadline: BigInt(p.terms.deadline),
      salt: BigInt(p.terms.salt),
      validAfter: BigInt(p.authorization.validAfter),
      validBefore: BigInt(p.authorization.validBefore),
      v,
      r: sig.r,
      s: sig.s,
    },
  ] as const;
}

function short(e: unknown): string {
  const m = e instanceof Error ? ((e as { shortMessage?: string }).shortMessage ?? e.message) : String(e);
  return m.split("\n")[0]!.slice(0, 200);
}
