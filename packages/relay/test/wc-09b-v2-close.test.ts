/**
 * The wc-09b corrections: a close keeps the delivery's slip hash, the review window is
 * recorded at fund, and a failed review read after a confirmed release still answers ok.
 * The chain is simulated; nothing here reaches a network.
 */

import { describe, expect, test } from "bun:test";
import { getAddress, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  authorizationTypedData,
  countersignPayload,
  type CountersignExtra,
  type CountersignTerms,
  jobIdOf,
  type Offer,
  offerHash,
} from "@countersign/core";
import { whitechainRail } from "@countersign/rail";
import { WHITECHAIN_ESCROW } from "../src/whitechain-config.ts";
import { settleCountersign } from "../src/countersign-scheme.ts";
import {
  acceptJob,
  disputeJob,
  releaseAfterWindowJob,
  releaseJob,
} from "../src/escrow-ops.ts";
import { createRelayApp } from "../src/server.ts";
import { csContext, makeOffer } from "./escrow-support.ts";
import { createTestRelay, NOW } from "./support.ts";

const V2 = getAddress("0x7777777777777777777777777777777777777777");
const SIG: Hex = `0x${"34".repeat(65)}`;
const SLIP: Hex = `0x${"51".repeat(32)}`;

type TestRelay = ReturnType<typeof createTestRelay>;

let salt = 0;
let v1Salt = 0;

/** Turn a test relay into a v2 relay: both escrows allowed, review and bond reads simulated. */
function withV2(relay: TestRelay) {
  relay.policy.allowedEscrows.push(V2);
  relay.policy.escrowV2 = V2;
  const reviews = new Map<string, readonly [bigint, bigint, bigint]>();
  const fail = { reviewRead: false };
  const read = relay.chain.readContract.bind(relay.chain);
  relay.chain.readContract = async (call) => {
    const jobId = String(call.args?.[0] ?? "").toLowerCase();
    if (call.functionName === "reviewOf") {
      if (fail.reviewRead) throw new Error("review read failed");
      return reviews.get(jobId) ?? [0n, 0n, 0n];
    }
    if (call.functionName === "bondOfJob") return 0n;
    if (call.functionName === "tollBps") return 100n;
    return read(call);
  };
  return { reviews, fail };
}

async function makeV2Body(
  relay: TestRelay,
  options: { bond?: string; reviewWindow?: number } = {},
) {
  const buyer = privateKeyToAccount(generatePrivateKey());
  relay.chain.setBalance(buyer.address, 100_000_000n);
  const offer: Offer = {
    ...makeOffer(relay.merchant.address),
    bond: options.bond ?? "0",
    ...(options.reviewWindow !== undefined ? { reviewWindow: options.reviewWindow } : {}),
  };
  const rail = whitechainRail({ relayUrl: "http://relay", version: 2, escrow: V2 });
  const req = rail.challenge(offer, { resource: "http://merchant.example/x", now: NOW });
  const extra = req.extra as unknown as CountersignExtra & { bond?: string; reviewWindow?: number };
  salt += 1;
  const terms: CountersignTerms = {
    offerHash: offerHash(offer),
    buyer: buyer.address,
    payee: getAddress(req.payTo),
    amount: req.amount,
    deadline: NOW + extra.deadlineSeconds,
    salt: String(salt),
    bond: extra.bond ?? "0",
    reviewWindow: extra.reviewWindow ?? 0,
  };
  const input = {
    terms,
    chainId: extra.chainId,
    escrow: extra.escrow,
    token: getAddress(req.asset),
    tokenName: extra.tokenName,
    tokenVersion: extra.tokenVersion,
    validAfter: 0,
    validBefore: NOW + 600,
  };
  const signature = await buyer.signTypedData(authorizationTypedData(input));
  const payload = countersignPayload(input, signature);
  const jobId: Hex = jobIdOf(terms, extra.chainId, extra.escrow);
  const body = {
    x402Version: 2,
    paymentPayload: {
      x402Version: 2,
      accepted: req,
      payload: payload as unknown as Record<string, unknown>,
      resource: { url: "http://merchant.example/x" },
    },
    paymentRequirements: req,
  };
  return { body, buyer, jobId };
}

async function fundedV2(relay: TestRelay, options: { bond?: string; reviewWindow?: number } = {}) {
  const made = await makeV2Body(relay, options);
  const result = await settleCountersign(made.body, csContext(relay));
  expect(result.success).toBe(true);
  return made;
}

async function fundedV1(relay: TestRelay) {
  const buyer = privateKeyToAccount(generatePrivateKey());
  relay.chain.setBalance(buyer.address, 100_000_000n);
  const offer: Offer = { ...makeOffer(relay.merchant.address), bond: "0" };
  const rail = whitechainRail({ relayUrl: "http://relay" });
  const req = rail.challenge(offer, { resource: "x", now: NOW });
  const extra = req.extra as unknown as CountersignExtra;
  const terms = {
    offerHash: offerHash(offer),
    buyer: buyer.address,
    payee: getAddress(req.payTo),
    amount: req.amount,
    deadline: NOW + extra.deadlineSeconds,
    salt: String(++v1Salt),
  };
  const input = {
    terms,
    chainId: extra.chainId,
    escrow: extra.escrow,
    token: getAddress(req.asset),
    tokenName: extra.tokenName,
    tokenVersion: extra.tokenVersion,
    validAfter: 0,
    validBefore: NOW + 600,
  };
  const signature = await buyer.signTypedData(authorizationTypedData(input));
  const payload = countersignPayload(input, signature);
  const jobId: Hex = jobIdOf(terms, extra.chainId, extra.escrow);
  const body = {
    x402Version: 2,
    paymentPayload: {
      x402Version: 2,
      accepted: req,
      payload: payload as unknown as Record<string, unknown>,
      resource: "http://merchant.example/x",
    },
    paymentRequirements: req,
  };
  const result = await settleCountersign(body, csContext(relay));
  expect(result.success).toBe(true);
  return { jobId };
}

// On v2 only the arbiter (the relay) may release, and only on the hub's word (orch-cs 19:44:14Z),
// so these releases come from the hub and carry its bearer token.
const HUB_TOKEN = "a-hub-token-long-enough";

function appFor(relay: TestRelay) {
  return createRelayApp({
    reader: relay.chain,
    relayer: relay.relayer,
    ledger: relay.ledger,
    now: () => NOW,
    config: { hubToken: HUB_TOKEN },
  });
}

function post(app: ReturnType<typeof createRelayApp>, path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${HUB_TOKEN}` },
    body: JSON.stringify(body),
  });
}

async function deliveredWithSlip(relay: TestRelay, reads: ReturnType<typeof withV2>, reviewWindow: number) {
  const made = await fundedV2(relay, { reviewWindow });
  reads.reviews.set(made.jobId.toLowerCase(), [
    BigInt(reviewWindow),
    BigInt(NOW),
    BigInt(NOW + reviewWindow),
  ]);
  const result = await releaseJob({ jobId: made.jobId, slipHash: SLIP, sellerSig: SIG }, csContext(relay));
  expect(result).toMatchObject({ ok: true, status: "delivered" });
  expect(relay.ledger.getJob(made.jobId)!.slipHash).toBe(SLIP);
  return made;
}

describe("the slip hash survives a close from delivered", () => {
  for (const [name, run, expected] of [
    ["accept", (jobId: string, relay: TestRelay) => acceptJob({ jobId, buyerSig: SIG }, csContext(relay)), "released"],
    [
      "releaseAfterWindow",
      (jobId: string, relay: TestRelay) => releaseAfterWindowJob({ jobId }, csContext(relay)),
      "released",
    ],
    ["dispute", (jobId: string, relay: TestRelay) => disputeJob({ jobId, status: 5, buyerSig: SIG }, csContext(relay)), "disputed"],
  ] as const) {
    test(name, async () => {
      const relay = createTestRelay();
      const reads = withV2(relay);
      const made = await deliveredWithSlip(relay, reads, 300);
      expect(relay.ledger.getJob(made.jobId)!.status).toBe("delivered");

      const result = await run(made.jobId, relay);
      expect(result.ok).toBe(true);

      const job = relay.ledger.getJob(made.jobId)!;
      expect(job.status).toBe(expected);
      expect(job.slipHash).toBe(SLIP);
      expect(relay.ledger.getOrder(made.jobId)!.slipHash).toBe(SLIP);
    });
  }
});

describe("the review window is recorded at fund", () => {
  test("a v2 settle records the terms' window, or zero when absent; a v1 settle records null", async () => {
    const relay = createTestRelay();
    withV2(relay);

    const windowed = await fundedV2(relay, { reviewWindow: 3600 });
    expect(relay.ledger.getJob(windowed.jobId)!.reviewWindow).toBe(3600);

    const bare = await fundedV2(relay);
    expect(relay.ledger.getJob(bare.jobId)!.reviewWindow).toBe(0);

    const v1 = await fundedV1(relay);
    expect(relay.ledger.getJob(v1.jobId)!.reviewWindow).toBeNull();
  });
});

describe("a failed review read after a confirmed release", () => {
  test("with a recorded window the release replies delivered and keeps the slip", async () => {
    const relay = createTestRelay();
    const reads = withV2(relay);
    const made = await fundedV2(relay, { reviewWindow: 3600 });
    expect(relay.ledger.getJob(made.jobId)!.reviewWindow).toBe(3600);
    reads.fail.reviewRead = true;

    const res = await post(appFor(relay), "/escrow/release", {
      jobId: made.jobId,
      slipHash: SLIP,
      sellerSig: SIG,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: "delivered" });
    const job = relay.ledger.getJob(made.jobId)!;
    expect(job.status).toBe("delivered");
    expect(job.slipHash).toBe(SLIP);
    expect(job.deliveredAt).toBe(NOW * 1000);
    expect(job.reviewEndsAt).toBe(NOW * 1000 + 3_600_000);
    expect(job.reviewWindow).toBe(3600);
    expect(job.closedAt).toBeNull();
  });

  test("without a recorded window the release replies released", async () => {
    const relay = createTestRelay();
    const reads = withV2(relay);
    const made = await fundedV2(relay);
    expect(relay.ledger.getJob(made.jobId)!.reviewWindow).toBe(0);
    reads.fail.reviewRead = true;

    const res = await post(appFor(relay), "/escrow/release", {
      jobId: made.jobId,
      slipHash: SLIP,
      sellerSig: SIG,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: "released" });
    const job = relay.ledger.getJob(made.jobId)!;
    expect(job.status).toBe("released");
    expect(job.slipHash).toBe(SLIP);
    expect(job.deliveredAt).toBeNull();
    expect(job.reviewEndsAt).toBeNull();
    expect(job.closedAt).toBe(NOW * 1000);
  });
});
