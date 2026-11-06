/**
 * Verify a slip with nothing but the slip itself and, optionally, a public RPC.
 * No hub, no database, no network unless asked: a slip proves itself.
 */

import {
  type Address,
  createPublicClient,
  decodeEventLog,
  getAddress,
  type Hex,
  http,
  isAddress,
  parseAbiItem,
} from "viem";
import {
  checkCountersign,
  type CountersignExtra,
  type CountersignPayload,
  jobIdOf,
  type Slip,
  slipHash,
  slipSigner,
} from "@countersign/core";

export interface Finding {
  check: string;
  ok: boolean;
  detail: string;
}

export interface Verdict {
  valid: boolean;
  findings: Finding[];
}

const releasedEvent = parseAbiItem(
  "event Released(bytes32 indexed jobId, bytes32 indexed slipHash, address indexed payee, uint256 paid, uint256 toll)",
);

export async function verifySlip(slip: Slip, opts: { rpcUrl?: string } = {}): Promise<Verdict> {
  const findings: Finding[] = [];
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

  if (opts.rpcUrl) {
    await checkOnchain(slip, opts.rpcUrl, add);
  }

  return { valid: findings.every((f) => f.ok), findings };
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
    token: body.asset as Address,
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

async function checkOnchain(slip: Slip, rpcUrl: string, add: (c: string, ok: boolean, d: string) => void): Promise<void> {
  const body = slip.body;
  if (!body.escrow) {
    add("onchain", true, `rail ${body.rail} has no escrow event to check`);
    return;
  }
  try {
    const client = createPublicClient({ transport: http(rpcUrl) });
    const receipt = await client.getTransactionReceipt({ hash: slip.settlement.transaction as Hex });
    const released = receipt.logs.some((log) => {
      if (getAddress(log.address) !== getAddress(body.escrow!)) return false;
      try {
        const ev = decodeEventLog({ abi: [releasedEvent], data: log.data, topics: log.topics });
        return (
          ev.args.jobId.toLowerCase() === body.jobId.toLowerCase() &&
          ev.args.slipHash.toLowerCase() === slip.hash.toLowerCase()
        );
      } catch {
        return false;
      }
    });
    const ok = receipt.status === "success" && released;
    add(
      "onchain",
      ok,
      ok
        ? `Released(job, slip) by ${body.escrow} in block ${receipt.blockNumber}`
        : `tx ${slip.settlement.transaction} does not release this slip`,
    );
  } catch (e) {
    add("onchain", false, `could not read ${slip.settlement.transaction}: ${(e as Error).message.split("\n")[0]}`);
  }
}
