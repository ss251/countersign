/**
 * Escrow v2: the buyer accepts a delivered job, or disputes a job for a refund.
 *
 * The signature is made under the escrow domain of a rail this agent pins, never one a hub
 * names. Accept signs the slip hash of a slip this agent holds and checks itself. The hub
 * relays the signature so the buyer pays no gas; the escrow checks it again on chain.
 */
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  type Address,
  type Hex,
  type LocalAccount,
  type Transport,
} from "viem";
import {
  acceptTypedData,
  disputeTypedData,
  jobIdOf,
  slipHash,
  slipSigner,
  type CountersignPayload,
  type Slip,
} from "@countersign/core";
import type { HubClient } from "./hub-client.ts";
import type { Journal, JournalEntry } from "./journal.ts";
import { KNOWN_RAILS, type KnownRail } from "./known-rails.ts";
import { JOB_OF_ABI } from "./resume.ts";
import type { State } from "./state.ts";

export class ReviewError extends Error {
  override name = "ReviewError";
}

/** The agent's own key. */
export type ReviewSigner = Pick<LocalAccount, "address" | "signTypedData">;

/** A job as the escrow reports it: who funded it, and its status number. */
export type JobReader = (rail: KnownRail, jobId: Hex) => Promise<{ buyer: Address; status: number }>;

export interface ReviewArgs {
  hub: HubClient;
  journal: Journal;
  state: State;
  signer: ReviewSigner;
  jobId: Hex;
  now: number;
  known?: KnownRail[];
  readJob?: JobReader;
  /** When the hub does not relay a dispute, send dispute(jobId, "") from the agent's key. */
  direct?: boolean;
  /** The agent's full key, needed to send a direct dispute. The CLI passes it; tests inject a transport. */
  account?: LocalAccount;
  /** Test hook: the transport the direct dispute is sent over. Defaults to the rail's own RPC. */
  transport?: Transport;
}

export interface ReviewResult {
  jobId: Hex;
  escrow: Address;
  chainId: number;
  signature: Hex;
  /** The tx that carried a direct dispute, when the hub did not relay it. */
  transaction?: Hex;
}

/** Escrow v2's dispute(jobId, buyerSig): the buyer itself may submit with an empty signature. */
const DISPUTE_ABI = [
  {
    type: "function",
    name: "dispute",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "bytes32" },
      { name: "buyerSig", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

/** Escrow v2 statuses a dispute can apply to: Funded (1) and Delivered (5). */
const DISPUTABLE = new Set([1, 5]);

/**
 * Accept a delivered job: sign Accept(jobId, slipHash) for the slip this agent holds, then
 * hand it to the hub to relay. Refuses unless the slip checks out here first.
 */
export async function acceptJob(a: ReviewArgs): Promise<ReviewResult> {
  const jobId = a.jobId.toLowerCase() as Hex;
  const slip = heldSlip(a, jobId);
  const known = a.known ?? KNOWN_RAILS;

  if (slip.hash.toLowerCase() !== slipHash(slip.body).toLowerCase()) refuse("The slip's hash does not match its body.");
  let seller: Address;
  try {
    seller = await slipSigner(slip);
  } catch {
    refuse("The slip's seller signature does not parse.");
  }
  if (getAddress(seller) !== getAddress(slip.body.seller)) refuse("The slip is not signed by its seller.");
  if (slip.body.jobId.toLowerCase() !== jobId) refuse("The slip is for another job.");
  if (getAddress(slip.body.buyer) !== getAddress(a.signer.address)) refuse("The slip names another buyer.");
  if (!slip.body.escrow || slip.body.chainId === undefined) refuse("The slip is not for an escrow job.");

  const rail = pinned(known, slip.body.chainId, slip.body.escrow);
  if (!rail) refuse("The slip's escrow is not one this agent pins.");

  // The buyer's own countersignature in the slip must derive this jobId under this escrow,
  // so the decision is signed for the escrow the money actually went to.
  const terms = (slip.payment?.payload as unknown as Partial<CountersignPayload> | undefined)?.terms;
  if (!terms || jobIdOf(terms, rail.chainId, rail.escrow).toLowerCase() !== jobId) {
    refuse("The slip's countersigned terms do not derive this job on that escrow.");
  }

  const signature = await a.signer.signTypedData(acceptTypedData(rail.chainId, rail.escrow, jobId, slip.hash));
  await a.hub.acceptJob(jobId, signature);
  a.journal.append({ ...record(a, jobId, entriesFor(a.journal, jobId)), kind: "accepted", slipHash: slip.hash });
  return { jobId, escrow: rail.escrow, chainId: rail.chainId, signature };
}

/**
 * Dispute a job: sign Dispute(jobId) under the escrow it was funded on, then hand it to the
 * hub to relay. The budget comes back only when `resume` sees the refund on chain.
 */
export async function disputeJob(a: ReviewArgs): Promise<ReviewResult> {
  const jobId = a.jobId.toLowerCase() as Hex;
  const known = a.known ?? KNOWN_RAILS;
  const entries = entriesFor(a.journal, jobId);
  if (entries.length === 0) refuse("This agent's journal has no such job.");

  const rail = await fundedOn(a, jobId, entries, known);
  const signature = await a.signer.signTypedData(disputeTypedData(rail.chainId, rail.escrow, jobId));
  let transaction: Hex | undefined;
  try {
    await a.hub.disputeJob(jobId, signature);
  } catch (error) {
    if (!a.direct) throw error;
    transaction = await submitDispute(a, rail, jobId);
  }
  a.journal.append({
    ...record(a, jobId, entries),
    kind: "disputed",
    ...(transaction !== undefined ? { closeTx: transaction } : {}),
  });
  return {
    jobId,
    escrow: rail.escrow,
    chainId: rail.chainId,
    signature,
    ...(transaction !== undefined ? { transaction } : {}),
  };
}

/**
 * Submit dispute(jobId, "") from the agent's own key, which makes msg.sender the buyer.
 * Used only with --direct, and only when the hub would not relay the signed dispute.
 */
async function submitDispute(a: ReviewArgs, rail: KnownRail, jobId: Hex): Promise<Hex> {
  const account = a.account;
  if (!account) refuse("The agent key is not available to send the dispute itself.");
  return sendDispute(rail, jobId, account, a.transport);
}

/** The viem wallet client that carries a direct dispute on the pinned rail's RPC. */
export async function sendDispute(
  rail: KnownRail,
  jobId: Hex,
  account: LocalAccount,
  transport?: Transport,
): Promise<Hex> {
  const chain = defineChain({
    id: rail.chainId,
    name: `rpc-${rail.chainId}`,
    nativeCurrency: { name: "native", symbol: "NATIVE", decimals: 18 },
    rpcUrls: { default: { http: [rail.rpcUrl] } },
  });
  const wallet = createWalletClient({
    chain,
    transport: transport ?? http(rail.rpcUrl),
    account,
  });
  return wallet.writeContract({
    address: rail.escrow,
    abi: DISPUTE_ABI,
    functionName: "dispute",
    args: [jobId, "0x"],
  });
}

/** Read a job from a pinned escrow on chain. */
export async function readJob(rail: KnownRail, jobId: Hex): Promise<{ buyer: Address; status: number }> {
  const client = createPublicClient({ transport: http(rail.rpcUrl) });
  const job = await client.readContract({ address: rail.escrow, abi: JOB_OF_ABI, functionName: "jobOf", args: [jobId] });
  return { buyer: job.buyer, status: Number(job.status) };
}

/** The escrow the job was funded on: the one the journal recorded, or the single pinned escrow that holds it. */
async function fundedOn(a: ReviewArgs, jobId: Hex, entries: JournalEntry[], known: KnownRail[]): Promise<KnownRail> {
  const recorded = entries.find((e) => e.escrow !== undefined && e.chainId !== undefined);
  if (recorded) {
    const rail = pinned(known, recorded.chainId as number, recorded.escrow as string);
    if (!rail) refuse("The job's escrow is not one this agent pins.");
    return rail;
  }

  // Older journal lines carry no escrow. Ask each pinned escrow on the job's network.
  const network = entries.find((e) => e.network)?.network;
  const candidates = known.filter((rail) => (network ? rail.network === network : true));
  const read = a.readJob ?? readJob;
  const holding: KnownRail[] = [];
  for (const rail of candidates) {
    try {
      const job = await read(rail, jobId);
      if (getAddress(job.buyer) === getAddress(a.signer.address) && DISPUTABLE.has(job.status)) holding.push(rail);
    } catch {
      // An escrow that cannot be read is not evidence either way.
    }
  }
  if (holding.length !== 1) refuse("No single pinned escrow holds this job open for this agent.");
  return holding[0] as KnownRail;
}

function heldSlip(a: ReviewArgs, jobId: Hex): Slip {
  const entry = [...entriesFor(a.journal, jobId)].reverse().find((e) => e.slipHash);
  if (!entry?.slipHash) refuse("This agent holds no slip for this job.");
  try {
    return a.state.loadSlip(entry.slipHash);
  } catch {
    refuse("This agent holds no slip for this job.");
  }
}

function entriesFor(journal: Journal, jobId: Hex): JournalEntry[] {
  return journal.entries().filter((e) => e.jobId?.toLowerCase() === jobId);
}

function record(a: ReviewArgs, jobId: Hex, entries: JournalEntry[]): Omit<JournalEntry, "kind"> {
  const first = entries[0];
  return {
    at: a.now,
    jobId,
    offerHash: first?.offerHash ?? "",
    seller: first?.seller ?? "",
    amount: first?.amount ?? "0",
    ...(first?.network ? { network: first.network } : {}),
    ...(first?.rail ? { rail: first.rail } : {}),
  };
}

function pinned(known: KnownRail[], chainId: number, escrow: string): KnownRail | undefined {
  return known.find((rail) => rail.chainId === chainId && rail.escrow.toLowerCase() === escrow.toLowerCase());
}

function refuse(message: string): never {
  throw new ReviewError(`Refused. ${message}`);
}
