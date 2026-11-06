/**
 * The eip3009 rail: a direct USDC transfer on Arc testnet.
 *
 * The buyer signs the token's EIP-3009 TransferWithAuthorization straight to the seller.
 * The hub checks it and submits it with its relayer, so the buyer pays no gas and the
 * money lands in one Arc block, before the work is dispatched.
 */

import {
  type Address,
  type Chain,
  createPublicClient,
  createWalletClient,
  decodeEventLog,
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
import { recoverTypedDataAddress, type TypedDataDomain } from "viem";
import type {
  Asset,
  Network,
  Offer,
  PaymentPayload,
  PaymentRequirements,
  SettleResult,
  VerifyResult,
} from "@countersign/core";
import type { ChallengeContext, Rail, RailDeclaration } from "../rail.ts";

const DEFAULT_MAX_TIMEOUT_SECONDS = 300;

export const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

const transferEvent = {
  type: "event",
  name: "Transfer",
  inputs: [
    { indexed: true, name: "from", type: "address" },
    { indexed: true, name: "to", type: "address" },
    { indexed: false, name: "value", type: "uint256" },
  ],
} as const;

const tokenAbi = [
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
  {
    type: "function",
    name: "transferWithAuthorization",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;

export interface Eip3009RailConfig {
  id: "eip3009";
  chainId: number;
  rpcUrl: string;
  token: Address;
  tokenName: string;
  tokenVersion: string;
  symbol: string;
  decimals: number;
  explorerTx: string;
  /** Sends transferWithAuthorization. Without one the rail can verify but not settle. */
  submitter?: LocalAccount;
  /** The payment window offered to buyers. Default 300 seconds. */
  maxTimeoutSeconds?: number;
  /** How long to wait for a receipt before reporting the tx as pending. Default 60_000 ms. */
  receiptTimeoutMs?: number;
  now?: () => number;
  /** Injected clients, for tests. */
  publicClient?: PublicClient<Transport, Chain>;
  walletClient?: WalletClient<Transport, Chain, LocalAccount>;
}

interface Authorization {
  from: string;
  to: string;
  value: string;
  validAfter: unknown;
  validBefore: unknown;
  nonce: Hex;
}

interface Payload {
  signature: Hex;
  authorization: Authorization;
}

function isPayload(value: unknown): value is Payload {
  const p = value as Partial<Payload> | null;
  if (!p || typeof p !== "object") return false;
  if (typeof p.signature !== "string" || !isHex(p.signature)) return false;
  const a = p.authorization as Partial<Authorization> | undefined;
  if (!a || typeof a !== "object") return false;
  return (
    typeof a.from === "string" &&
    isAddress(a.from) &&
    typeof a.to === "string" &&
    isAddress(a.to) &&
    typeof a.value === "string" &&
    typeof a.nonce === "string" &&
    isHex(a.nonce) &&
    a.nonce.length === 66
  );
}

/** Offer prices are atomic 6-decimal USD; scale them to the token's decimals. */
function priceInToken(price: string, decimals: number): string {
  if (decimals < 6) throw new Error(`token decimals ${decimals} below the 6 an offer price uses`);
  return (BigInt(price) * 10n ** BigInt(decimals - 6)).toString(10);
}

function seconds(value: unknown): number | null {
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  return null;
}

function tokenDomain(cfg: Eip3009RailConfig): TypedDataDomain {
  return {
    name: cfg.tokenName,
    version: cfg.tokenVersion,
    chainId: cfg.chainId,
    verifyingContract: getAddress(cfg.token),
  };
}

export function eip3009Rail(cfg: Eip3009RailConfig): Rail {
  const network: Network = `eip155:${cfg.chainId}`;
  const now = cfg.now ?? (() => Math.floor(Date.now() / 1000));
  const maxTimeoutSeconds = cfg.maxTimeoutSeconds ?? DEFAULT_MAX_TIMEOUT_SECONDS;
  const receiptTimeoutMs = cfg.receiptTimeoutMs ?? 60_000;
  const domain = tokenDomain(cfg);
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

  const asset: Asset = { network, address: getAddress(cfg.token), symbol: cfg.symbol, decimals: cfg.decimals };
  const declaration: RailDeclaration = {
    id: cfg.id,
    network,
    scheme: "exact",
    asset,
    kind: "direct",
    gasPaidBy: "hub",
    finality: "Final in the Arc block that includes the transfer, before the work is dispatched.",
    finalitySeconds: 2,
    cost: { tollBps: 0, fixed: "0" },
    explorerTx: cfg.explorerTx,
  };

  function challenge(offer: Offer, _ctx: ChallengeContext): PaymentRequirements {
    return {
      scheme: "exact",
      network,
      amount: priceInToken(offer.price, cfg.decimals),
      asset: getAddress(cfg.token),
      payTo: offer.payTo?.eip3009 ?? offer.seller,
      maxTimeoutSeconds,
      extra: { name: cfg.tokenName, version: cfg.tokenVersion },
    };
  }

  async function verify(payment: PaymentPayload, req: PaymentRequirements): Promise<VerifyResult> {
    if (req.scheme !== "exact" || req.network !== network) {
      return { isValid: false, invalidReason: "Refused. This rail does not take that payment." };
    }
    const p = payment.payload;
    if (!isPayload(p)) {
      return { isValid: false, invalidReason: "Refused. The payment is not an EIP-3009 authorization." };
    }
    const a = p.authorization;
    if (a.to.toLowerCase() !== req.payTo.toLowerCase()) {
      return { isValid: false, invalidReason: "Refused. The authorization pays someone else." };
    }
    if (a.value !== req.amount) {
      return { isValid: false, invalidReason: "Refused. The authorization is for a different amount." };
    }
    const at = now();
    const validAfter = seconds(a.validAfter);
    const validBefore = seconds(a.validBefore);
    if (validAfter === null || validBefore === null) {
      return { isValid: false, invalidReason: "Refused. The authorization's window does not parse." };
    }
    if (validAfter > at) {
      return { isValid: false, invalidReason: "Refused. The authorization is not valid yet." };
    }
    if (validBefore < at + 6) {
      return { isValid: false, invalidReason: "Refused. The authorization expires too soon." };
    }
    if (validBefore > at + req.maxTimeoutSeconds + 30) {
      return { isValid: false, invalidReason: "Refused. The authorization outlasts this rail's window." };
    }

    let signer: Address;
    try {
      signer = await recoverTypedDataAddress({
        domain,
        types: TRANSFER_WITH_AUTHORIZATION_TYPES,
        primaryType: "TransferWithAuthorization",
        message: {
          from: getAddress(a.from),
          to: getAddress(a.to),
          value: BigInt(a.value),
          validAfter: BigInt(validAfter),
          validBefore: BigInt(validBefore),
          nonce: a.nonce,
        },
        signature: p.signature,
      });
    } catch {
      return { isValid: false, invalidReason: "Refused. The authorization does not parse." };
    }
    if (getAddress(signer) !== getAddress(a.from)) {
      return { isValid: false, invalidReason: "Refused. The authorization is not the payer's." };
    }

    const [used, balance] = await Promise.all([
      pub.readContract({
        address: cfg.token,
        abi: tokenAbi,
        functionName: "authorizationState",
        args: [getAddress(a.from), a.nonce],
      }),
      pub.readContract({ address: cfg.token, abi: tokenAbi, functionName: "balanceOf", args: [getAddress(a.from)] }),
    ]);
    if (used) return { isValid: false, invalidReason: "Refused. This authorization was already used." };
    if (balance < BigInt(a.value)) {
      return { isValid: false, invalidReason: "Refused. The payer cannot cover this amount." };
    }
    return { isValid: true, payer: getAddress(a.from) };
  }

  // One sender, one queue: transactions go out in order so nonces never collide.
  let queue: Promise<unknown> = Promise.resolve();
  function send(write: () => Promise<Hex>): Promise<Hex> {
    const next = queue.then(write, write);
    queue = next.catch(() => undefined);
    return next;
  }

  async function settle(payment: PaymentPayload, req: PaymentRequirements): Promise<SettleResult> {
    const checked = await verify(payment, req);
    if (!checked.isValid) {
      return { success: false, errorReason: checked.invalidReason, transaction: "", network };
    }
    if (!wallet) {
      return {
        success: false,
        errorReason: "This rail has no submitter; it cannot settle.",
        transaction: "",
        network,
      };
    }
    const p = payment.payload as unknown as Payload;
    const a = p.authorization;
    const sig = parseSignature(p.signature);
    const v = sig.v !== undefined ? Number(sig.v) : (sig.yParity ?? 0) + 27;

    let hash: Hex;
    try {
      hash = await send(() =>
        wallet.writeContract({
          address: cfg.token,
          abi: tokenAbi,
          functionName: "transferWithAuthorization",
          args: [
            getAddress(a.from),
            getAddress(a.to),
            BigInt(a.value),
            BigInt(String(a.validAfter)),
            BigInt(String(a.validBefore)),
            a.nonce,
            v,
            sig.r,
            sig.s,
          ],
        }),
      );
    } catch (e) {
      return {
        success: false,
        errorReason: `Refused. The transfer would revert: ${short(e)}`,
        transaction: "",
        network,
      };
    }

    let receipt: Awaited<ReturnType<typeof pub.waitForTransactionReceipt>>;
    try {
      receipt = await pub.waitForTransactionReceipt({ hash, timeout: receiptTimeoutMs });
    } catch {
      // Broadcast but not yet mined: report it as pending with the hash rather than guess.
      return { success: false, errorReason: "pending", transaction: hash, network };
    }
    if (receipt.status !== "success") {
      return { success: false, errorReason: "Refused. The chain reverted the transfer.", transaction: hash, network };
    }
    if (!hasTransfer(receipt.logs, cfg.token, a.from, a.to, BigInt(a.value))) {
      return {
        success: false,
        errorReason: "Refused. The token moved no money.",
        transaction: hash,
        network,
      };
    }
    return { success: true, transaction: hash, network, payer: getAddress(a.from) };
  }

  return { declaration, challenge, verify, settle };
}

function hasTransfer(
  logs: ReadonlyArray<{ address: string; data: Hex; topics: readonly Hex[] }>,
  token: Address,
  from: string,
  to: string,
  value: bigint,
): boolean {
  return logs.some((log) => {
    if (log.address.toLowerCase() !== token.toLowerCase()) return false;
    try {
      const decoded = decodeEventLog({
        abi: [transferEvent],
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
      });
      if (decoded.eventName !== "Transfer") return false;
      const args = decoded.args as { from: Address; to: Address; value: bigint };
      return (
        getAddress(args.from) === getAddress(from) &&
        getAddress(args.to) === getAddress(to) &&
        args.value === value
      );
    } catch {
      return false;
    }
  });
}

function short(e: unknown): string {
  const m = e instanceof Error ? ((e as { shortMessage?: string }).shortMessage ?? e.message) : String(e);
  return m.split("\n")[0]!.slice(0, 200);
}
