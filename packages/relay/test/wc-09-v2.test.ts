/**
 * Escrow v2 on the relay: two allowed escrows, v2 settle through fundArgsV2, the buyer's
 * accept/dispute, the window release and the arbiter's failDelivery. The chain is simulated;
 * nothing here reaches a network.
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
  cancelJob,
  disputeJob,
  failDeliveryJob,
  refundJob,
  releaseAfterWindowJob,
  releaseJob,
} from "../src/escrow-ops.ts";
import { Ledger } from "../src/ledger.ts";
import { createRelayApp } from "../src/server.ts";
import { csContext, makeOffer } from "./escrow-support.ts";
import { createTestRelay, fakeHash, NOW } from "./support.ts";

const V2 = getAddress("0x7777777777777777777777777777777777777777");
const SIG: Hex = `0x${"34".repeat(65)}`;
const SLIP: Hex = `0x${"51".repeat(32)}`;
const HUB_TOKEN = "a-hub-token-long-enough";

type TestRelay = ReturnType<typeof createTestRelay>;

let salt = 0;
let v1Salt = 0;

/** Turn a test relay into a v2 relay: both escrows allowed, review and bond reads simulated. */
function withV2(relay: TestRelay) {
  relay.policy.allowedEscrows.push(V2);
  relay.policy.escrowV2 = V2;
  const reviews = new Map<string, readonly [bigint, bigint, bigint]>();
  const bonds = new Map<string, bigint>();
  const read = relay.chain.readContract.bind(relay.chain);
  relay.chain.readContract = async (call) => {
    const jobId = String(call.args?.[0] ?? "").toLowerCase();
    if (call.functionName === "reviewOf") return reviews.get(jobId) ?? [0n, 0n, 0n];
    if (call.functionName === "bondOfJob") return bonds.get(jobId) ?? 0n;
    if (call.functionName === "tollBps") return 100n;
    return read(call);
  };
  return { reviews, bonds };
}

async function makeV2Body(
  relay: TestRelay,
  options: { bond?: string; reviewWindow?: number } = {},
) {
  const buyer = privateKeyToAccount(generatePrivateKey());
  relay.chain.setBalance(buyer.address, 100_000_000n);
  const offer: Offer = {
    ...makeOffer(relay.merchant.address),
    bond: options.bond ?? "500000",
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
    lockSig: SIG,
  };
  return { body, buyer, jobId };
}

async function fundedV2(relay: TestRelay, options: { bond?: string; reviewWindow?: number } = {}) {
  const made = await makeV2Body(relay, options);
  const result = await settleCountersign(made.body, csContext(relay));
  expect(result.success).toBe(true);
  return made;
}

function appFor(relay: TestRelay, hubToken?: string) {
  return createRelayApp({
    reader: relay.chain,
    relayer: relay.relayer,
    ledger: relay.ledger,
    now: () => NOW,
    config: hubToken ? { hubToken } : {},
  });
}

function post(app: ReturnType<typeof createRelayApp>, path: string, body: unknown, headers: Record<string, string> = {}) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("escrow v2 settle", () => {
  test("funds through fundArgsV2 on the v2 escrow and records the escrow and bond", async () => {
    const relay = createTestRelay();
    const { bonds } = withV2(relay);
    const made = await makeV2Body(relay, { bond: "500000", reviewWindow: 300 });
    bonds.set(made.jobId.toLowerCase(), 500_000n);

    const result = await settleCountersign(made.body, csContext(relay));
    expect(result.success).toBe(true);

    const write = relay.chain.writes.at(-1)!;
    expect(write.address).toBe(V2);
    expect(write.functionName).toBe("fund");
    const args = write.args as readonly [Hex, { bond: bigint; reviewWindow: bigint }];
    expect(args[1].bond).toBe(500_000n);
    expect(args[1].reviewWindow).toBe(300n);
    const job = relay.ledger.getJob(made.jobId)!;
    expect(job.escrow).toBe(V2);
    expect(job.bond).toBe("500000");
  });

  test("a v1 settle is unchanged", async () => {
    const relay = createTestRelay();
    withV2(relay);
    const v1Offer = { ...makeOffer(relay.merchant.address), bond: "0" };
    const v1Rail = whitechainRail({ relayUrl: "http://relay" });
    const req = v1Rail.challenge(v1Offer, { resource: "x", now: NOW });
    const extra = req.extra as unknown as CountersignExtra;
    const buyer = privateKeyToAccount(generatePrivateKey());
    relay.chain.setBalance(buyer.address, 100_000_000n);
    const terms = {
      offerHash: offerHash(v1Offer),
      buyer: buyer.address,
      payee: getAddress(req.payTo),
      amount: req.amount,
      deadline: NOW + extra.deadlineSeconds,
      salt: "1",
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
    const v1Body = {
      x402Version: 2,
      paymentPayload: {
        x402Version: 2,
        accepted: req,
        payload: payload as unknown as Record<string, unknown>,
        resource: "http://merchant.example/x",
      },
      paymentRequirements: req,
    };
    const result = await settleCountersign(v1Body, csContext(relay));
    expect(result.success).toBe(true);
    const write = relay.chain.writes.at(-1)!;
    expect(write.address).toBe(WHITECHAIN_ESCROW);
    expect(write.args?.[1]).toHaveProperty("salt");
    expect(write.args?.[1]).not.toHaveProperty("bond");
  });
});

describe("v2 routes", () => {
  test("/status keeps v1 first and names the v2 escrow", async () => {
    const relay = createTestRelay();
    withV2(relay);
    const body = (await (await appFor(relay).request("/status")).json()) as {
      escrow: string;
      escrowV2: string | null;
    };
    expect(body.escrow).toBe(WHITECHAIN_ESCROW);
    expect(body.escrowV2).toBe(V2);
  });

  test("accept, dispute and release-after-window take the happy path", async () => {
    for (const [path, expected] of [
      ["/escrow/accept", "released"],
      ["/escrow/dispute", "disputed"],
      ["/escrow/release-after-window", "released"],
    ] as const) {
      const relay = createTestRelay();
      withV2(relay);
      const { jobId } = await fundedV2(relay);
      const res = await post(appFor(relay), path, {
        jobId,
        buyerSig: SIG,
        ...(path === "/escrow/dispute" ? { status: 1 } : {}),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, status: expected });
      expect(relay.ledger.getJob(jobId)!.status).toBe(expected);
    }
  });

  test("a job the ledger does not hold is 404", async () => {
    const relay = createTestRelay();
    withV2(relay);
    const app = appFor(relay);
    for (const path of ["/escrow/accept", "/escrow/dispute", "/escrow/release-after-window"]) {
      const res = await post(app, path, {
        jobId: `0x${"12".repeat(32)}`,
        buyerSig: SIG,
        ...(path === "/escrow/dispute" ? { status: 1 } : {}),
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ ok: false, reason: "job_not_found" });
    }
  });

  test("a v1 job is 409 not_supported_on_v1", async () => {
    const relay = createTestRelay();
    withV2(relay);
    const { jobId } = await fundedV1(relay);
    const app = appFor(relay);
    for (const path of ["/escrow/accept", "/escrow/dispute", "/escrow/release-after-window"]) {
      const res = await post(app, path, {
        jobId,
        buyerSig: SIG,
        ...(path === "/escrow/dispute" ? { status: 1 } : {}),
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ ok: false, reason: "not_supported_on_v1" });
    }
    expect(relay.chain.writes.every((call) => call.address !== V2)).toBe(true);
  });

  test("a bad body is 400", async () => {
    const relay = createTestRelay();
    withV2(relay);
    const app = appFor(relay);
    expect((await post(app, "/escrow/accept", { jobId: "nope", buyerSig: SIG })).status).toBe(400);
    expect((await post(app, "/escrow/accept", { jobId: `0x${"12".repeat(32)}` })).status).toBe(400);
    expect((await post(app, "/escrow/dispute", { jobId: `0x${"12".repeat(32)}`, buyerSig: "no" })).status).toBe(400);
    expect((await post(app, "/escrow/release-after-window", {})).status).toBe(400);
  });

  test("a simulation revert is 422 and sends nothing", async () => {
    const relay = createTestRelay();
    withV2(relay);
    const { jobId } = await fundedV2(relay);
    const writes = relay.chain.writes.length;
    relay.chain.failSimulation = true;
    const res = await post(appFor(relay), "/escrow/accept", { jobId, buyerSig: SIG });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ ok: false, reason: "simulation_failed" });
    expect(relay.chain.writes).toHaveLength(writes);
  });
});

describe("/escrow/fail", () => {
  test("without a configured token it answers 503", async () => {
    const relay = createTestRelay();
    withV2(relay);
    const { jobId } = await fundedV2(relay);
    const res = await post(appFor(relay), "/escrow/fail", { jobId });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, reason: "fail_not_configured" });
  });

  test("a missing or wrong token is 401 with no relayer call", async () => {
    for (const header of [
      undefined,
      `Bearer ${"b".repeat(HUB_TOKEN.length)}`,
      "Bearer wrong-token-wrong-token-xx",
      "Bearer short",
      "Basic a-hub-token-long-enough",
    ]) {
      const relay = createTestRelay();
      withV2(relay);
      const { jobId } = await fundedV2(relay);
      const submits = spyOnSubmit(relay);
      const res = await post(
        appFor(relay, HUB_TOKEN),
        "/escrow/fail",
        { jobId },
        header ? { authorization: header } : {},
      );
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ ok: false, reason: "hub_auth_required" });
      expect(submits()).toBe(0);
      expect(relay.chain.writes).toHaveLength(1);
    }
  });

  test("the right token submits failDelivery", async () => {
    const relay = createTestRelay();
    withV2(relay);
    const { jobId } = await fundedV2(relay);
    const res = await post(appFor(relay, HUB_TOKEN), "/escrow/fail", { jobId }, { authorization: `Bearer ${HUB_TOKEN}` });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: "failed" });
    expect(relay.chain.writes.at(-1)!.functionName).toBe("failDelivery");
    expect(relay.chain.writes.at(-1)!.address).toBe(V2);
    expect(relay.ledger.getJob(jobId)!.status).toBe("failed");
  });
});

describe("ledger transitions", () => {
  test("a window-0 release is released; a windowed release is delivered", async () => {
    const zero = createTestRelay();
    const zeroReads = withV2(zero);
    const zeroJob = await fundedV2(zero);
    zeroReads.reviews.set(zeroJob.jobId.toLowerCase(), [0n, 0n, 0n]);
    const zeroResult = await releaseJob({ jobId: zeroJob.jobId, slipHash: SLIP, sellerSig: SIG }, csContext(zero));
    expect(zeroResult).toMatchObject({ ok: true, status: "released" });
    expect(zero.ledger.getJob(zeroJob.jobId)!.status).toBe("released");

    const windowed = createTestRelay();
    const reads = withV2(windowed);
    const made = await fundedV2(windowed, { reviewWindow: 300 });
    reads.reviews.set(made.jobId.toLowerCase(), [300n, BigInt(NOW), BigInt(NOW + 300)]);
    const result = await releaseJob({ jobId: made.jobId, slipHash: SLIP, sellerSig: SIG }, csContext(windowed));
    expect(result).toMatchObject({ ok: true, status: "delivered" });
    const job = windowed.ledger.getJob(made.jobId)!;
    expect([job.status, job.deliveredAt, job.reviewEndsAt, job.reviewWindow, job.closedAt]).toEqual([
      "delivered",
      NOW * 1000,
      (NOW + 300) * 1000,
      300,
      null,
    ]);
  });

  test("from delivered, accept and releaseAfterWindow release, dispute disputes", async () => {
    for (const [name, run, expected] of [
      ["accept", (jobId: string, relay: TestRelay) => acceptJob({ jobId, buyerSig: SIG }, csContext(relay)), "released"],
      ["window", (jobId: string, relay: TestRelay) => releaseAfterWindowJob({ jobId }, csContext(relay)), "released"],
      ["dispute", (jobId: string, relay: TestRelay) => disputeJob({ jobId, status: 5, buyerSig: SIG }, csContext(relay)), "disputed"],
    ] as const) {
      const relay = createTestRelay();
      const reads = withV2(relay);
      const made = await fundedV2(relay, { reviewWindow: 300 });
      reads.reviews.set(made.jobId.toLowerCase(), [300n, BigInt(NOW), BigInt(NOW + 300)]);
      await releaseJob({ jobId: made.jobId, slipHash: SLIP, sellerSig: SIG }, csContext(relay));
      expect(relay.ledger.getJob(made.jobId)!.status).toBe("delivered");
      const result = await run(made.jobId, relay);
      expect(result.ok).toBe(true);
      const job = relay.ledger.getJob(made.jobId)!;
      expect(job.status).toBe(expected);
      if (name === "accept") expect(job.closeVia).toBe("accept");
      if (name === "window") expect(job.closeVia).toBe("window");
    }
  });

  test("from delivered, cancel is refused as job_not_open with no call", async () => {
    const relay = createTestRelay();
    const reads = withV2(relay);
    const made = await fundedV2(relay, { reviewWindow: 300 });
    reads.reviews.set(made.jobId.toLowerCase(), [300n, BigInt(NOW), BigInt(NOW + 300)]);
    await releaseJob({ jobId: made.jobId, slipHash: SLIP, sellerSig: SIG }, csContext(relay));
    expect(relay.ledger.getJob(made.jobId)!.status).toBe("delivered");
    const writes = relay.chain.writes.length;

    const result = await cancelJob({ jobId: made.jobId, sellerSig: SIG }, csContext(relay));

    expect(result).toEqual({ ok: false, reason: "job_not_open" });
    expect(relay.chain.writes).toHaveLength(writes);
    expect(relay.ledger.getJob(made.jobId)!.status).toBe("delivered");
  });

  test("failDelivery gives failed", async () => {
    const relay = createTestRelay();
    withV2(relay);
    const { jobId } = await fundedV2(relay);
    const result = await failDeliveryJob({ jobId }, csContext(relay));
    expect(result).toMatchObject({ ok: true, status: "failed" });
    expect(relay.ledger.getJob(jobId)!.status).toBe("failed");
  });

  test("a v2 refund gives refunded", async () => {
    const relay = createTestRelay();
    withV2(relay);
    const { jobId } = await fundedV2(relay);
    const result = await refundJob({ jobId }, csContext(relay));
    expect(result).toMatchObject({ ok: true, status: "refunded" });
    expect(relay.ledger.getJob(jobId)!.status).toBe("refunded");
  });
});

describe("orders mapping", () => {
  const MERCHANT = "0x2222222222222222222222222222222222222222";
  const CUSTOMER = "0x1111111111111111111111111111111111111111";
  let id = 0;
  function job(overrides: Partial<Parameters<Ledger["recordJob"]>[0]> = {}) {
    id += 1;
    return {
      jobId: `0x${id.toString(16).padStart(64, "a")}`,
      offerHash: `0x${"0f".repeat(32)}`,
      buyer: CUSTOMER,
      payee: MERCHANT,
      amount: 1_500_000n,
      deadline: 1_760_000_120,
      fundTx: fakeHash(),
      fundBlock: 7n,
      createdAt: 1000,
      escrow: V2,
      bond: "500000",
      ...overrides,
    };
  }

  test("delivered maps to in_review with its review times", () => {
    const ledger = new Ledger(":memory:");
    const j = job();
    ledger.recordJob(j);
    ledger.deliverJob(j.jobId, { slipHash: SLIP, deliveredAt: 2_000, reviewEndsAt: 5_000, reviewWindow: 3 });
    const order = ledger.getOrder(j.jobId)!;
    expect(order.status).toBe("in_review");
    expect([order.deliveredAt, order.reviewEndsAt, order.reviewWindow]).toEqual([2_000, 5_000, 3]);
    expect(order.receivedAt).toBeNull();
    expect(order.closeKind).toBeNull();
  });

  test("released via accept and via the window", () => {
    const ledger = new Ledger(":memory:");
    const accepted = job();
    const windowed = job();
    ledger.recordJob(accepted);
    ledger.recordJob(windowed);
    ledger.deliverJob(accepted.jobId, { slipHash: SLIP, deliveredAt: 2_000, reviewEndsAt: 5_000, reviewWindow: 3 });
    ledger.deliverJob(windowed.jobId, { slipHash: SLIP, deliveredAt: 2_000, reviewEndsAt: 5_000, reviewWindow: 3 });
    const tx = fakeHash();
    ledger.closeJob(accepted.jobId, "released", tx, SLIP, 6_000, null, "accept");
    ledger.closeJob(windowed.jobId, "released", fakeHash(), SLIP, 7_000, null, "window");
    expect(ledger.getOrder(accepted.jobId)).toMatchObject({
      status: "paid",
      acceptedAt: 6_000,
      acceptTx: tx,
      closeKind: "release",
    });
    expect(ledger.getOrder(windowed.jobId)).toMatchObject({ status: "paid", releasedAfterWindow: true });
    expect(ledger.getOrder(accepted.jobId)!.bondSlashed).toBeUndefined();
  });

  test("dispute and failDelivery map to refunded with bondSlashed", () => {
    const ledger = new Ledger(":memory:");
    const disputed = job();
    const failed = job();
    const refunded = job();
    for (const j of [disputed, failed, refunded]) ledger.recordJob(j);
    ledger.deliverJob(disputed.jobId, { slipHash: SLIP, deliveredAt: 2_000, reviewEndsAt: 5_000, reviewWindow: 3 });
    ledger.closeJob(disputed.jobId, "disputed", fakeHash(), undefined, 6_000);
    ledger.closeJob(failed.jobId, "failed", fakeHash(), undefined, 7_000);
    ledger.closeJob(refunded.jobId, "refunded", fakeHash(), undefined, 8_000);
    expect(ledger.getOrder(disputed.jobId)).toMatchObject({
      status: "refunded",
      closeKind: "dispute_refund",
      bondSlashed: "500000",
    });
    expect(ledger.getOrder(failed.jobId)).toMatchObject({
      status: "refunded",
      closeKind: "delivery_failed",
      bondSlashed: "500000",
    });
    expect(ledger.getOrder(refunded.jobId)).toMatchObject({
      status: "refunded",
      closeKind: "deadline_refund",
      bondSlashed: "500000",
    });
  });

  test("a disputed funded job returns the bond, so nothing is slashed", () => {
    const ledger = new Ledger(":memory:");
    const j = job();
    ledger.recordJob(j);
    ledger.closeJob(j.jobId, "disputed", fakeHash(), undefined, 6_000);
    expect(ledger.getOrder(j.jobId)!.bondSlashed).toBeUndefined();
    expect(ledger.getOrder(j.jobId)!.closeKind).toBe("dispute_refund");
  });

  test("the orders CSV header is still 14 columns", () => {
    const ledger = new Ledger(":memory:");
    const j = job();
    ledger.recordJob(j);
    const lines = ledger.ordersCsv(MERCHANT).trimEnd().split("\n");
    expect(lines[0]).toBe(
      "date_utc,order_id,kind,customer,merchant,amount_usdt,fee_usdt,refunded_usdt,net_usdt,status,settle_tx_url,close_tx_url,refund_tx_urls,refund_reasons",
    );
    expect(lines[0]!.split(",")).toHaveLength(14);
  });
});

describe("per-job escrow", () => {
  test("a v2 job's release, cancel and refund go to v2, a v1 job's to v1", async () => {
    const relay = createTestRelay();
    withV2(relay);
    const v2 = await fundedV2(relay);
    const v1 = await fundedV1(relay);

    await releaseJob({ jobId: v2.jobId, slipHash: SLIP, sellerSig: SIG }, csContext(relay));
    await releaseJob({ jobId: v1.jobId, slipHash: SLIP, sellerSig: SIG }, csContext(relay));
    expect(relay.chain.writes.filter((call) => call.functionName === "release").map((call) => call.address)).toEqual([
      V2,
      WHITECHAIN_ESCROW,
    ]);

    const cancelV2 = await fundedV2(relay);
    const cancelV1 = await fundedV1(relay);
    await cancelJob({ jobId: cancelV2.jobId, sellerSig: SIG }, csContext(relay));
    await cancelJob({ jobId: cancelV1.jobId, sellerSig: SIG }, csContext(relay));
    expect(relay.chain.writes.filter((call) => call.functionName === "cancel").map((call) => call.address)).toEqual([
      V2,
      WHITECHAIN_ESCROW,
    ]);

    const refundV2 = await fundedV2(relay);
    const refundV1 = await fundedV1(relay);
    await refundJob({ jobId: refundV2.jobId }, csContext(relay));
    await refundJob({ jobId: refundV1.jobId }, csContext(relay));
    expect(relay.chain.writes.filter((call) => call.functionName === "refund").map((call) => call.address)).toEqual([
      V2,
      WHITECHAIN_ESCROW,
    ]);
  });

  test("with WC_ESCROW_V2 unset only v1 is allowed", async () => {
    const relay = createTestRelay();
    expect(relay.relayer.allowedEscrows).toEqual([WHITECHAIN_ESCROW]);
    expect(relay.relayer.escrowVersion(WHITECHAIN_ESCROW)).toBe(1);
  });

  test("option (d): a bonded v2 settle funds through the relay, which is the arbiter", async () => {
    const relay = createTestRelay();
    withV2(relay);
    const { jobId } = await fundedV2(relay, { bond: "500000" });
    const fund = relay.chain.writes.find((call) => call.functionName === "fund")!;
    expect(fund.address).toBe(V2);
    expect(fund.account.address).toBe(relay.relayer.address);
    const args = fund.args as readonly [Hex, { bond: bigint }];
    expect(args[1].bond).toBe(500_000n);
    expect(relay.ledger.getJob(jobId)!.status).toBe("funded");
  });
});

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

function spyOnSubmit(relay: TestRelay): () => number {
  let calls = 0;
  const submit = relay.relayer.submit.bind(relay.relayer);
  relay.relayer.submit = async (call, payer) => {
    calls += 1;
    return submit(call, payer);
  };
  return () => calls;
}
