/**
 * The escrow rail: CountersignedEscrow on an EVM chain with an EIP-3009 stablecoin.
 * Arc (USDC) uses it as rail "escrow"; Whitechain (USDT) wraps it as rail "whitechain".
 *
 * settle() funds the escrow with the buyer's countersignature, locking the seller's bond when the
 * offer declares one; the job then closes through escrow.release (seller's slip), escrow.refund
 * (anyone, after the deadline), escrow.cancel (the seller's early refund) or escrow.failDelivery
 * (the arbiter's verdict that the seller's delivery failed the hub's gate). The submitter pays
 * gas; the buyer never does.
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
  isV2Terms,
  type Network,
  type Offer,
  offerHash,
  type PaymentPayload,
  type PaymentRequirements,
  type SettleResult,
  type VerifyResult,
  ZERO_HASH,
} from "@countersign/core";
import type { ChallengeContext, EscrowOps, Rail, RailDeclaration } from "../rail.ts";
import { escrowAbi } from "./abi.ts";
import { escrowV2Abi } from "./abi-v2.ts";

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
  id: "escrow" | "whitechain" | "erc8183";
  chainId: number;
  rpcUrl: string;
  escrow: Address;
  /** Escrow contract version. Default 1, the deployed escrows. Only 2 exposes the review methods. */
  version?: 1 | 2;
  token: Address;
  tokenName: string;
  tokenVersion: string;
  symbol: string;
  decimals: number;
  explorerTx: string;
  finality: string;
  gasPaidBy: "hub" | "relayer";
  /** Seconds until the settlement is final. Defaults to 2 for Arc escrow. */
  finalitySeconds?: number;
  /** The rail's own cost. Defaults to a 1% toll, no fixed fee. */
  cost?: { tollBps: number; fixed: string };
  /** Sends fund, release, refund and cancel. Without one the rail can verify but not settle. */
  submitter?: LocalAccount;
  /**
   * Clock skew in seconds tolerated below now + offer.deadline. Default 15. The buyer may give the
   * seller more time (up to maxExtraSeconds) but never less than the offer promises.
   */
  deadlineSkew?: number;
  /** How much longer than the offer's window a buyer may sign. Default 300. */
  maxExtraSeconds?: number;
  /** How long to wait for a receipt before reporting the tx as pending. Default 60_000 ms. */
  receiptTimeoutMs?: number;
  now?: () => number;
  /** Injected clients, for tests. */
  publicClient?: PublicClient<Transport, Chain>;
  walletClient?: WalletClient<Transport, Chain, LocalAccount>;
}

export const STATUS = ["none", "funded", "released", "refunded", "failed", "delivered", "disputed"] as const;

/** Escrow v2's settle window: release and failDelivery land until deadline + 600, refund after it. */
export const DISPUTE_WINDOW_SECONDS = 600;

const V2_TERMS_REFUSED = "Refused. The countersigned bond or review window is not the offer's.";
const V2_ON_V1_REFUSED = "Refused. This rail is v1; it does not take escrow v2 terms.";

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
  const version = cfg.version ?? 1;
  const now = cfg.now ?? (() => Math.floor(Date.now() / 1000));
  const skew = cfg.deadlineSkew ?? 15;
  const maxExtra = cfg.maxExtraSeconds ?? 300;
  const receiptTimeoutMs = cfg.receiptTimeoutMs ?? 60_000;
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
  const funderAddress = wallet?.account?.address ?? cfg.submitter?.address;
  const funder = funderAddress !== undefined ? getAddress(funderAddress) : undefined;

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
    finalitySeconds: cfg.finalitySeconds ?? 2,
    cost: cfg.cost ?? { tollBps: 100, fixed: "0" },
  };

  // One sender, one queue: transactions go out in order so nonces never collide.
  let queue: Promise<unknown> = Promise.resolve();
  let toll: Promise<number> | null = null;
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
    let receipt: Awaited<ReturnType<typeof pub.waitForTransactionReceipt>>;
    try {
      receipt = await pub.waitForTransactionReceipt({ hash, timeout: receiptTimeoutMs });
    } catch {
      // Broadcast but not yet mined: the caller polls escrow.status(jobId) rather than assume either way.
      return { success: false, errorReason: "pending", transaction: hash, network };
    }
    if (receipt.status !== "success") {
      return { success: false, errorReason: `Refused. The chain reverted the ${label}.`, transaction: hash, network };
    }
    return { success: true, transaction: hash, network, ...(payer ? { payer } : {}) };
  }

  function challenge(offer: Offer, _ctx: ChallengeContext): PaymentRequirements {
    const extra: CountersignExtra & { bond: string; reviewWindow?: number; escrowVersion?: 2 } = {
      rail: cfg.id,
      escrow: getAddress(cfg.escrow),
      chainId: cfg.chainId,
      offerHash: offerHash(offer),
      deadlineSeconds: offer.deadline,
      tokenName: cfg.tokenName,
      tokenVersion: cfg.tokenVersion,
      bond: offer.bond ?? "0",
      ...(version === 2 ? { reviewWindow: offerReviewWindow(offer), escrowVersion: 2 as const } : {}),
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
    const extra = req.extra as unknown as (CountersignExtra & { bond?: unknown; reviewWindow?: unknown }) | undefined;
    if (!extra || req.scheme !== "countersign" || req.network !== network) {
      return { isValid: false, invalidReason: "Refused. This rail does not take that payment." };
    }
    const t = p.terms;
    if (version === 1 && isV2Terms(t)) {
      return { isValid: false, invalidReason: V2_ON_V1_REFUSED };
    }
    if (version === 2) {
      const offeredWindow = typeof extra.reviewWindow === "number" ? extra.reviewWindow : 0;
      if (
        !isV2Terms(t) ||
        !sameAtomic(t.bond, extra.bond) ||
        (t.reviewWindow ?? 0) !== offeredWindow
      ) {
        return { isValid: false, invalidReason: V2_TERMS_REFUSED };
      }
    }
    if (t.offerHash.toLowerCase() !== extra.offerHash.toLowerCase()) {
      return { isValid: false, invalidReason: "Refused. The countersignature names another offer." };
    }
    if (t.amount !== req.amount) return { isValid: false, invalidReason: "Refused. The price moved after you signed." };
    if (!isAddress(req.payTo) || getAddress(t.payee) !== getAddress(req.payTo)) {
      return { isValid: false, invalidReason: "Refused. The countersignature pays someone else." };
    }
    // One-sided: the seller's window may never be shorter than the offer promises.
    const at = now();
    const promised = at + extra.deadlineSeconds;
    if (t.deadline < promised - skew) {
      return { isValid: false, invalidReason: "Refused. The signed deadline is shorter than the offer promises." };
    }
    if (t.deadline > promised + maxExtra) {
      return { isValid: false, invalidReason: "Refused. The signed deadline is further out than this hub allows." };
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

  async function settle(payment: PaymentPayload, req: PaymentRequirements, opts?: { lockSig?: Hex }): Promise<SettleResult> {
    const v = await verify(payment, req);
    if (!v.isValid) return { success: false, errorReason: v.invalidReason, transaction: "", network };
    const p = payment.payload as unknown as CountersignPayload;
    const extra = req.extra as unknown as CountersignExtra & { bond?: unknown };
    if (version === 2) {
      return submit(
        "funding",
        () =>
          wallet!.writeContract({
            address: cfg.escrow,
            abi: escrowV2Abi,
            functionName: "fund",
            args: [...fundArgsV2(extra.offerHash, p), opts?.lockSig ?? "0x"],
          }),
        v.payer,
      );
    }
    const bond = atomicOrZero(extra.bond);
    if (bond > 0n) {
      const args = fundArgs(extra.offerHash, p);
      return submit(
        "funding",
        () =>
          wallet!.writeContract({
            address: cfg.escrow,
            abi: escrowAbi,
            functionName: "fundBonded",
            args: [args[0], args[1], bond],
          }),
        v.payer,
      );
    }
    return submit(
      "funding",
      () => wallet!.writeContract({ address: cfg.escrow, abi: escrowAbi, functionName: "fund", args: fundArgs(extra.offerHash, p) }),
      v.payer,
    );
  }

  const v2Ops: Pick<EscrowOps, "accept" | "dispute" | "releaseAfterWindow" | "reviewOf" | "sweepToll"> =
    version === 2
      ? {
          accept: (jobId, buyerSig) =>
            submit("acceptance", () =>
              wallet!.writeContract({ address: cfg.escrow, abi: escrowV2Abi, functionName: "accept", args: [jobId, buyerSig] }),
            ),
          dispute: (jobId, status, buyerSig) =>
            submit("dispute", () =>
              wallet!.writeContract({
                address: cfg.escrow,
                abi: escrowV2Abi,
                functionName: "dispute",
                args: [jobId, status, buyerSig],
              }),
            ),
          releaseAfterWindow: (jobId) =>
            submit("window release", () =>
              wallet!.writeContract({
                address: cfg.escrow,
                abi: escrowV2Abi,
                functionName: "releaseAfterWindow",
                args: [jobId],
              }),
            ),
          reviewOf: async (jobId) => {
            const [window, deliveredAt, endsAt] = await pub.readContract({
              address: cfg.escrow,
              abi: escrowV2Abi,
              functionName: "reviewOf",
              args: [jobId],
            });
            return { window: Number(window), deliveredAt: Number(deliveredAt), endsAt: Number(endsAt) };
          },
          sweepToll: () =>
            submit("toll sweep", () =>
              wallet!.writeContract({ address: cfg.escrow, abi: escrowV2Abi, functionName: "sweepToll", args: [] }),
            ),
        }
      : {};

  const escrow: EscrowOps = {
    release: (jobId, slipHash, sellerSig) => {
      if (slipHash.toLowerCase() === ZERO_HASH) {
        return Promise.resolve({
          success: false,
          errorReason: "Refused. A release must commit a slip hash.",
          transaction: "",
          network,
        });
      }
      return submit("release", () =>
        wallet!.writeContract({ address: cfg.escrow, abi: escrowAbi, functionName: "release", args: [jobId, slipHash, sellerSig] }),
      );
    },
    refund: (jobId) =>
      submit("refund", () => wallet!.writeContract({ address: cfg.escrow, abi: escrowAbi, functionName: "refund", args: [jobId] })),
    cancel: (jobId, sellerSig) =>
      submit("cancel", () =>
        wallet!.writeContract({ address: cfg.escrow, abi: escrowAbi, functionName: "cancel", args: [jobId, sellerSig] }),
      ),
    failDelivery: (jobId) =>
      submit("delivery failure", () =>
        wallet!.writeContract({ address: cfg.escrow, abi: escrowAbi, functionName: "failDelivery", args: [jobId] }),
      ),
    bondOfPayee: (payee) => bondOfPayee(pub, cfg.escrow, payee),
    ...v2Ops,
    disputeWindowSeconds: version === 2 ? DISPUTE_WINDOW_SECONDS : 0,
    status: async (jobId) => {
      const job = await pub.readContract({ address: cfg.escrow, abi: escrowAbi, functionName: "jobOf", args: [jobId] });
      return STATUS[job.status] ?? "none";
    },
    tollBps: () => {
      toll ??= pub
        .readContract({ address: cfg.escrow, abi: escrowAbi, functionName: "tollBps" })
        .then((bps) => Number(bps));
      return toll;
    },
  };

  return { declaration, funder, challenge, verify, settle, escrow };
}

/** The payee's free (unlocked) bond on an escrow, in atomic units. Exported for the hub and runner. */
export async function bondOfPayee(
  client: PublicClient<Transport, Chain>,
  escrow: Address,
  payee: Address,
): Promise<string> {
  const bond = await client.readContract({
    address: escrow,
    abi: escrowAbi,
    functionName: "bondOf",
    args: [payee],
  });
  return bond.toString(10);
}

function atomicOrZero(value: unknown): bigint {
  return typeof value === "string" && /^\d+$/.test(value) ? BigInt(value) : 0n;
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

/** offer.reviewWindow when the published offer carries one (v2), else 0. */
export function offerReviewWindow(offer: Offer): number {
  const value = (offer as Offer & { reviewWindow?: unknown }).reviewWindow;
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : 0;
}

/** The contract's fund() arguments for a v2 countersignature. Exported for tests and the runner. */
export function fundArgsV2(offer: Hex, p: CountersignPayload) {
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
      bond: BigInt(p.terms.bond ?? "0"),
      reviewWindow: BigInt(p.terms.reviewWindow ?? 0),
      validAfter: BigInt(p.authorization.validAfter),
      validBefore: BigInt(p.authorization.validBefore),
      v,
      r: sig.r,
      s: sig.s,
    },
  ] as const;
}

function sameAtomic(a: string | undefined, b: unknown): boolean {
  if (typeof b !== "string" || !/^\d+$/.test(b)) return false;
  try {
    return BigInt(a ?? "0") === BigInt(b);
  } catch {
    return false;
  }
}

function short(e: unknown): string {
  const m = e instanceof Error ? ((e as { shortMessage?: string }).shortMessage ?? e.message) : String(e);
  return m.split("\n")[0]!.slice(0, 200);
}
