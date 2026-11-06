import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { keccak256, toBytes, type Hex } from "viem";
import {
  offerHash,
  type JobOrder,
  type Network,
  type Offer,
  type PaymentPayload,
} from "../src/deps.ts";
import type { Order } from "../src/orders.ts";
import type { JobStatus } from "../src/store.ts";
import { ASSET, BUYER, FakeRail } from "./fake-rail.ts";
import { startRunner, type JobAnswer } from "./runner-client.ts";
import {
  call,
  makeOffer,
  NOW,
  paymentFor,
  publishOk,
  requirementsFor,
  seller,
  startHub,
  wsUrl,
  type TestHub,
} from "./support.ts";

/** A rail that settles only after the delivery gate, like Hedera exact payments. */
class DeferredRail extends FakeRail {
  readonly settlesAfterDelivery = true;
  pendingResult: { transaction: string; validUntil: number } | null;

  constructor() {
    super("hedera", "hedera:testnet");
    this.pendingResult = { transaction: this.settleTx, validUntil: NOW + 600 };
  }

  pending(): { transaction: string; validUntil: number } | null {
    return this.pendingResult;
  }
}

const HEDERA: Network = "hedera:testnet";

function payment(network: Network): PaymentPayload {
  return {
    x402Version: 2,
    accepted: {
      scheme: "countersign",
      network,
      amount: "1000",
      asset: ASSET,
      payTo: seller.address,
      maxTimeoutSeconds: 120,
    },
    payload: {},
  };
}

function seedOffer(hub: TestHub): Hex {
  const offer: Offer = makeOffer({ rails: ["hedera"] });
  const hash = offerHash(offer);
  hub.store.putOffer(hash, seller.address, offer, NOW);
  return hash;
}

interface SeedJob {
  id: Hex;
  rail: "hedera" | "escrow";
  status: JobStatus;
  settleTx?: string | null;
}

function seedJob(hub: TestHub, hash: Hex, job: SeedJob): void {
  hub.store.putJob({
    jobId: job.id,
    offerHash: hash,
    rail: job.rail,
    buyer: BUYER,
    amount: "1000",
    deadline: NOW + 120,
    status: job.status,
    payment: payment(job.rail === "hedera" ? HEDERA : "eip155:5042002"),
    settleTx: job.settleTx ?? null,
    closeTx: null,
    slipHash: null,
    createdAt: NOW,
  });
}

async function ordersBy(hub: TestHub): Promise<Map<string, Order>> {
  const response = await fetch(`${hub.url}/orders?seller=${seller.address}`);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { orders: Order[] };
  return new Map(body.orders.map((order) => [order.id, order]));
}

describe("orders never show money that settle-after-delivery did not move", () => {
  let hub: TestHub;

  beforeEach(() => {
    hub = startHub({ rails: [new DeferredRail(), new FakeRail("escrow")] });
  });

  afterEach(() => {
    hub.close();
  });

  test("a verified job is pending and received nothing", async () => {
    const hash = seedOffer(hub);
    const id = `0x${"21".repeat(32)}` as Hex;
    seedJob(hub, hash, { id, rail: "hedera", status: "verified" });

    const order = (await ordersBy(hub)).get(id);
    expect(order?.status).toBe("pending");
    expect(order?.receivedAt).toBeNull();
  });

  test("a failed job with no settle transaction is cancelled and received nothing", async () => {
    const hash = seedOffer(hub);
    const id = `0x${"22".repeat(32)}` as Hex;
    seedJob(hub, hash, { id, rail: "hedera", status: "failed", settleTx: null });

    const order = (await ordersBy(hub)).get(id);
    expect(order?.status).toBe("cancelled");
    expect(order?.receivedAt).toBeNull();
  });

  test("a failed job that settled before delivery still shows paid", async () => {
    const hash = seedOffer(hub);
    const id = `0x${"23".repeat(32)}` as Hex;
    const settleTx = `0x${"ab".repeat(32)}`;
    seedJob(hub, hash, { id, rail: "hedera", status: "failed", settleTx });

    const order = (await ordersBy(hub)).get(id);
    expect(order?.status).toBe("paid");
    expect(order?.receivedAt).toBe(NOW * 1000);
  });

  test("a funded escrow job still shows held", async () => {
    const hash = seedOffer(hub);
    const id = `0x${"24".repeat(32)}` as Hex;
    seedJob(hub, hash, {
      id,
      rail: "escrow",
      status: "funded",
      settleTx: `0x${"cd".repeat(32)}`,
    });

    const order = (await ordersBy(hub)).get(id);
    expect(order?.status).toBe("held");
    expect(order?.receivedAt).toBeNull();
  });
});

describe("settle-after-delivery records a settle transaction only when it lands", () => {
  let hub: TestHub;
  let rail: DeferredRail;
  let close: () => void;

  beforeEach(() => {
    rail = new DeferredRail();
    hub = startHub({ rails: [rail] });
    close = () => undefined;
  });

  afterEach(() => {
    close();
    hub.close();
  });

  async function connect(hash: Hex, respond: (order: JobOrder) => Promise<JobAnswer>): Promise<void> {
    const runner = startRunner({
      url: wsUrl(hub),
      account: seller,
      offers: [hash],
      now: () => NOW,
      respond,
    });
    await runner.ready;
    close = () => runner.close();
  }

  async function paid(hash: Hex): Promise<Response> {
    const entry = (await requirementsFor(hub, hash)).accepts[0];
    if (!entry) throw new Error("missing accepts entry");
    return call(hub, hash, { q: "hello" }, paymentFor(entry));
  }

  const answer = async (): Promise<JobAnswer> => ({ output: { q: "hello" } });

  test("a success stores settle's transaction", async () => {
    const hash = await publishOk(hub, makeOffer({ rails: ["hedera"] }));
    await connect(hash, answer);

    const response = await paid(hash);
    expect(response.status).toBe(200);

    const job = hub.store.getJob(keccak256(toBytes(rail.settleTx)));
    expect(job?.status).toBe("settled");
    expect(job?.settleTx).toBe(rail.settleTx);
  });

  test("a failed delivery stores no settle transaction", async () => {
    const hash = await publishOk(hub, makeOffer({ rails: ["hedera"] }));
    await connect(hash, async () => ({ fail: "cannot serve" }));

    const response = await paid(hash);
    expect(response.status).toBe(502);

    const job = hub.store.getJob(keccak256(toBytes(rail.settleTx)));
    expect(job?.status).toBe("failed");
    expect(job?.settleTx).toBeNull();
  });

  test("a settle failure after delivery stores no settle transaction", async () => {
    const hash = await publishOk(hub, makeOffer({ rails: ["hedera"] }));
    rail.failSettle = true;
    await connect(hash, answer);

    const response = await paid(hash);
    expect(response.status).toBe(502);

    const job = hub.store.getJob(keccak256(toBytes(rail.settleTx)));
    expect(job?.status).toBe("failed");
    expect(job?.settleTx).toBeNull();
  });
});
