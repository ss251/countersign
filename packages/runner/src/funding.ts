/**
 * Before the runner starts work on an escrow order it checks that someone really paid.
 *
 * The hub writes the order, so the order alone proves nothing: a hub could fund one atomic unit,
 * dispatch an order that claims the full price, and collect the work and a slip signed by this
 * runner. On an escrow rail the runner therefore reads the job from the chain: the escrow must be
 * pinned, and jobOf(jobId) must show the job Funded, for the offer's payee, for this offer, at no
 * less than the price, with its deadline still ahead. The order's own terms are checked first, as
 * a cheap gate. Non-escrow rails settle before dispatch, so they stop at the terms check.
 */

import type { JobOrder, Offer, RailId } from "@countersign/core";
import { decodeFunctionResult, encodeFunctionData, type Address, type Hex } from "viem";

export const ARC_TESTNET = 5042002;
export const WHITECHAIN_TESTNET = 1874;
/** Arc testnet's public RPC, the CLI's default for chain 5042002. */
export const ARC_RPC_URL = "https://rpc.testnet.arc.network";

export interface PinnedEscrow {
  chainId: number;
  escrow: Address;
}

/** ICountersignedEscrow.Status. */
export const STATUS = { None: 0, Funded: 1, Released: 2, Refunded: 3 } as const;

export interface ChainJob {
  buyer: Address;
  deadline: bigint;
  status: number;
  payee: Address;
  amount: bigint;
  offerHash: Hex;
  slipHash: Hex;
}

export type JobReader = (chainId: number, escrow: Address, jobId: Hex) => Promise<ChainJob>;

export const UNPAID = {
  terms: "Refused. The order does not match the offer's terms.",
  escrow: "Refused. The order names an escrow this runner does not know.",
  unread: "Refused. The runner could not read the job on chain.",
  notFunded: "Refused. The job is not funded on chain.",
  payee: "Refused. The job on chain pays someone else.",
  amount: "Refused. The job on chain holds less than the price.",
  offer: "Refused. The job on chain is for another offer.",
  deadline: "Refused. The job's deadline on chain has passed.",
} as const;

/** The rails that settle through a job escrow on chain. */
const ESCROW_RAILS: readonly RailId[] = ["escrow", "whitechain"];

export function isEscrowRail(rail: RailId): boolean {
  return ESCROW_RAILS.includes(rail);
}

/** The payee the offer names for a rail. */
export function payeeFor(offer: Offer, rail: RailId): string {
  return offer.payTo?.[rail] ?? offer.seller;
}

/** The order against the offer it names. A hub could still lie in both, so the chain read follows. */
export function termsRefusal(order: JobOrder, offer: Offer): string | null {
  if (!offer.rails.includes(order.rail)) return UNPAID.terms;
  if (order.amount !== offer.price) return UNPAID.terms;
  const payee = payeeFor(offer, order.rail);
  if (order.payTo.toLowerCase() !== payee.toLowerCase()) return UNPAID.terms;
  return null;
}

export interface FundingCheck {
  /** The runner's clock, in Unix seconds. */
  now: () => number;
  known: readonly PinnedEscrow[];
  read: JobReader;
  /**
   * The hub dispatches as soon as its own node has the fund, and a public node can be a block
   * behind. A job not seen yet (status None, or a failed read) is read again this many times.
   */
  retries?: number;
  retryMs?: number;
}

/** What the runner needs to check an order. The CLI builds one; tests inject a reader. */
export interface FundingConfig {
  known: readonly PinnedEscrow[];
  /** JSON-RPC endpoints per chain, used when `read` is absent. */
  rpc?: Record<number, string>;
  /** An injected reader, for tests and callers that already have one. */
  read?: JobReader;
  retries?: number;
  retryMs?: number;
}

export function fundingReader(config: FundingConfig): JobReader {
  return config.read ?? rpcJobReader(config.rpc ?? {});
}

/** Null when the job is paid for as the offer says; otherwise the sentence the hub is sent. */
export async function fundingRefusal(
  order: JobOrder,
  offer: Offer,
  check: FundingCheck,
): Promise<string | null> {
  const terms = termsRefusal(order, offer);
  if (terms) return terms;
  if (!isEscrowRail(order.rail)) return null;
  const escrow = order.escrow;
  const chainId = order.chainId;
  if (escrow === undefined || chainId === undefined) return UNPAID.escrow;
  const pinned = check.known.some(
    (entry) => entry.chainId === chainId && entry.escrow.toLowerCase() === escrow.toLowerCase(),
  );
  if (!pinned) return UNPAID.escrow;

  const retries = check.retries ?? 4;
  let job: ChainJob | null = null;
  for (let attempt = 0; ; attempt++) {
    try {
      job = await check.read(chainId, escrow, order.jobId);
    } catch {
      job = null;
    }
    // Released and Refunded are final; only a job not seen yet is worth reading again.
    if (job !== null && job.status !== STATUS.None) break;
    if (attempt >= retries) return job === null ? UNPAID.unread : UNPAID.notFunded;
    await new Promise((resolve) => setTimeout(resolve, check.retryMs ?? 750));
  }
  if (job.status !== STATUS.Funded) return UNPAID.notFunded;
  const payee = payeeFor(offer, order.rail);
  if (job.payee.toLowerCase() !== payee.toLowerCase()) return UNPAID.payee;
  if (job.amount < BigInt(offer.price)) return UNPAID.amount;
  if (job.offerHash.toLowerCase() !== order.offerHash.toLowerCase()) return UNPAID.offer;
  if (job.deadline <= BigInt(check.now())) return UNPAID.deadline;
  return null;
}

const JOB_OF = [
  {
    type: "function",
    name: "jobOf",
    stateMutability: "view",
    inputs: [{ name: "jobId", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "buyer", type: "address" },
          { name: "deadline", type: "uint64" },
          { name: "status", type: "uint8" },
          { name: "payee", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "offerHash", type: "bytes32" },
          { name: "slipHash", type: "bytes32" },
        ],
      },
    ],
  },
] as const;

/** Reads ICountersignedEscrow.jobOf with one eth_call over the chain's RPC. */
export function rpcJobReader(
  rpc: Record<number, string>,
  fetchImpl: typeof fetch = fetch,
): JobReader {
  return async (chainId, escrow, jobId) => {
    const url = rpc[chainId];
    if (!url) throw new Error(`No RPC for chain ${chainId}.`);
    const data = encodeFunctionData({ abi: JOB_OF, functionName: "jobOf", args: [jobId] });
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [{ to: escrow, data }, "latest"],
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`The RPC answered ${response.status}.`);
    const body = (await response.json()) as { result?: unknown; error?: { message?: string } };
    if (typeof body.result !== "string" || !body.result.startsWith("0x")) {
      throw new Error(body.error?.message ?? "The RPC returned no result.");
    }
    const job = decodeFunctionResult({ abi: JOB_OF, functionName: "jobOf", data: body.result as Hex });
    return { ...job, status: Number(job.status) };
  };
}
