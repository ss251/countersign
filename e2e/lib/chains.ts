/**
 * The public networks the suite checks, and the reads it uses to check them.
 * Nothing here trusts the hub: receipts, events and job records come from a public RPC.
 */

import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  erc20Abi,
  getAddress,
  http,
  parseAbi,
  type Abi,
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import { escrowAbi, escrowV2Abi } from "@countersign/rail";
import { sleep } from "./http.ts";

export type NetworkKey = "arc" | "whitechain" | "hedera" | "tempo";

export interface EvmNetwork {
  key: "arc" | "whitechain";
  label: string;
  chainId: number;
  rpc: string;
  /** The 6-decimal stablecoin the escrow holds. */
  token: Address;
  tokenSymbol: "USDC" | "USDT";
  escrow: Address;
  /** The escrow contract's version: 1 unless the suite is switched to Arc v2. */
  escrowVersion: 1 | 2;
  gasSymbol: string;
  explorer: string;
  chain: Chain;
}

/** "2" runs Arc on escrow v2; anything else, unset included, keeps it on v1. */
export const ESCROW_VERSION: 1 | 2 = process.env.E2E_ESCROW_VERSION === "2" ? 2 : 1;

const arcEscrowV2 = process.env.E2E_ARC_ESCROW_V2;
if (ESCROW_VERSION === 2 && !arcEscrowV2) {
  throw new Error("E2E_ESCROW_VERSION=2 needs E2E_ARC_ESCROW_V2");
}

const arcRpc = process.env.E2E_ARC_RPC ?? "https://rpc.testnet.arc.network";
const wcRpc = process.env.E2E_WHITECHAIN_RPC ?? "https://rpc.ankr.com/whitechain_testnet";

export const ARC: EvmNetwork = {
  key: "arc",
  label: "Arc testnet",
  chainId: 5042002,
  rpc: arcRpc,
  token: "0x3600000000000000000000000000000000000000",
  tokenSymbol: "USDC",
  // CountersignedEscrow deployed through Arc Studio; the escrow the hub and the buyer pin.
  escrow:
    ESCROW_VERSION === 2
      ? getAddress(arcEscrowV2 as string)
      : "0x19c27d770969291e6a0a305dc1be1a845e7c1b76",
  escrowVersion: ESCROW_VERSION,
  gasSymbol: "USDC",
  // The explorer's own domain; testnet.arcscan.app redirects here.
  explorer: "https://explorer.testnet.arc.io",
  chain: defineChain({
    id: 5042002,
    name: "Arc Testnet",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [arcRpc] } },
  }),
};

export const WHITECHAIN: EvmNetwork = {
  key: "whitechain",
  label: "Whitechain Sepolia",
  chainId: 1874,
  rpc: wcRpc,
  token: "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7",
  tokenSymbol: "USDT",
  escrow: "0x9279D3edeef4c3738a0b200D762e2985Ff3B7eb4",
  // Whitechain stays on v1 in this packet; wc-09 builds v2 there.
  escrowVersion: 1,
  gasSymbol: "WBT",
  explorer: "https://explorer.testnet.whitechain.io",
  chain: defineChain({
    id: 1874,
    name: "Whitechain Sepolia",
    nativeCurrency: { name: "WBT", symbol: "WBT", decimals: 18 },
    rpcUrls: { default: { http: [wcRpc] } },
  }),
};

export const HEDERA = {
  key: "hedera" as const,
  label: "Hedera testnet",
  mirror: process.env.E2E_HEDERA_MIRROR ?? "https://testnet.mirrornode.hedera.com",
  hashscan: "https://hashscan.io/testnet",
  /** Circle's USDC on Hedera testnet. */
  usdc: "0.0.429274",
};

/** Tempo Moderato, the MPP rail's testnet. pathUSD has 6 decimals. */
export const TEMPO = {
  key: "tempo" as const,
  label: "Tempo Moderato",
  chainId: 42431,
  rpc: process.env.E2E_TEMPO_RPC ?? "https://rpc.moderato.tempo.xyz",
  pathUsd: "0x20c0000000000000000000000000000000000000" as Address,
  explorer: "https://explore.testnet.tempo.xyz",
};

export function explorerTx(network: NetworkKey, tx: string): string {
  if (network === "tempo") return `${TEMPO.explorer}/tx/${tx}`;
  if (network === "hedera") {
    // HashScan takes the SDK form, 0.0.payer@seconds.nanos.
    const dash = /^(\d+\.\d+\.\d+)-(\d+)-(\d+)$/.exec(tx);
    return `${HEDERA.hashscan}/transaction/${dash ? `${dash[1]}@${dash[2]}.${dash[3]}` : tx}`;
  }
  const net = network === "arc" ? ARC : WHITECHAIN;
  return `${net.explorer}/tx/${tx}`;
}

export function explorerAddress(network: NetworkKey, address: string): string {
  if (network === "tempo") return `${TEMPO.explorer}/address/${address}`;
  if (network === "hedera") return `${HEDERA.hashscan}/account/${address}`;
  const net = network === "arc" ? ARC : WHITECHAIN;
  return `${net.explorer}/address/${address}`;
}

const clients = new Map<number, PublicClient>();

export function reader(net: EvmNetwork): PublicClient {
  let c = clients.get(net.chainId);
  if (!c) {
    c = createPublicClient({ chain: net.chain, transport: http(net.rpc, { retryCount: 3, timeout: 20_000 }) }) as PublicClient;
    clients.set(net.chainId, c);
  }
  return c;
}

export function writer(net: EvmNetwork, account: Account) {
  return createWalletClient({ account, chain: net.chain, transport: http(net.rpc, { retryCount: 1, timeout: 30_000 }) });
}

export function tokenBalance(net: EvmNetwork, owner: Address): Promise<bigint> {
  return reader(net).readContract({ address: net.token, abi: erc20Abi, functionName: "balanceOf", args: [owner] });
}

export function gasBalance(net: EvmNetwork, owner: Address): Promise<bigint> {
  return reader(net).getBalance({ address: owner });
}

export async function receipt(net: EvmNetwork, hash: Hex, timeoutMs = 90_000): Promise<TransactionReceipt> {
  return reader(net).waitForTransactionReceipt({ hash, timeout: timeoutMs, pollingInterval: 1500 });
}

export const JOB = { None: 0, Funded: 1, Released: 2, Refunded: 3, Failed: 4, Delivered: 5, Disputed: 6 } as const;

/**
 * Escrow v2's own events and every custom error, copied verbatim from
 * contracts/src/ICountersignedEscrow.sol (#164). Funded, Released and Refunded are unchanged,
 * so the v1 ABI still decodes them on both versions.
 */
export const ESCROW_V2_EXTRA = parseAbi([
  "event BondForfeited(bytes32 indexed jobId, address indexed buyer, uint256 bond)",
  "event TermsSet(address indexed payee, bytes32 indexed offerHash, uint256 price, uint256 bond, uint64 reviewWindow, uint64 minDuration)",
  "event DeliveryFailed(bytes32 indexed jobId, address indexed buyer, uint256 amount, uint256 bond)",
  "event Delivered(bytes32 indexed jobId, bytes32 indexed slipHash, uint64 deliveredAt, uint64 reviewEndsAt)",
  "event Accepted(bytes32 indexed jobId, address indexed buyer)",
  "event WindowElapsed(bytes32 indexed jobId)",
  "event Disputed(bytes32 indexed jobId, address indexed buyer)",
  "event TollSwept(address indexed treasury, uint256 amount)",
  "error ZeroAddress()",
  "error ZeroAmount()",
  "error TollTooHigh(uint16 tollBps)",
  "error DeadlineInPast(uint64 deadline)",
  "error JobExists(bytes32 jobId)",
  "error CountersignatureMismatch(bytes32 jobId)",
  "error TransferShortfall(bytes32 jobId)",
  "error NotFunded(bytes32 jobId)",
  "error DeadlinePassed(bytes32 jobId, uint64 deadline)",
  "error DeadlineNotReached(bytes32 jobId, uint64 deadline)",
  "error NotPayee(bytes32 jobId)",
  "error NotArbiter()",
  "error BondMissing(address payee, uint256 requested, uint256 available)",
  "error TermsMismatch(bytes32 jobId)",
  "error BondTooHigh(uint256 bond, uint256 price)",
  "error BondNeedsWindow()",
  "error BondNeedsDuration()",
  "error BadPayee(address payee)",
  "error ReviewTooLong(uint64 reviewWindow)",
  "error SettleWindowClosed(bytes32 jobId, uint256 settleBy)",
  "error SettleWindowOpen(bytes32 jobId, uint256 settleBy)",
  "error NotBuyer(bytes32 jobId)",
  "error NotDelivered(bytes32 jobId)",
  "error ReviewOpen(bytes32 jobId, uint64 endsAt)",
  "error ReviewClosed(bytes32 jobId, uint64 endsAt)",
  "error NotOpen(bytes32 jobId)",
  "error LockMissing(bytes32 jobId)",
  "error ReleaseNeedsArbiter(bytes32 jobId)",
  "error StatusMismatch(bytes32 jobId, uint8 status)",
]);

/** The v2 interface's Job struct, unchanged from v1 but read through v2's own declaration. */
const ESCROW_V2_JOB = parseAbi([
  "function jobOf(bytes32 jobId) view returns ((address buyer, uint64 deadline, uint8 status, address payee, uint256 amount, bytes32 offerHash, bytes32 slipHash))",
]);

const TOLL_ACCRUED = parseAbi(["function tollAccrued() view returns (uint256)"]);
const DISPUTE_WINDOW = parseAbi(["function DISPUTE_WINDOW() view returns (uint64)"]);
const ARBITER = parseAbi(["function arbiter() view returns (address)"]);

/** The ABI a call or error decode uses: v1 alone, or v1 plus v2's events, errors and functions. */
function abiFor(net: EvmNetwork): Abi {
  return net.escrowVersion === 2 ? ([...escrowAbi, ...ESCROW_V2_EXTRA, ...escrowV2Abi] as Abi) : (escrowAbi as Abi);
}

export interface JobRecord {
  buyer: Address;
  deadline: bigint;
  status: number;
  payee: Address;
  amount: bigint;
  offerHash: Hex;
  slipHash: Hex;
}

export async function jobOf(net: EvmNetwork, jobId: Hex): Promise<JobRecord> {
  const job = (await reader(net).readContract({
    address: net.escrow,
    abi: net.escrowVersion === 2 ? ESCROW_V2_JOB : escrowAbi,
    functionName: "jobOf",
    args: [jobId],
  })) as unknown as JobRecord;
  return { ...job, status: Number(job.status) };
}

export function tollOf(net: EvmNetwork, amount: bigint): Promise<bigint> {
  return reader(net).readContract({
    address: net.escrow,
    abi: escrowAbi,
    functionName: "tollOf",
    args: [amount],
  }) as Promise<bigint>;
}

/** Toll the escrow has accrued and not yet swept. v1 pays it to the treasury at release instead. */
export function tollAccruedOf(net: EvmNetwork): Promise<bigint> {
  if (net.escrowVersion !== 2) throw new Error("v1 has no accrual");
  return reader(net).readContract({
    address: net.escrow,
    abi: TOLL_ACCRUED,
    functionName: "tollAccrued",
  }) as Promise<bigint>;
}

/** The settle window v2 exposes: release and failDelivery land until deadline + this; refund after. */
export function disputeWindowOf(net: EvmNetwork): Promise<bigint> {
  if (net.escrowVersion !== 2) throw new Error("v1 has no settle window");
  return reader(net).readContract({
    address: net.escrow,
    abi: DISPUTE_WINDOW,
    functionName: "DISPUTE_WINDOW",
  }) as Promise<bigint>;
}

export function treasuryOf(net: EvmNetwork): Promise<Address> {
  return reader(net).readContract({ address: net.escrow, abi: escrowAbi, functionName: "treasury" }) as Promise<Address>;
}

/** The address escrow v2 releases from, or null on v1. */
export async function arcArbiter(): Promise<Address | null> {
  if (ARC.escrowVersion !== 2) return null;
  return reader(ARC).readContract({ address: ARC.escrow, abi: ARBITER, functionName: "arbiter" }) as Promise<Address>;
}

/**
 * Why this suite's local hub cannot settle on the escrow, or null when it can. v2 releases
 * only from the escrow's arbiter, and the hub signs as the suite's own submitter.
 */
export function arbiterReason(version: 1 | 2, arbiter: Address | null, submitter: Address): string | null {
  if (version === 1 || sameAddress(arbiter, submitter)) return null;
  return `escrow v2 releases only from its arbiter ${arbiter}, and this suite's hub signs as ${submitter}`;
}

export interface Funded { jobId: Hex; offerHash: Hex; buyer: Address; payee: Address; amount: bigint; deadline: bigint }
export interface Released { jobId: Hex; slipHash: Hex; payee: Address; paid: bigint; toll: bigint }
export interface Refunded { jobId: Hex; buyer: Address; amount: bigint; byPayee: boolean }
export interface Delivered { jobId: Hex; slipHash: Hex; deliveredAt: bigint; reviewEndsAt: bigint }
export interface Accepted { jobId: Hex; buyer: Address }
export interface WindowElapsed { jobId: Hex }
export interface Disputed { jobId: Hex; buyer: Address }
export interface DeliveryFailed { jobId: Hex; buyer: Address; amount: bigint; bond: bigint }
export interface BondForfeited { jobId: Hex; buyer: Address; bond: bigint }
export interface TollSwept { treasury: Address; amount: bigint }
export interface TermsSet { payee: Address; offerHash: Hex; price: bigint; bond: bigint; reviewWindow: bigint; minDuration: bigint }

export interface EscrowEvents {
  funded: Funded[];
  released: Released[];
  refunded: Refunded[];
  delivered: Delivered[];
  accepted: Accepted[];
  windowElapsed: WindowElapsed[];
  disputed: Disputed[];
  deliveryFailed: DeliveryFailed[];
  bondForfeited: BondForfeited[];
  tollSwept: TollSwept[];
  termsSet: TermsSet[];
}

/** The escrow's own events in a receipt. Logs from any other address are ignored. */
export function escrowEvents(net: EvmNetwork, rcpt: TransactionReceipt): EscrowEvents {
  const out: EscrowEvents = {
    funded: [],
    released: [],
    refunded: [],
    delivered: [],
    accepted: [],
    windowElapsed: [],
    disputed: [],
    deliveryFailed: [],
    bondForfeited: [],
    tollSwept: [],
    termsSet: [],
  };
  for (const log of rcpt.logs) {
    if (getAddress(log.address) !== getAddress(net.escrow)) continue;
    try {
      const ev = decodeEventLog({ abi: escrowAbi, data: log.data, topics: log.topics });
      const args = ev.args as unknown as Record<string, unknown>;
      if (ev.eventName === "Funded") out.funded.push(args as unknown as Funded);
      if (ev.eventName === "Released") out.released.push(args as unknown as Released);
      if (ev.eventName === "Refunded") out.refunded.push(args as unknown as Refunded);
    } catch {
      // not a v1 escrow event
    }
    if (net.escrowVersion !== 2) continue;
    try {
      const ev = decodeEventLog({ abi: ESCROW_V2_EXTRA, data: log.data, topics: log.topics });
      const args = ev.args as unknown as Record<string, unknown>;
      if (ev.eventName === "Delivered") out.delivered.push(args as unknown as Delivered);
      if (ev.eventName === "Accepted") out.accepted.push(args as unknown as Accepted);
      if (ev.eventName === "WindowElapsed") out.windowElapsed.push(args as unknown as WindowElapsed);
      if (ev.eventName === "Disputed") out.disputed.push(args as unknown as Disputed);
      if (ev.eventName === "DeliveryFailed") out.deliveryFailed.push(args as unknown as DeliveryFailed);
      if (ev.eventName === "BondForfeited") out.bondForfeited.push(args as unknown as BondForfeited);
      if (ev.eventName === "TollSwept") out.tollSwept.push(args as unknown as TollSwept);
      if (ev.eventName === "TermsSet") out.termsSet.push(args as unknown as TermsSet);
    } catch {
      // not a v2 escrow event
    }
  }
  return out;
}

export interface Transfer { from: Address; to: Address; value: bigint }

/** The stablecoin's Transfer events in a receipt. */
export function tokenTransfers(net: EvmNetwork, rcpt: TransactionReceipt): Transfer[] {
  const out: Transfer[] = [];
  for (const log of rcpt.logs) {
    if (getAddress(log.address) !== getAddress(net.token)) continue;
    try {
      const ev = decodeEventLog({ abi: erc20Abi, data: log.data, topics: log.topics });
      if (ev.eventName === "Transfer") out.push(ev.args as unknown as Transfer);
    } catch {
      // not a Transfer
    }
  }
  return out;
}

export interface Revert {
  errorName: string;
  args: readonly unknown[];
}

/**
 * Replay an escrow call as eth_call from `account`. Null when it would succeed; otherwise
 * the custom error the contract reverts with.
 */
export async function revertOf(
  net: EvmNetwork,
  account: Address,
  functionName: "fund" | "release" | "refund" | "cancel",
  args: readonly unknown[],
): Promise<Revert | null> {
  try {
    await reader(net).simulateContract({
      address: net.escrow,
      abi: abiFor(net),
      functionName,
      args: args as never,
      account,
    });
    return null;
  } catch (e) {
    if (e instanceof BaseError) {
      const reverted = e.walk((x) => x instanceof ContractFunctionRevertedError);
      if (reverted instanceof ContractFunctionRevertedError && reverted.data?.errorName) {
        return { errorName: reverted.data.errorName, args: (reverted.data.args ?? []) as readonly unknown[] };
      }
    }
    throw e;
  }
}

/** Wait until the chain's latest block is strictly after `ts` (unix seconds). Returns that block's time. */
export async function waitChainTimePast(net: EvmNetwork, ts: bigint, timeoutMs: number): Promise<bigint> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const block = await reader(net).getBlock({ blockTag: "latest" });
    if (block.timestamp > ts) return block.timestamp;
    if (Date.now() > until) throw new Error(`chain time ${block.timestamp} still not past ${ts} after ${timeoutMs / 1000} s`);
    const wait = Number(ts - block.timestamp) * 1000;
    await sleep(Math.min(Math.max(wait, 1000), 5000));
  }
}

export function sameAddress(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false;
  try {
    return getAddress(a) === getAddress(b);
  } catch {
    return false;
  }
}
