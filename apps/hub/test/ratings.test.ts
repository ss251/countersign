import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { PrivateKeyAccount } from "viem/accounts";
import type { Hex } from "viem";
import {
  canonicalHash,
  slipHash,
  slipTypedData,
  type ErrorBody,
  type JobOrder,
  type PaymentRequirements,
  type Slip,
  type SlipBody,
} from "../src/deps.ts";
import { runJanitor } from "../src/janitor.ts";
import type { HubStats, SellerRating, SellerRatingDetail } from "../src/ratings.ts";
import type { JobStatus } from "../src/store.ts";
import { ASSET, BUYER, NETWORK } from "./fake-rail.ts";
import {
  call,
  makeOffer,
  NOW,
  other,
  paymentFor,
  publish,
  publishOk,
  requirementsFor,
  seller,
  startHub,
  wsUrl,
  type TestHub,
} from "./support.ts";
import { startRunner, type RunnerHandle } from "./runner-client.ts";

const BUYER_B = "0x6666666666666666666666666666666666666666";
const BUYER_C = "0x7777777777777777777777777777777777777777";

let counter = 0;
function jobId(): Hex {
  counter += 1;
  return `0x${counter.toString(16).padStart(64, "0")}` as Hex;
}

async function signedSlip(
  account: PrivateKeyAccount,
  fields: { jobId: Hex; offerHash: Hex; buyer: string; amount: string; deliveredAt?: number; seller?: Hex },
): Promise<Slip> {
  const body: SlipBody = {
    v: 1,
    rail: "escrow",
    network: NETWORK,
    offerHash: fields.offerHash,
    jobId: fields.jobId,
    buyer: fields.buyer,
    seller: fields.seller ?? account.address,
    payTo: fields.seller ?? account.address,
    asset: ASSET,
    amount: fields.amount,
    inputHash: canonicalHash({ q: "hi" }),
    outputHash: canonicalHash({ q: "hi" }),
    deliveredAt: fields.deliveredAt ?? NOW,
    children: [],
  };
  const sellerSig = await account.signTypedData(slipTypedData(body));
  return {
    body,
    hash: slipHash(body),
    sellerSig,
    payment: paymentFor(REQUIREMENTS, fields.jobId),
    settlement: { transaction: "0xbb", network: NETWORK },
  };
}

const REQUIREMENTS: PaymentRequirements = {
  scheme: "countersign",
  network: NETWORK,
  amount: "1000",
  asset: ASSET,
  payTo: seller.address,
  maxTimeoutSeconds: 60,
};

/** Write a job straight into the ledger, with an optional stored slip. */
function putJob(
  hub: TestHub,
  fields: { offerHash: Hex; status: JobStatus; buyer?: string; amount?: string; slip?: Slip; id?: Hex },
): Hex {
  const id = fields.id ?? fields.slip?.body.jobId ?? jobId();
  hub.store.putJob({
    jobId: id,
    offerHash: fields.offerHash,
    rail: "escrow",
    buyer: fields.buyer ?? BUYER,
    amount: fields.amount ?? "1000",
    deadline: NOW + 60,
    status: fields.status,
    payment: paymentFor(REQUIREMENTS, id),
    settleTx: "0xaa",
    closeTx: null,
    slipHash: fields.slip?.hash ?? null,
    createdAt: NOW,
  });
  if (fields.slip) hub.store.putSlip(fields.slip.hash, id, fields.slip, NOW);
  return id;
}

async function delivered(
  hub: TestHub,
  offerHash: Hex,
  buyer: string,
  options: { amount?: string; deliveredAt?: number; signer?: PrivateKeyAccount } = {},
): Promise<Slip> {
  const id = jobId();
  const amount = options.amount ?? "1000";
  const slip = await signedSlip(options.signer ?? seller, {
    jobId: id,
    offerHash,
    buyer,
    amount,
    seller: seller.address,
    ...(options.deliveredAt !== undefined ? { deliveredAt: options.deliveredAt } : {}),
  });
  putJob(hub, { offerHash, status: "released", buyer, amount, slip });
  return slip;
}

async function getRatings(hub: TestHub): Promise<SellerRating[]> {
  const response = await fetch(`${hub.url}/ratings`);
  expect(response.status).toBe(200);
  return ((await response.json()) as { ratings: SellerRating[] }).ratings;
}

async function getSeller(hub: TestHub, address: string): Promise<SellerRatingDetail> {
  const response = await fetch(`${hub.url}/ratings/${address}`);
  expect(response.status).toBe(200);
  return (await response.json()) as SellerRatingDetail;
}

async function getStats(hub: TestHub): Promise<HubStats> {
  const response = await fetch(`${hub.url}/stats`);
  expect(response.status).toBe(200);
  return (await response.json()) as HubStats;
}

describe("ratings derived from slips", () => {
  let hub: TestHub;
  let runners: RunnerHandle[];

  beforeEach(() => {
    hub = startHub();
    runners = [];
  });

  afterEach(() => {
    for (const runner of runners) runner.close();
    hub.close();
  });

  test("an empty hub has no ratings and zero stats", async () => {
    expect(await getRatings(hub)).toEqual([]);
    const stats = await getStats(hub);
    expect(stats.calls).toBe(0);
    expect(stats.sellers).toBe(0);
    expect(stats.score).toBeNull();
    expect(stats.volume).toBe("0");
    expect(stats.byRail).toEqual({});
  });

  test("a seller with offers and no calls is listed with no score", async () => {
    await publishOk(hub, makeOffer());
    const [rating] = await getRatings(hub);
    expect(rating?.seller).toBe(seller.address);
    expect(rating?.closed).toBe(0);
    expect(rating?.score).toBeNull();
  });

  test("verified slips count as delivered, failures and refunds count against", async () => {
    const hash = await publishOk(hub, makeOffer());
    await delivered(hub, hash, BUYER, { amount: "1000", deliveredAt: NOW + 5 });
    await delivered(hub, hash, BUYER_B, { amount: "2500", deliveredAt: NOW + 9 });
    await delivered(hub, hash, BUYER, { amount: "500", deliveredAt: NOW + 7 });
    putJob(hub, { offerHash: hash, status: "failed" });
    putJob(hub, { offerHash: hash, status: "refunded" });
    putJob(hub, { offerHash: hash, status: "funded" });

    const rating = await getSeller(hub, seller.address);
    expect(rating).toMatchObject({
      seller: seller.address,
      delivered: 3,
      failed: 1,
      refunded: 1,
      open: 1,
      unverified: 0,
      selfDealt: 0,
      closed: 5,
      score: 0.6,
      buyers: 2,
      volume: "4000",
      lastDeliveredAt: NOW + 9,
    });
    expect(rating.offers).toHaveLength(1);
    expect(rating.offers[0]).toMatchObject({ offerHash: hash, delivered: 3, closed: 5, listed: true });
  });

  test("a released job without a stored slip is not counted as delivered", async () => {
    const hash = await publishOk(hub, makeOffer());
    putJob(hub, { offerHash: hash, status: "released" });
    const rating = await getSeller(hub, seller.address);
    expect(rating.delivered).toBe(0);
    expect(rating.unverified).toBe(1);
    expect(rating.score).toBeNull();
  });

  test("a slip signed by someone other than the seller is not counted", async () => {
    const hash = await publishOk(hub, makeOffer());
    await delivered(hub, hash, BUYER, { signer: other });
    const rating = await getSeller(hub, seller.address);
    expect(rating.delivered).toBe(0);
    expect(rating.unverified).toBe(1);
  });

  test("a slip whose body was edited after signing is not counted", async () => {
    const hash = await publishOk(hub, makeOffer());
    const slip = await signedSlip(seller, { jobId: jobId(), offerHash: hash, buyer: BUYER, amount: "1000" });
    const tampered: Slip = { ...slip, body: { ...slip.body, deliveredAt: slip.body.deliveredAt + 1 } };
    putJob(hub, { offerHash: hash, status: "released", slip: tampered });
    expect((await getSeller(hub, seller.address)).unverified).toBe(1);
  });

  test("a slip that names a different amount, buyer or job is not counted", async () => {
    const hash = await publishOk(hub, makeOffer());
    const slip = await signedSlip(seller, { jobId: jobId(), offerHash: hash, buyer: BUYER, amount: "1000" });
    putJob(hub, { offerHash: hash, status: "released", amount: "999999", slip });

    const second = await signedSlip(seller, { jobId: jobId(), offerHash: hash, buyer: BUYER, amount: "1000" });
    putJob(hub, { offerHash: hash, status: "released", buyer: BUYER_C, slip: second });

    const third = await signedSlip(seller, { jobId: jobId(), offerHash: hash, buyer: BUYER, amount: "1000" });
    putJob(hub, { offerHash: hash, status: "released", id: jobId(), slip: third });

    const rating = await getSeller(hub, seller.address);
    expect(rating.delivered).toBe(0);
    expect(rating.unverified).toBe(3);
  });

  test("a seller buying from itself earns nothing", async () => {
    const hash = await publishOk(hub, makeOffer());
    await delivered(hub, hash, seller.address);
    await delivered(hub, hash, seller.address.toLowerCase());
    putJob(hub, { offerHash: hash, status: "refunded", buyer: seller.address });

    const rating = await getSeller(hub, seller.address);
    expect(rating.selfDealt).toBe(3);
    expect(rating.delivered).toBe(0);
    expect(rating.refunded).toBe(0);
    expect(rating.score).toBeNull();
  });

  test("ratings sort by score, then deliveries, and an unrated seller comes last", async () => {
    const mine = await publishOk(hub, makeOffer());
    const theirs = makeOffer({ seller: other.address, title: "Other" });
    const published = await publish(hub, theirs, other);
    expect(published.status).toBe(201);
    const theirsHash = ((await published.json()) as { offerHash: Hex }).offerHash;

    await delivered(hub, mine, BUYER);
    putJob(hub, { offerHash: mine, status: "failed" });
    const otherSlip = await signedSlip(other, {
      jobId: jobId(),
      offerHash: theirsHash,
      buyer: BUYER,
      amount: "1000",
    });
    putJob(hub, { offerHash: theirsHash, status: "released", slip: otherSlip });

    const third = makeOffer({ title: "Mine again" });
    await publishOk(hub, third);

    const ratings = await getRatings(hub);
    expect(ratings.map((rating) => [rating.seller, rating.score])).toEqual([
      [other.address, 1],
      [seller.address, 0.5],
    ]);
    const detail = await getSeller(hub, seller.address.toLowerCase());
    expect(detail.seller).toBe(seller.address);
    expect(detail.offers).toHaveLength(2);
  });

  test("an unknown seller is a 404", async () => {
    const response = await fetch(`${hub.url}/ratings/${BUYER}`);
    expect(response.status).toBe(404);
    expect(((await response.json()) as ErrorBody).code).toBe("unknown-seller");
  });

  test("stats total the ledger by rail and count offers and sellers", async () => {
    const hash = await publishOk(hub, makeOffer());
    const old = await publishOk(hub, makeOffer({ title: "Old" }));
    hub.store.delistOffer(old, NOW);
    await delivered(hub, hash, BUYER, { amount: "1000" });
    await delivered(hub, hash, BUYER_B, { amount: "3000" });
    putJob(hub, { offerHash: hash, status: "failed" });
    putJob(hub, { offerHash: hash, status: "released" });

    const stats = await getStats(hub);
    expect(stats).toMatchObject({
      offers: { listed: 1, delisted: 1 },
      sellers: 1,
      buyers: 2,
      calls: 4,
      delivered: 2,
      failed: 1,
      unverified: 1,
      closed: 3,
      score: 0.6667,
      volume: "4000",
      byRail: { escrow: { calls: 4, delivered: 2, volume: "4000" } },
      runnersOnline: 0,
    });
  });

  test("a paid call and a janitor refund through the hub show up in ratings and stats", async () => {
    const hash = await publishOk(hub, makeOffer());
    let answerWell = true;
    runners.push(
      await connect(hub, hash, async () => (answerWell ? { output: { q: "hello" } } : { output: { wrong: true } })),
    );

    const entry = (await requirementsFor(hub, hash)).accepts[0];
    if (!entry) throw new Error("missing accepts entry");
    expect((await call(hub, hash, { q: "hello" }, paymentFor(entry))).status).toBe(200);

    answerWell = false;
    const second = paymentFor(entry, `0x${"22".repeat(32)}` as Hex);
    expect((await call(hub, hash, { q: "hello" }, second)).status).toBe(502);
    hub.setNow(NOW + 61);
    expect(await runJanitor(hub.deps)).toBe(1);

    const rating = await getSeller(hub, seller.address);
    expect(rating).toMatchObject({ delivered: 1, refunded: 1, failed: 0, closed: 2, score: 0.5, volume: "1000" });
    const stats = await getStats(hub);
    expect(stats.calls).toBe(2);
    expect(stats.runnersOnline).toBe(1);
  });
});

async function connect(
  hub: TestHub,
  hash: Hex,
  respond: (order: JobOrder) => Promise<{ output: unknown } | { fail: string }> = async () => ({
    output: { q: "hello" },
  }),
): Promise<RunnerHandle> {
  const runner = startRunner({ url: wsUrl(hub), account: seller, offers: [hash], now: () => NOW, respond });
  await runner.ready;
  return runner;
}
