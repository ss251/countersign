/**
 * Before the phone reads its position or asks for a photo, it checks that someone really paid.
 *
 * The hub writes the order, so the order alone proves nothing: a hub could fund a job at one
 * atomic unit, dispatch an order that claims the full price, and collect the work and a slip
 * signed by this phone. On the escrow rail the phone therefore reads the job from the chain:
 * the escrow must be a known CountersignedEscrow (a hub cannot name a contract of its own), and
 * jobOf(jobId) must show the job Funded, for this seller, for this offer, at no less than the
 * price, with its deadline still ahead. The order's own terms are checked first, as a cheap gate.
 */

import { createPublicClient, http, type Address, type Hex } from "viem";
import type { JobOrder, Offer } from "@countersign/core";

export const ARC_TESTNET = 5042002;
/** Arc testnet USDC, the asset both phone offers are paid in. */
export const ARC_USDC = "0x3600000000000000000000000000000000000000";

/** Public RPC per chain. Arc's answers browser requests from any origin. */
export const RPC: Record<number, string> = { [ARC_TESTNET]: "https://rpc.testnet.arc.network" };

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
  escrow: "Refused. The order names an escrow this phone does not know.",
  unread: "Refused. The phone could not read the job on chain.",
  notFunded: "Refused. The job is not funded on chain.",
  payee: "Refused. The job on chain pays someone else.",
  amount: "Refused. The job on chain holds less than the price.",
  offer: "Refused. The job on chain is for another offer.",
  deadline: "Refused. The job's deadline on chain has passed.",
} as const;

/** The order against the offer it names. A hub could still lie in both, so the chain read follows. */
export function termsRefusal(order: JobOrder, offer: Offer): string | null {
  if (!offer.rails.includes(order.rail)) return UNPAID.terms;
  if (order.amount !== offer.price) return UNPAID.terms;
  const payee = offer.payTo?.[order.rail] ?? offer.seller;
  if (order.payTo.toLowerCase() !== payee.toLowerCase()) return UNPAID.terms;
  if (order.rail === "escrow") {
    if (order.network !== `eip155:${ARC_TESTNET}` || order.chainId !== ARC_TESTNET) return UNPAID.terms;
    if (order.asset.toLowerCase() !== ARC_USDC) return UNPAID.terms;
  }
  return null;
}

export interface FundingCheck {
  seller: Address;
  /** Unix seconds. */
  now: number;
  known: readonly PinnedEscrow[];
  read: JobReader;
  /**
   * The hub dispatches as soon as its own node has the fund, and a public node can be a block
   * behind. A job not seen yet (status None, or a failed read) is read again this many times.
   */
  retries?: number;
  retryMs?: number;
}

/** Null when the job is paid for as the offer says; otherwise the sentence the hub is sent. */
export async function fundingRefusal(order: JobOrder, offer: Offer, check: FundingCheck): Promise<string | null> {
  const terms = termsRefusal(order, offer);
  if (terms) return terms;
  if (order.rail !== "escrow") return null;
  const escrow = order.escrow;
  const chainId = order.chainId;
  if (escrow === undefined || chainId === undefined) return UNPAID.escrow;
  const pinned = check.known.some((e) => e.chainId === chainId && e.escrow.toLowerCase() === escrow.toLowerCase());
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
  if (job.payee.toLowerCase() !== check.seller.toLowerCase()) return UNPAID.payee;
  if (job.amount < BigInt(offer.price)) return UNPAID.amount;
  if (job.offerHash.toLowerCase() !== order.offerHash.toLowerCase()) return UNPAID.offer;
  if (job.deadline <= BigInt(check.now)) return UNPAID.deadline;
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

/** Reads ICountersignedEscrow.jobOf over the chain's public RPC. */
export function rpcJobReader(rpc: Record<number, string> = RPC): JobReader {
  const clients = new Map<number, ReturnType<typeof createPublicClient>>();
  return async (chainId, escrow, jobId) => {
    const url = rpc[chainId];
    if (!url) throw new Error(`No RPC for chain ${chainId}.`);
    let client = clients.get(chainId);
    if (!client) {
      client = createPublicClient({ transport: http(url, { timeout: 8_000, retryCount: 1 }) });
      clients.set(chainId, client);
    }
    const job = await client.readContract({ address: escrow, abi: JOB_OF, functionName: "jobOf", args: [jobId] });
    return { ...job, status: Number(job.status) };
  };
}
