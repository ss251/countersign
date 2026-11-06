/**
 * Escrow v2 review wiring: the buyer's accept and dispute routes, the janitor's window release,
 * the gate's settle-window cutoff, and the review fields the reads serve from the store.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import {
  acceptTypedData,
  disputeTypedData,
  offerHash,
  slipCommitHash,
  type CallResult,
  type ErrorBody,
  type SettleResult,
} from "../src/deps.ts";
import { failOnGate, GATE_FAILED } from "../src/bond.ts";
import { runJanitor } from "../src/janitor.ts";
import { Store, type JobStatus, type ReviewOutcome } from "../src/store.ts";
import { FakeRail } from "./fake-rail.ts";
import {
  call,
  makeOffer,
  NONCE,
  NOW,
  other,
  paymentFor,
  publishOk,
  requirementsFor,
  seller,
  startHub,
  wsUrl,
  type TestHub,
} from "./support.ts";
import { startRunner, type RunnerHandle } from "./runner-client.ts";

const httpFetch = globalThis.fetch;
const BUYER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const buyer = privateKeyToAccount(BUYER_KEY);
const CHAIN = 5042002;
const ESCROW: Address = "0x4444444444444444444444444444444444444444";
const SLIP: Hex = `0x${"cd".repeat(32)}`;
const ACCEPT_TX: Hex = `0x${"e1".repeat(32)}`;
const DISPUTE_TX: Hex = `0x${"e2".repeat(32)}`;
const WINDOW_TX: Hex = `0x${"e3".repeat(32)}`;

class V2Rail extends FakeRail {
  readonly acceptCalls: Array<{ jobId: Hex; buyerSig: Hex }> = [];
  readonly disputeCalls: Array<{ jobId: Hex; buyerSig: Hex }> = [];
  readonly windowCalls: Hex[] = [];
  readonly reviewCalls: Hex[] = [];
  readonly failDeliveryCalls: Hex[] = [];
  failAccept = false;
  failDispute = false;
  failWindow = false;
  review = { window: 300, deliveredAt: NOW, endsAt: NOW + 300 };

  constructor() {
    super("escrow");
    const escrow = this.escrow;
    if (!escrow) throw new Error("the test rail has no escrow");
    escrow.disputeWindowSeconds = 600;
    escrow.accept = async (jobId, buyerSig) => {
      this.acceptCalls.push({ jobId, buyerSig });
      return this.outcome(this.failAccept, ACCEPT_TX);
    };
    escrow.dispute = async (jobId, buyerSig) => {
      this.disputeCalls.push({ jobId, buyerSig });
      return this.outcome(this.failDispute, DISPUTE_TX);
    };
    escrow.releaseAfterWindow = async (jobId) => {
      this.windowCalls.push(jobId);
      return this.outcome(this.failWindow, WINDOW_TX);
    };
    escrow.reviewOf = async (jobId) => {
      this.reviewCalls.push(jobId);
      return this.review;
    };
    escrow.sweepToll = async () => this.outcome(false, WINDOW_TX);
    escrow.failDelivery = async (jobId) => {
      this.failDeliveryCalls.push(jobId);
      return this.outcome(false, DISPUTE_TX);
    };
  }

  private outcome(fails: boolean, tx: string): SettleResult {
    return {
      success: !fails,
      ...(fails ? { errorReason: "Refused. The test rail refused it." } : {}),
      transaction: tx,
      network: this.declaration.network,
    };
  }
}

class V1Rail extends FakeRail {}

interface SeedJob {
  status: JobStatus;
  rail?: "escrow" | "gateway";
  buyer?: string;
  deadline?: number;
  reviewWindow?: number | null;
  deliveredAt?: number | null;
  endsAt?: number | null;
  reviewOutcome?: ReviewOutcome | null;
  reviewTx?: string | null;
  slipHash?: Hex | null;
  closeTx?: string | null;
}

function seedOffer(hub: TestHub): Hex {
  const offer = makeOffer();
  const hash = offerHash(offer);
  hub.store.putOffer(hash, seller.address, offer, NOW);
  return hash;
}

let jobCounter = 0;

function seedJob(hub: TestHub, hash: Hex, options: SeedJob): Hex {
  jobCounter += 1;
  const jobId = `0x${jobCounter.toString(16).padStart(64, "0")}` as Hex;
  hub.store.putJob({
    jobId,
    offerHash: hash,
    rail: options.rail ?? "escrow",
    buyer: options.buyer ?? buyer.address,
    amount: "1000",
    deadline: options.deadline ?? NOW + 100,
    status: options.status,
    payment: {
      x402Version: 2,
      accepted: {
        scheme: "countersign",
        network: "eip155:5042002",
        amount: "1000",
        asset: "0x3600000000000000000000000000000000000000",
        payTo: seller.address,
        maxTimeoutSeconds: 120,
      },
      payload: {},
    },
    settleTx: null,
    closeTx: options.closeTx ?? null,
    slipHash: options.slipHash === undefined ? SLIP : options.slipHash,
    createdAt: NOW,
    reviewWindow: options.reviewWindow === undefined ? null : options.reviewWindow,
    deliveredAt: options.deliveredAt === undefined ? null : options.deliveredAt,
    endsAt: options.endsAt === undefined ? null : options.endsAt,
    reviewOutcome: options.reviewOutcome === undefined ? null : options.reviewOutcome,
    reviewTx: options.reviewTx === undefined ? null : options.reviewTx,
  });
  return jobId;
}

function post(hub: TestHub, jobId: Hex, action: "accept" | "dispute", sig: Hex): Promise<Response> {
  return httpFetch(`${hub.url}/jobs/${jobId}/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sig }),
  });
}

async function acceptSig(jobId: Hex, slipHash: Hex = SLIP, signer = buyer): Promise<Hex> {
  return signer.signTypedData(acceptTypedData(CHAIN, ESCROW, jobId, slipHash));
}

async function disputeSig(jobId: Hex, signer = buyer): Promise<Hex> {
  return signer.signTypedData(disputeTypedData(CHAIN, ESCROW, jobId));
}

let hubs: TestHub[] = [];
let runners: RunnerHandle[] = [];

afterEach(() => {
  for (const runner of runners) runner.close();
  runners = [];
  for (const hub of hubs) hub.close();
  hubs = [];
});

function startV2(): { hub: TestHub; rail: V2Rail } {
  const rail = new V2Rail();
  const hub = startHub({ rails: [rail] });
  hubs.push(hub);
  return { hub, rail };
}

describe("escrow v2 review routes", () => {
  test("accept on a delivered job pays the seller and records accepted", async () => {
    const { hub, rail } = startV2();
    const hash = seedOffer(hub);
    const jobId = seedJob(hub, hash, { status: "delivered", deliveredAt: NOW, endsAt: NOW + 300, reviewWindow: 300 });

    const sig = await acceptSig(jobId);
    const response = await post(hub, jobId, "accept", sig);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ jobId, status: "released", tx: ACCEPT_TX });
    expect(rail.acceptCalls).toEqual([{ jobId, buyerSig: sig }]);

    const job = hub.store.getJob(jobId);
    expect(job?.status).toBe("released");
    expect(job?.reviewOutcome).toBe("accepted");
    expect(job?.reviewTx).toBe(ACCEPT_TX);
    expect(job?.closeTx).toBe(ACCEPT_TX);
  });

  test("dispute on a delivered job inside the window is disputed", async () => {
    const { hub, rail } = startV2();
    const hash = seedOffer(hub);
    const jobId = seedJob(hub, hash, { status: "delivered", deliveredAt: NOW, endsAt: NOW + 300, reviewWindow: 300 });

    const response = await post(hub, jobId, "dispute", await disputeSig(jobId));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ jobId, status: "disputed", tx: DISPUTE_TX });
    expect(rail.disputeCalls).toHaveLength(1);

    const job = hub.store.getJob(jobId);
    expect(job?.status).toBe("disputed");
    expect(job?.reviewOutcome).toBe("disputed");
    expect(job?.reviewTx).toBe(DISPUTE_TX);
    expect(job?.closeTx).toBe(DISPUTE_TX);
  });

  test("dispute on a funded job before the deadline is disputed", async () => {
    const { hub } = startV2();
    const hash = seedOffer(hub);
    const jobId = seedJob(hub, hash, { status: "funded", deadline: NOW });

    expect((await post(hub, jobId, "dispute", await disputeSig(jobId))).status).toBe(200);
    expect(hub.store.getJob(jobId)?.status).toBe("disputed");
  });

  test("dispute after ends_at is refused", async () => {
    const { hub, rail } = startV2();
    const hash = seedOffer(hub);
    const jobId = seedJob(hub, hash, { status: "delivered", deliveredAt: NOW, endsAt: NOW + 300, reviewWindow: 300 });

    hub.setNow(NOW + 301);
    expect((await post(hub, jobId, "dispute", await disputeSig(jobId))).status).toBe(409);
    expect(rail.disputeCalls).toHaveLength(0);
  });

  test("dispute on a funded job after its deadline is refused", async () => {
    const { hub, rail } = startV2();
    const hash = seedOffer(hub);
    const jobId = seedJob(hub, hash, { status: "funded", deadline: NOW });

    hub.setNow(NOW + 1);
    expect((await post(hub, jobId, "dispute", await disputeSig(jobId))).status).toBe(409);
    expect(rail.disputeCalls).toHaveLength(0);
  });

  test("a signature from anyone but the buyer is 401 and sends nothing", async () => {
    const { hub, rail } = startV2();
    const hash = seedOffer(hub);
    const jobId = seedJob(hub, hash, { status: "delivered", deliveredAt: NOW, endsAt: NOW + 300, reviewWindow: 300 });

    const response = await post(hub, jobId, "accept", await acceptSig(jobId, SLIP, other));
    expect(response.status).toBe(401);
    expect(((await response.json()) as ErrorBody).code).toBe("bad-signature");
    expect(rail.acceptCalls).toHaveLength(0);
    expect(hub.store.getJob(jobId)?.status).toBe("delivered");
  });

  test("an unknown job is 404", async () => {
    const { hub } = startV2();
    const response = await post(hub, `0x${"ff".repeat(32)}` as Hex, "accept", `0x${"11".repeat(65)}` as Hex);
    expect(response.status).toBe(404);
    expect(((await response.json()) as ErrorBody).code).toBe("unknown-job");
  });

  test("a v1 job is 409 not-reviewable", async () => {
    const rail = new V1Rail();
    const hub = startHub({ rails: [rail] });
    hubs.push(hub);
    const hash = seedOffer(hub);
    const jobId = seedJob(hub, hash, { status: "delivered", deliveredAt: NOW, endsAt: NOW + 300, reviewWindow: 300 });

    expect((await post(hub, jobId, "accept", await acceptSig(jobId))).status).toBe(409);
  });

  test("a failed rail transaction is 502 and leaves the job unchanged", async () => {
    const { hub, rail } = startV2();
    rail.failAccept = true;
    const hash = seedOffer(hub);
    const jobId = seedJob(hub, hash, { status: "delivered", deliveredAt: NOW, endsAt: NOW + 300, reviewWindow: 300 });

    const response = await post(hub, jobId, "accept", await acceptSig(jobId));
    expect(response.status).toBe(502);
    expect(((await response.json()) as ErrorBody).code).toBe("review-failed");

    const job = hub.store.getJob(jobId);
    expect(job?.status).toBe("delivered");
    expect(job?.reviewOutcome).toBeNull();
    expect(job?.reviewTx).toBeNull();
    expect(job?.closeTx).toBeNull();
  });
});

describe("the v2 call path opens a review", () => {
  test("release on a windowed job stores delivered and puts review on the slip", async () => {
    const { hub, rail } = startV2();
    const offer = makeOffer();
    const hash = await publishOk(hub, offer);
    runners.push(await connect(hub, hash));

    const entry = (await requirementsFor(hub, hash)).accepts[0];
    if (!entry) throw new Error("missing accepts entry");
    const payment = paymentFor(entry);
    payment.payload = {
      authorization: { nonce: NONCE },
      terms: { deadline: NOW + 60, bond: "0", reviewWindow: 300 },
    };

    const response = await call(hub, hash, { q: "hello" }, payment);
    expect(response.status).toBe(200);
    const result = (await response.json()) as CallResult;

    const settlement = result.slip.settlement as CallResult["slip"]["settlement"] & {
      review?: { window: number; deliveredAt: number; endsAt: number };
    };
    expect(settlement.review).toEqual({ window: 300, deliveredAt: NOW, endsAt: NOW + 300 });
    expect(result.slip.hash).toBe(slipCommitHash(result.slip.body));

    const job = hub.store.getJob(NONCE);
    expect(job?.status).toBe("delivered");
    expect(job?.reviewWindow).toBe(300);
    expect(job?.deliveredAt).toBe(NOW);
    expect(job?.endsAt).toBe(NOW + 300);
    expect(job?.closeTx).toBe(rail.releaseTx);
  });

  test("a failed reviewOf read after the release still records delivered from the countersigned window", async () => {
    const { hub, rail } = startV2();
    const escrow = rail.escrow;
    if (!escrow) throw new Error("the test rail has no escrow");
    escrow.reviewOf = async () => {
      throw new Error("the RPC dropped");
    };
    const offer = makeOffer();
    const hash = await publishOk(hub, offer);
    runners.push(await connect(hub, hash));

    const entry = (await requirementsFor(hub, hash)).accepts[0];
    if (!entry) throw new Error("missing accepts entry");
    const payment = paymentFor(entry);
    payment.payload = {
      authorization: { nonce: NONCE },
      terms: { deadline: NOW + 60, bond: "0", reviewWindow: 300 },
    };

    const response = await call(hub, hash, { q: "hello" }, payment);
    expect(response.status).toBe(200);
    const job = hub.store.getJob(NONCE);
    // Never stranded as funded: the janitor can release it after endsAt.
    expect(job?.status).toBe("delivered");
    expect(job?.reviewWindow).toBe(300);
    expect(job?.endsAt).toBe(NOW + 300);
  });
});

describe("the janitor and the review window", () => {
  test("releaseAfterWindow runs only after ends_at, never at it", async () => {
    const { hub, rail } = startV2();
    const hash = seedOffer(hub);
    const jobId = seedJob(hub, hash, { status: "delivered", deliveredAt: NOW, endsAt: NOW, reviewWindow: 300 });

    hub.setNow(NOW);
    expect(await runJanitor(hub.deps)).toBe(0);
    expect(rail.windowCalls).toHaveLength(0);

    hub.setNow(NOW + 1);
    expect(await runJanitor(hub.deps)).toBe(1);
    expect(rail.windowCalls).toEqual([jobId]);
    const job = hub.store.getJob(jobId);
    expect(job?.status).toBe("released");
    expect(job?.reviewOutcome).toBe("window-elapsed");
    expect(job?.reviewTx).toBe(WINDOW_TX);
    expect(job?.closeTx).toBe(WINDOW_TX);
  });

  test("a v2 funded job is refunded only after deadline + 600", async () => {
    const { hub, rail } = startV2();
    const hash = seedOffer(hub);
    const jobId = seedJob(hub, hash, { status: "funded", deadline: NOW });

    hub.setNow(NOW + 600);
    expect(await runJanitor(hub.deps)).toBe(0);
    expect(rail.refundCalls).toHaveLength(0);

    hub.setNow(NOW + 601);
    expect(await runJanitor(hub.deps)).toBe(1);
    expect(rail.refundCalls).toEqual([jobId]);
    expect(hub.store.getJob(jobId)?.status).toBe("refunded");
  });

  test("a v1 funded job is refunded after its deadline as today", async () => {
    const rail = new V1Rail();
    const hub = startHub({ rails: [rail] });
    hubs.push(hub);
    const hash = seedOffer(hub);
    const jobId = seedJob(hub, hash, { status: "funded", deadline: NOW });

    hub.setNow(NOW + 1);
    expect(await runJanitor(hub.deps)).toBe(1);
    expect(rail.refundCalls).toEqual([jobId]);
  });
});

describe("the gate's v2 settle window", () => {
  test("after deadline + 600 failOnGate sends nothing and returns null", async () => {
    const rail = new V2Rail();
    const store = new Store(":memory:");
    const offer = makeOffer();
    const hash = offerHash(offer);
    store.putOffer(hash, seller.address, offer, NOW);
    const jobId = `0x${"77".repeat(32)}` as Hex;
    store.putJob({
      jobId,
      offerHash: hash,
      rail: "escrow",
      buyer: buyer.address,
      amount: "1000",
      deadline: NOW,
      status: "funded",
      payment: {
        x402Version: 2,
        accepted: {
          scheme: "countersign",
          network: "eip155:5042002",
          amount: "1000",
          asset: "0x3600000000000000000000000000000000000000",
          payTo: seller.address,
          maxTimeoutSeconds: 120,
        },
        payload: {},
      },
      settleTx: null,
      closeTx: null,
      slipHash: null,
      createdAt: NOW,
    });

    expect(await failOnGate(rail, jobId, store, NOW + 600)).toBe(GATE_FAILED);
    expect(rail.failDeliveryCalls).toEqual([jobId]);

    expect(await failOnGate(rail, jobId, store, NOW + 601)).toBeNull();
    expect(rail.failDeliveryCalls).toEqual([jobId]);
  });
});

describe("the reads serve the review fields", () => {
  test("/jobs and /orders show deliveredAt, reviewEndsAt and reviewOutcome from the store", async () => {
    const { hub } = startV2();
    const hash = seedOffer(hub);
    const accepted = seedJob(hub, hash, {
      status: "released",
      deliveredAt: NOW,
      endsAt: NOW + 300,
      reviewWindow: 300,
      reviewOutcome: "accepted",
      reviewTx: ACCEPT_TX,
      closeTx: ACCEPT_TX,
    });
    const v1 = seedJob(hub, hash, { status: "released", reviewWindow: null, closeTx: WINDOW_TX });
    const direct = seedJob(hub, hash, { status: "settled", rail: "gateway", reviewWindow: null });

    const jobsBody = (await httpFetch(`${hub.url}/jobs?buyer=${buyer.address}`).then((r) => r.json())) as {
      jobs: Array<Record<string, unknown>>;
    };
    const jobs = new Map(jobsBody.jobs.map((job) => [job.jobId, job]));
    expect(jobs.get(accepted)).toMatchObject({
      reviewWindow: 300,
      deliveredAt: NOW * 1000,
      reviewEndsAt: (NOW + 300) * 1000,
      reviewOutcome: "accepted",
    });
    expect(jobs.get(v1)?.reviewWindow).toBe(0);
    expect(jobs.get(direct)?.reviewWindow).toBeNull();

    const ordersBody = (await httpFetch(`${hub.url}/orders?seller=${seller.address}`).then((r) => r.json())) as {
      orders: Array<Record<string, unknown>>;
    };
    const orders = new Map(ordersBody.orders.map((order) => [order.id, order]));
    expect(orders.get(accepted)).toMatchObject({
      reviewWindow: 300,
      deliveredAt: NOW * 1000,
      reviewEndsAt: (NOW + 300) * 1000,
      reviewOutcome: "accepted",
    });
    expect(orders.get(v1)?.reviewWindow).toBe(0);
    expect(orders.get(direct)?.reviewWindow).toBeNull();
  });
});

async function connect(hub: TestHub, hash: `0x${string}`): Promise<RunnerHandle> {
  const runner = startRunner({
    url: wsUrl(hub),
    account: seller,
    offers: [hash],
    now: () => NOW,
    respond: async (): Promise<{ output: unknown }> => ({ output: { q: "hello" } }),
  });
  await runner.ready;
  return runner;
}
