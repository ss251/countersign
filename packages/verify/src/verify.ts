/**
 * Verify a slip with nothing but the slip itself and, optionally, a public RPC.
 * No hub, no database, no network unless asked: a slip proves itself.
 */

import {
  createPublicClient,
  getAddress,
  type Hex,
  http,
  isAddress,
  isHex,
  parseAbi,
  parseAbiItem,
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

export async function verifySlip(slip: Slip, opts: { rpcUrl?: string } = {}): Promise<Verdict> {
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
    await checkSlipHash(slip, opts.rpcUrl, add);
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

async function checkSlipHash(
  slip: Slip,
  rpcUrl: string,
  add: (c: string, ok: boolean, d: string) => void,
): Promise<void> {
  const body = slip.body;
  const escrow = body.escrow;
  if (!escrow) {
    add("slip hash", false, "the slip has no escrow address to read");
    return;
  }
  const commit = slipCommitHash(body);
  try {
    const client = createPublicClient({ transport: http(rpcUrl) });
    const logs = await releasedLogs(client, slip, escrow);
    if (logs.length === 0) {
      add("slip hash", false, `event missing: no Released event for job ${body.jobId} on ${escrow}`);
      return;
    }
    if (logs.length !== 1) {
      add("slip hash", false, `expected one Released event for job ${body.jobId}, found ${logs.length}`);
      return;
    }
    const event = logs[0]!;
    const eventHash = event.args.slipHash;
    if (!eventHash || eventHash.toLowerCase() !== commit.toLowerCase()) {
      add("slip hash", false, `the event hash ${eventHash ?? "missing"} differs from the recomputed hash ${commit}`);
      return;
    }
    const job = await client.readContract({
      address: escrow,
      abi: jobOfAbi,
      functionName: "jobOf",
      args: [body.jobId],
    });
    if (job.status !== 2) {
      add("slip hash", false, `jobOf says status ${job.status}, not Released (2)`);
      return;
    }
    if (job.slipHash.toLowerCase() !== commit.toLowerCase()) {
      add("slip hash", false, `jobOf holds slip hash ${job.slipHash}, not the recomputed hash ${commit}`);
      return;
    }
    add(
      "slip hash",
      true,
      `the chain holds this slip's hash: Released(${body.jobId}, ${commit}) in block ${event.blockNumber}, tx ${event.transactionHash}`,
    );
  } catch (e) {
    add("slip hash", false, `could not read the Released event: ${(e as Error).message.split("\n")[0]}`);
  }
}

async function releasedLogs(client: PublicClient, slip: Slip, escrow: `0x${string}`) {
  const body = slip.body;
  const tx = slip.settlement.transaction;
  let fromBlock: bigint;
  let toBlock: bigint;
  if (isHex(tx) && tx.length === 66) {
    const receipt = await client.getTransactionReceipt({ hash: tx as Hex });
    fromBlock = receipt.blockNumber;
    toBlock = receipt.blockNumber;
  } else {
    const latest = await client.getBlockNumber();
    for (let i = 0; i < MAX_WINDOWS; i++) {
      toBlock = latest - BigInt(i) * WINDOW;
      if (toBlock < 0n) return [];
      fromBlock = toBlock >= WINDOW - 1n ? toBlock - (WINDOW - 1n) : 0n;
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
  return client.getLogs({
    address: escrow,
    event: releasedEvent,
    args: { jobId: body.jobId },
    fromBlock,
    toBlock,
  });
}
