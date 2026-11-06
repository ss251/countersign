/**
 * Verify a slip with nothing but the slip itself and, optionally, a public RPC.
 * No hub, no database, no network unless asked: a slip proves itself.
 */

import {
  BaseError,
  ContractFunctionZeroDataError,
  createPublicClient,
  defineChain,
  getAddress,
  type Hex,
  http,
  isAddress,
  isHex,
  parseAbi,
  parseAbiItem,
  parseEventLogs,
  type PublicClient,
} from "viem";
import {
  checkCountersign,
  type CountersignExtra,
  type CountersignPayload,
  jobIdOf,
  type Slip,
  slipCommitHash,
  slipHash,
  slipSigner,
} from "@countersign/core";
import { KNOWN_ESCROWS, type KnownEscrow } from "./known-escrows.ts";

export interface Finding {
  check: string;
  ok: boolean;
  detail: string;
}

export interface Verdict {
  /** Every check that ran passed. Says nothing about checks listed in `skipped`. */
  valid: boolean;
  findings: Finding[];
  /** Checks that did not run, in words a person reads. Settlement is only claimed when it was read. */
  skipped: string[];
}

const releasedEvent = parseAbiItem(
  "event Released(bytes32 indexed jobId, bytes32 indexed slipHash, address indexed payee, uint256 paid, uint256 toll)",
);

const jobOfAbi = parseAbi([
  "function jobOf(bytes32 jobId) view returns ((address buyer, uint64 deadline, uint8 status, address payee, uint256 amount, bytes32 offerHash, bytes32 slipHash))",
]);

const WINDOW = 10_000n;
const MAX_WINDOWS = 50;

export interface VerifyOptions {
  rpcUrl?: string;
  /** The escrow deployments to trust; defaults to the deployments this package knows. */
  knownEscrows?: readonly KnownEscrow[];
}

export async function verifySlip(slip: Slip, opts: VerifyOptions = {}): Promise<Verdict> {
  const findings: Finding[] = [];
  const skipped: string[] = [];
  const add = (check: string, ok: boolean, detail: string) => findings.push({ check, ok, detail });
  const body = slip.body;

  const hash = slipHash(body);
  add("hash", hash === slip.hash, hash === slip.hash ? `slip hash ${hash}` : `body hashes to ${hash}, slip says ${slip.hash}`);

  try {
    const signer = await slipSigner(slip);
    const ok = signer === getAddress(body.seller);
    add("seller", ok, ok ? `signed by the seller ${signer}` : `signed by ${signer}, not the seller ${body.seller}`);
  } catch (e) {
    add("seller", false, `seller signature does not parse: ${(e as Error).message.split("\n")[0]}`);
  }

  if (slip.payment.accepted.scheme === "countersign") {
    await checkCountersigned(slip, add);
  } else {
    add("countersignature", true, `rail ${body.rail} pays by ${slip.payment.accepted.scheme}; its payment is checked by its settlement`);
  }

  if (opts.rpcUrl && body.escrow) {
    checkEscrow(body.escrow, body.chainId, opts.knownEscrows ?? KNOWN_ESCROWS, add);
    await checkOnchain(slip, opts.rpcUrl, add);
  } else if (opts.rpcUrl) {
    add("onchain", true, `rail ${body.rail} has no escrow event to check`);
  } else {
    skipped.push("onchain: not checked. Pass an RPC URL to read the Released event from the chain.");
  }

  return { valid: findings.every((f) => f.ok), findings, skipped };
}

async function checkCountersigned(slip: Slip, add: (c: string, ok: boolean, d: string) => void): Promise<void> {
  const body = slip.body;
  const p = slip.payment.payload as unknown as CountersignPayload;
  const extra = slip.payment.accepted.extra as unknown as CountersignExtra | undefined;
  if (!extra || !p?.terms || !p.authorization || !body.escrow || body.chainId === undefined) {
    add("countersignature", false, "the slip carries no countersignature to check");
    return;
  }
  const t = p.terms;
  const bound =
    t.offerHash.toLowerCase() === body.offerHash.toLowerCase() &&
    t.amount === body.amount &&
    getAddress(t.payee) === getAddress(body.payTo) &&
    getAddress(t.buyer) === getAddress(body.buyer);
  const jobId = jobIdOf(t, body.chainId, body.escrow);
  add(
    "terms",
    bound && jobId.toLowerCase() === body.jobId.toLowerCase(),
    bound ? `the buyer agreed to this offer, payee and amount (job ${jobId})` : "the countersigned terms differ from the slip",
  );
  if (!isAddress(body.asset)) {
    add("countersignature", false, `asset ${body.asset} is not a token address`);
    return;
  }
  const check = await checkCountersign(p, {
    chainId: body.chainId,
    escrow: body.escrow,
    token: body.asset,
    tokenName: extra.tokenName,
    tokenVersion: extra.tokenVersion,
    // A signature does not expire after the fact: check it at a moment inside its window.
    now: Number(p.authorization.validAfter) + 1,
  });
  add(
    "countersignature",
    check.ok,
    check.ok ? `countersigned by the buyer ${check.buyer}` : check.message,
  );
}

function checkEscrow(
  escrow: `0x${string}`,
  chainId: number | undefined,
  knownEscrows: readonly KnownEscrow[],
  add: (c: string, ok: boolean, d: string) => void,
): void {
  const chain = chainId ?? 0;
  const known = knownEscrows.find(
    (e) => e.chainId === chain && e.escrow.toLowerCase() === escrow.toLowerCase(),
  );
  if (known) {
    add("escrow", true, `known escrow: ${known.name}`);
    return;
  }
  add("escrow", false, `unknown escrow ${escrow} on chain ${chain}: not a countersign deployment this verifier knows`);
}

async function checkOnchain(
  slip: Slip,
  rpcUrl: string,
  add: (c: string, ok: boolean, d: string) => void,
): Promise<void> {
  const body = slip.body;
  const escrow = body.escrow;
  if (!escrow) {
    add("onchain", false, "the slip has no escrow address to read");
    return;
  }
  const commit = slipCommitHash(body);
  try {
    const chain = defineChain({
      id: body.chainId ?? 0,
      name: `chain ${body.chainId ?? 0}`,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    });
    const client = createPublicClient({ chain, transport: http(rpcUrl) });
    const rpcChainId = await client.getChainId();
    if (rpcChainId !== body.chainId) {
      add("onchain", false, `the RPC answers as chain ${rpcChainId}, the slip names chain ${body.chainId}`);
      return;
    }
    const logs = await releasedLogs(client, slip, escrow);
    if (logs.length === 0) {
      add("onchain", false, `event missing: no Released event for job ${body.jobId} on ${escrow}`);
      return;
    }
    if (logs.length !== 1) {
      add("onchain", false, `expected one Released event for job ${body.jobId}, found ${logs.length}`);
      return;
    }
    const event = logs[0]!;
    const eventHash = event.args.slipHash;
    if (!eventHash || eventHash.toLowerCase() !== commit.toLowerCase()) {
      add("onchain", false, `the event hash ${eventHash ?? "missing"} differs from the recomputed hash ${commit}`);
      return;
    }
    try {
      const job = await client.readContract({
        address: escrow,
        abi: jobOfAbi,
        functionName: "jobOf",
        args: [body.jobId],
      });
      if (job.status !== 2) {
        add("onchain", false, `jobOf says status ${job.status}, not Released (2)`);
        return;
      }
      if (job.slipHash.toLowerCase() !== commit.toLowerCase()) {
        add("onchain", false, `jobOf holds slip hash ${job.slipHash}, not the recomputed hash ${commit}`);
        return;
      }
    } catch (e) {
      // A node that cannot answer jobOf (a stub, or an address that is not the escrow) still
      // has to prove the hash: the Released event is the primary proof. Any answer is enforced.
      if (!isZeroData(e)) throw e;
    }
    add(
      "onchain",
      true,
      `the chain holds this slip's hash: Released(${body.jobId}, ${commit}) in block ${event.blockNumber}, tx ${event.transactionHash}`,
    );
  } catch (e) {
    add("onchain", false, `could not read the Released event: ${(e as Error).message.split("\n")[0]}`);
  }
}

function isZeroData(e: unknown): boolean {
  if (e instanceof ContractFunctionZeroDataError) return true;
  if (!(e instanceof BaseError)) return false;
  return Boolean(e.walk((err) => err instanceof ContractFunctionZeroDataError));
}

interface ReleasedLog {
  args: { slipHash?: Hex };
  blockNumber: bigint | null;
  transactionHash: Hex;
}

async function releasedLogs(client: PublicClient, slip: Slip, escrow: `0x${string}`): Promise<ReleasedLog[]> {
  const body = slip.body;
  const tx = slip.settlement.transaction;
  if (isHex(tx) && tx.length === 66) {
    const receipt = await client.getTransactionReceipt({ hash: tx as Hex });
    const fromReceipt = parseEventLogs({
      abi: [releasedEvent],
      eventName: "Released",
      args: { jobId: body.jobId },
      logs: receipt.logs.filter((log) => getAddress(log.address) === getAddress(escrow)),
    });
    try {
      const logs = await client.getLogs({
        address: escrow,
        event: releasedEvent,
        args: { jobId: body.jobId },
        fromBlock: receipt.blockNumber,
        toBlock: receipt.blockNumber,
      });
      if (logs.length > 0) return logs;
    } catch {
      // Some nodes serve receipts but not getLogs; the receipt is the record of this tx.
    }
    return fromReceipt;
  }
  const latest = await client.getBlockNumber();
  for (let i = 0; i < MAX_WINDOWS; i++) {
    const toBlock = latest - BigInt(i) * WINDOW;
    if (toBlock < 0n) return [];
    const fromBlock = toBlock >= WINDOW - 1n ? toBlock - (WINDOW - 1n) : 0n;
    const logs = await client.getLogs({
      address: escrow,
      event: releasedEvent,
      args: { jobId: body.jobId },
      fromBlock,
      toBlock,
    });
    if (logs.length > 0) return logs;
  }
  return [];
}
