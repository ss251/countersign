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
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import { escrowAbi } from "@countersign/rail";
import { sleep } from "./http.ts";

export type NetworkKey = "arc" | "whitechain" | "hedera";

export interface EvmNetwork {
  key: "arc" | "whitechain";
  label: string;
  chainId: number;
  rpc: string;
  /** The 6-decimal stablecoin the escrow holds. */
  token: Address;
  tokenSymbol: "USDC" | "USDT";
  escrow: Address;
  gasSymbol: string;
  explorer: string;
  chain: Chain;
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
  escrow: "0x19c27d770969291e6a0a305dc1be1a845e7c1b76",
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

export function explorerTx(network: NetworkKey, tx: string): string {
  if (network === "hedera") {
    // HashScan takes the SDK form, 0.0.payer@seconds.nanos.
    const dash = /^(\d+\.\d+\.\d+)-(\d+)-(\d+)$/.exec(tx);
    return `${HEDERA.hashscan}/transaction/${dash ? `${dash[1]}@${dash[2]}.${dash[3]}` : tx}`;
  }
  const net = network === "arc" ? ARC : WHITECHAIN;
  return `${net.explorer}/tx/${tx}`;
}

export function explorerAddress(network: NetworkKey, address: string): string {
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

export const JOB = { None: 0, Funded: 1, Released: 2, Refunded: 3 } as const;

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
    abi: escrowAbi,
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

export function treasuryOf(net: EvmNetwork): Promise<Address> {
  return reader(net).readContract({ address: net.escrow, abi: escrowAbi, functionName: "treasury" }) as Promise<Address>;
}

export interface Funded { jobId: Hex; offerHash: Hex; buyer: Address; payee: Address; amount: bigint; deadline: bigint }
export interface Released { jobId: Hex; slipHash: Hex; payee: Address; paid: bigint; toll: bigint }
export interface Refunded { jobId: Hex; buyer: Address; amount: bigint; byPayee: boolean }

/** The escrow's own events in a receipt. Logs from any other address are ignored. */
export function escrowEvents(net: EvmNetwork, rcpt: TransactionReceipt) {
  const out = { funded: [] as Funded[], released: [] as Released[], refunded: [] as Refunded[] };
  for (const log of rcpt.logs) {
    if (getAddress(log.address) !== getAddress(net.escrow)) continue;
    try {
      const ev = decodeEventLog({ abi: escrowAbi, data: log.data, topics: log.topics });
      const args = ev.args as unknown as Record<string, unknown>;
      if (ev.eventName === "Funded") out.funded.push(args as unknown as Funded);
      if (ev.eventName === "Released") out.released.push(args as unknown as Released);
      if (ev.eventName === "Refunded") out.refunded.push(args as unknown as Refunded);
    } catch {
      // not an escrow event
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
      abi: escrowAbi,
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
