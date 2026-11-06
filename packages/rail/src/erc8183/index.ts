/**
 * The erc8183 rail: an ERC-8183 job escrow on Arc testnet, beside the CountersignedEscrow rail.
 *
 * settle() funds one job with the buyer's countersignature. The job then closes through
 * escrow.release, which is the contract's complete: the evaluator submits the provider's
 * Release signature, the provider is paid, and SlipHook emits the slip hash.
 * The submitter must be the contract's evaluator, or release reverts. The buyer pays no gas.
 *
 * The hub does not load this rail.
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
import { fundArgs, priceInToken } from "../escrow/index.ts";
import type { ChallengeContext, EscrowOps, EscrowStatus, Rail, RailDeclaration } from "../rail.ts";
import { erc8183Abi } from "./abi.ts";

/** Arc testnet, the chain this rail is declared on. Escrow and hook addresses come from the deploy. */
export const ARC_ERC8183 = {
  chainId: 5042002,
  token: "0x3600000000000000000000000000000000000000" as Address,
  tokenName: "USDC",
  tokenVersion: "2",
  symbol: "USDC",
  decimals: 6,
  explorerTx: "https://explorer.testnet.arc.io/tx/{tx}",
  finality: "Final in the Arc block where the job hook commits the slip.",
  gasPaidBy: "hub" as const,
  finalitySeconds: 2,
  cost: { tollBps: 100, fixed: "0" },
};

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

export interface Erc8183RailConfig {
  id?: "erc8183";
  chainId: number;
  rpcUrl: string;
  escrow: Address;
  /** SlipHook deployed with the escrow. Named on the 402; the contract is what emits. */
  hook: Address;
  token: Address;
  tokenName: string;
  tokenVersion: string;
  symbol: string;
  decimals: number;
  explorerTx: string;
  finality: string;
  gasPaidBy: "hub" | "relayer";
  finalitySeconds?: number;
  cost?: { tollBps: number; fixed: string };
  /** Sends fund, complete, claimRefund and reject. Must be the contract's evaluator to settle a job. */
  submitter?: LocalAccount;
  deadlineSkew?: number;
  maxExtraSeconds?: number;
  receiptTimeoutMs?: number;
  now?: () => number;
  publicClient?: PublicClient<Transport, Chain>;
  walletClient?: WalletClient<Transport, Chain, LocalAccount>;
}

/** statusOf: None, Open, Funded, Submitted, Completed, Rejected, Expired. */
const STATUS: readonly EscrowStatus[] = ["none", "none", "funded", "delivered", "released", "refunded", "refunded"];

const V2_REFUSED = "Refused. This rail does not take escrow v2 terms.";
const BOND_REFUSED = "Refused. This rail does not lock a bond.";

type Extra = CountersignExtra & { hook?: unknown; bond?: unknown };

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

function atomicOrZero(value: unknown): bigint {
  return typeof value === "string" && /^\d+$/.test(value) ? BigInt(value) : 0n;
}

export function erc8183Rail(cfg: Erc8183RailConfig): Rail {
  const network: Network = `eip155:${cfg.chainId}`;
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

  const declaration: RailDeclaration = {
    id: "erc8183",
    network,
    scheme: "countersign",
    asset: { network, address: getAddress(cfg.token), symbol: cfg.symbol, decimals: cfg.decimals },
    kind: "escrow",
    escrow: getAddress(cfg.escrow),
    gasPaidBy: cfg.gasPaidBy,
    finality: cfg.finality,
    explorerTx: cfg.explorerTx,
    finalitySeconds: cfg.finalitySeconds ?? ARC_ERC8183.finalitySeconds,
    cost: cfg.cost ?? ARC_ERC8183.cost,
  };

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
      return { success: false, errorReason: "pending", transaction: hash, network };
    }
    if (receipt.status !== "success") {
      return { success: false, errorReason: `Refused. The chain reverted the ${label}.`, transaction: hash, network };
    }
    return { success: true, transaction: hash, network, ...(payer ? { payer } : {}) };
  }

  function challenge(offer: Offer, _ctx: ChallengeContext): PaymentRequirements {
    const extra: Extra = {
      rail: "erc8183",
      escrow: getAddress(cfg.escrow),
      hook: getAddress(cfg.hook),
      chainId: cfg.chainId,
      offerHash: offerHash(offer),
      deadlineSeconds: offer.deadline,
      tokenName: cfg.tokenName,
      tokenVersion: cfg.tokenVersion,
      bond: offer.bond ?? "0",
    };
    return {
      scheme: "countersign",
      network,
      amount: priceInToken(offer.price, cfg.decimals),
      asset: getAddress(cfg.token),
      payTo: offer.payTo?.erc8183 ?? offer.seller,
      maxTimeoutSeconds: offer.deadline,
      extra: extra as unknown as Record<string, unknown>,
    };
  }

  async function verify(payment: PaymentPayload, req: PaymentRequirements): Promise<VerifyResult> {
    const p = payment.payload;
    if (!isPayload(p)) return { isValid: false, invalidReason: "Refused. The payment is not a countersignature." };
    const extra = req.extra as Extra | undefined;
    if (!extra || extra.rail !== "erc8183" || req.scheme !== "countersign" || req.network !== network) {
      return { isValid: false, invalidReason: "Refused. This rail does not take that payment." };
    }
    if (typeof extra.hook !== "string" || !isAddress(extra.hook) || getAddress(extra.hook) !== getAddress(cfg.hook)) {
      return { isValid: false, invalidReason: "Refused. This rail does not take that payment." };
    }
    if (!isAddress(extra.escrow) || getAddress(extra.escrow) !== getAddress(cfg.escrow) || extra.chainId !== cfg.chainId) {
      return { isValid: false, invalidReason: "Refused. This rail does not take that payment." };
    }
    const t = p.terms;
    if (isV2Terms(t)) return { isValid: false, invalidReason: V2_REFUSED };
    if (atomicOrZero(extra.bond) > 0n) return { isValid: false, invalidReason: BOND_REFUSED };
    if (t.offerHash.toLowerCase() !== String(extra.offerHash).toLowerCase()) {
      return { isValid: false, invalidReason: "Refused. The countersignature names another offer." };
    }
    if (t.amount !== req.amount) return { isValid: false, invalidReason: "Refused. The price moved after you signed." };
    if (!isAddress(req.payTo) || getAddress(t.payee) !== getAddress(req.payTo)) {
      return { isValid: false, invalidReason: "Refused. The countersignature pays someone else." };
    }
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
    const [balance, used, status] = await Promise.all([
      pub.readContract({ address: cfg.token, abi: erc3009ReadAbi, functionName: "balanceOf", args: [check.buyer] }),
      pub.readContract({
        address: cfg.token,
        abi: erc3009ReadAbi,
        functionName: "authorizationState",
        args: [check.buyer, check.jobId],
      }),
      pub.readContract({ address: cfg.escrow, abi: erc8183Abi, functionName: "statusOf", args: [check.jobId] }),
    ]);
    if (balance < BigInt(t.amount)) return { isValid: false, invalidReason: "Refused. The buyer cannot cover this amount." };
    if (used || status !== 0) return { isValid: false, invalidReason: "Refused. This countersignature was already used." };
    return { isValid: true, payer: check.buyer };
  }

  async function settle(payment: PaymentPayload, req: PaymentRequirements): Promise<SettleResult> {
    const v = await verify(payment, req);
    if (!v.isValid) return { success: false, errorReason: v.invalidReason, transaction: "", network };
    const p = payment.payload as unknown as CountersignPayload;
    const extra = req.extra as unknown as Extra;
    return submit(
      "funding",
      () =>
        wallet!.writeContract({
          address: cfg.escrow,
          abi: erc8183Abi,
          functionName: "fund",
          args: fundArgs(extra.offerHash, p),
        }),
      v.payer,
    );
  }

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
        wallet!.writeContract({
          address: cfg.escrow,
          abi: erc8183Abi,
          functionName: "complete",
          args: [jobId, slipHash, sellerSig],
        }),
      );
    },
    refund: (jobId) =>
      submit("refund", () =>
        wallet!.writeContract({ address: cfg.escrow, abi: erc8183Abi, functionName: "claimRefund", args: [jobId] }),
      ),
    cancel: (jobId, sellerSig) =>
      submit("cancel", () =>
        wallet!.writeContract({ address: cfg.escrow, abi: erc8183Abi, functionName: "reject", args: [jobId, sellerSig] }),
      ),
    status: async (jobId) => {
      const status = await pub.readContract({ address: cfg.escrow, abi: erc8183Abi, functionName: "statusOf", args: [jobId] });
      return STATUS[status] ?? "none";
    },
    tollBps: () => {
      toll ??= pub
        .readContract({ address: cfg.escrow, abi: erc8183Abi, functionName: "tollBps" })
        .then((bps) => Number(bps));
      return toll;
    },
  };

  return { declaration, challenge, verify, settle, escrow };
}

function short(e: unknown): string {
  const m = e instanceof Error ? ((e as { shortMessage?: string }).shortMessage ?? e.message) : String(e);
  return m.split("\n")[0]!.slice(0, 200);
}
