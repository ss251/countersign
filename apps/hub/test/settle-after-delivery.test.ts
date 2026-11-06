import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Hex } from "viem";
import {
  canonicalHash,
  runnerAuthMessage,
  slipBodyFor,
  slipTypedData,
  ZERO_HASH,
  type CallResult,
  type ErrorBody,
  type JobOrder,
  type PaymentPayload,
  type PaymentRequirements,
  type PaymentRequired,
} from "../src/deps.ts";
import {
  call,
  makeOffer,
  NONCE,
  NOW,
  paymentFor,
  publishOk,
  requirementsFor,
  seller,
  startHub,
  wsUrl,
  type TestHub,
} from "./support.ts";
import { FakeRail } from "./fake-rail.ts";
import { startRunner, type JobAnswer } from "./runner-client.ts";

class DeferredRail extends FakeRail {
  readonly settlesAfterDelivery = true;
  readonly log: string[];
  pendingResult: { transaction: string; validUntil: number } | null;

  constructor(log: string[]) {
    super("hedera", "hedera:testnet");
    this.log = log;
    this.pendingResult = { transaction: this.settleTx, validUntil: NOW + 600 };
  }

  override async verify(payment: PaymentPayload, requirements: PaymentRequirements) {
    this.log.push("verify");
    return super.verify(payment, requirements);
  }

  override async settle(payment: PaymentPayload, requirements: PaymentRequirements) {
    this.log.push("settle");
    return super.settle(payment, requirements);
  }

  pending(_payment: PaymentPayload): { transaction: string; validUntil: number } | null {
    return this.pendingResult;
  }
}

/** A rail that takes the money up front, like an escrow: no `settlesAfterDelivery`, no `pending`. */
class EagerRail extends FakeRail {
  readonly log: string[];

  constructor(log: string[]) {
    super("hedera", "hedera:testnet");
    this.log = log;
  }

  override async verify(payment: PaymentPayload, requirements: PaymentRequirements) {
    this.log.push("verify");
    return super.verify(payment, requirements);
  }

  override async settle(payment: PaymentPayload, requirements: PaymentRequirements) {
    this.log.push("settle");
    return super.settle(payment, requirements);
  }
}

const OFFER = makeOffer({ rails: ["hedera"] });

describe("settle after delivery", () => {
  let hub: TestHub;
  let rail: DeferredRail;
  let log: string[];
  let closes: Array<() => void>;

  beforeEach(() => {
    log = [];
    rail = new DeferredRail(log);
    hub = startHub({ rails: [rail] });
    closes = [];
  });

  afterEach(() => {
    for (const close of closes) close();
    hub.close();
  });

  async function connectOn(
    target: TestHub,
    hash: Hex,
    respond: (order: JobOrder) => Promise<JobAnswer> = async () => {
      log.push("dispatch");
      return { output: { q: "hello" } };
    },
  ): Promise<void> {
    const runner = startRunner({ url: wsUrl(target), account: seller, offers: [hash], now: () => NOW, respond });
    await runner.ready;
    closes.push(() => runner.close());
  }

  async function connect(hash: Hex, respond?: (order: JobOrder) => Promise<JobAnswer>): Promise<void> {
    await connectOn(hub, hash, respond);
  }

  async function paidOn(target: TestHub, hash: Hex): Promise<Response> {
    const entry = (await requirementsFor(target, hash)).accepts[0];
    if (!entry) throw new Error("missing accepts entry");
    return call(target, hash, { q: "hello" }, paymentFor(entry));
  }

  async function paid(hash: Hex): Promise<Response> {
    return paidOn(hub, hash);
  }

  test("a failed delivery never settles", async () => {
    const hash = await publishOk(hub, OFFER);
    await connect(hash, async () => {
      log.push("dispatch");
      return { fail: "cannot serve" };
    });

    const response = await paid(hash);
    expect(response.status).toBe(502);

    const body = (await response.json()) as ErrorBody;
    expect(body.code).toBe("failed-delivery");
    expect(body.message).toBe(
      "Not delivered. Nothing was charged: this hub settles a Hedera payment only after delivery, so your signed transfer was never submitted and expires unused.",
    );
    expect(log.filter((entry) => entry === "verify")).toHaveLength(1);
    expect(log).not.toContain("settle");
    expect(hub.store.getJob(NONCE)?.status).toBe("failed");
  });

  test("a slip whose hash does not match its body never settles", async () => {
    const hash = await publishOk(hub, OFFER);
    await tamperingRunner(hash);

    const response = await paid(hash);
    expect(response.status).toBe(502);

    const body = (await response.json()) as ErrorBody;
    expect(body.code).toBe("failed-delivery");
    expect(log).not.toContain("settle");
    expect(hub.store.getJob(NONCE)?.status).toBe("failed");
  });

  test("a passing delivery verifies, dispatches, then settles", async () => {
    const hash = await publishOk(hub, OFFER);
    await connect(hash);

    const response = await paid(hash);
    expect(response.status).toBe(200);

    const result = (await response.json()) as CallResult;
    expect(log).toEqual(["verify", "dispatch", "settle"]);
    expect(result.slip.settlement.transaction).toBe(rail.settleTx);
    expect(hub.store.getJob(NONCE)?.status).toBe("settled");
  });

  test("a 120-second offer accepts a 180-second transfer signed 8 seconds ago", async () => {
    const hash = await publishOk(hub, OFFER);
    await connect(hash);
    const validStart = NOW - 8;
    const validDuration = 180;
    rail.pendingResult = { transaction: rail.settleTx, validUntil: validStart + validDuration };
    expect(validStart + validDuration).toBeGreaterThanOrEqual(NOW + OFFER.deadline + 30);
    expect(validStart + 120).toBeLessThan(NOW + OFFER.deadline + 30);

    const entry = (await requirementsFor(hub, hash)).accepts[0];
    if (!entry) throw new Error("missing accepts entry");
    const payment: PaymentPayload = {
      x402Version: 2,
      accepted: entry,
      payload: { authorization: { nonce: NONCE } },
    };

    const response = await call(hub, hash, { q: "hello" }, payment);
    expect(response.status).toBe(200);
    expect(log).toEqual(["verify", "dispatch", "settle"]);
    expect(hub.store.getJob(NONCE)?.status).toBe("settled");
  });

  test("a transfer that expires before the deadline is refused before dispatch", async () => {
    const hash = await publishOk(hub, OFFER);
    await connect(hash);
    rail.pendingResult = { transaction: rail.settleTx, validUntil: NOW + OFFER.deadline + 10 };

    const entry = (await requirementsFor(hub, hash)).accepts[0];
    if (!entry) throw new Error("missing accepts entry");
    const payment: PaymentPayload = {
      x402Version: 2,
      accepted: entry,
      payload: { authorization: { nonce: NONCE } },
    };

    const response = await call(hub, hash, { q: "hello" }, payment);
    expect(response.status).toBe(402);

    const body = (await response.json()) as PaymentRequired;
    expect(body.error).toBe(
      "Refused. Your signed Hedera transfer expires before this offer's deadline. Sign a fresh one and retry. Nothing was charged.",
    );
    expect(log).not.toContain("dispatch");
    expect(log).not.toContain("settle");
    expect(hub.store.getJob(NONCE)).toBeNull();
  });

  test("a settle failure after delivery withholds the output", async () => {
    const hash = await publishOk(hub, OFFER);
    rail.failSettle = true;
    await connect(hash);

    const response = await paid(hash);
    expect(response.status).toBe(502);

    const body = (await response.json()) as ErrorBody & { output?: unknown };
    expect(body.code).toBe("settle-failed");
    expect("output" in body).toBe(false);
    expect(hub.store.getJob(NONCE)?.status).toBe("failed");
  });

  test("a settle that throws after delivery stores no slip", async () => {
    const hash = await publishOk(hub, OFFER);
    rail.throwSettle = true;
    await connect(hash);

    const response = await paid(hash);
    expect(response.status).toBe(502);

    const body = (await response.json()) as ErrorBody & { output?: unknown };
    expect(body.code).toBe("settle-failed");
    expect("output" in body).toBe(false);
    expect(hub.store.getJob(NONCE)?.status).toBe("failed");
    const job = hub.store.ratingJobs().find((row) => row.jobId === NONCE);
    expect(job?.slip).toBeNull();
  });

  test("the same payment is refused as a duplicate and dispatches once", async () => {
    const hash = await publishOk(hub, OFFER);
    await connect(hash);

    const entry = (await requirementsFor(hub, hash)).accepts[0];
    if (!entry) throw new Error("missing accepts entry");
    const payment = paymentFor(entry);

    const first = await call(hub, hash, { q: "hello" }, payment);
    expect(first.status).toBe(200);

    const second = await call(hub, hash, { q: "hello" }, payment);
    expect(second.status).toBe(409);
    expect(((await second.json()) as ErrorBody).code).toBe("duplicate-payment");
    expect(log.filter((entry) => entry === "dispatch")).toHaveLength(1);
  });

  test("a payment that cannot wait settles before dispatch", async () => {
    const hash = await publishOk(hub, OFFER);
    rail.pendingResult = null;
    await connect(hash);

    const response = await paid(hash);
    expect(response.status).toBe(200);
    expect(log).toEqual(["verify", "settle", "dispatch"]);
  });

  test("a rail without settlesAfterDelivery keeps settle before dispatch", async () => {
    const eager = new EagerRail(log);
    const direct = startHub({ rails: [eager] });
    closes.push(() => direct.close());
    const hash = await publishOk(direct, OFFER);
    await connectOn(direct, hash);

    const response = await paidOn(direct, hash);
    expect(response.status).toBe(200);
    expect(log).toEqual(["verify", "settle", "dispatch"]);
  });

  test("the dispatch timeout stays inside the signed transfer's window", async () => {
    const patient = startHub({ rails: [rail], jobTimeoutMs: 180_000 });
    closes.push(() => patient.close());
    const hash = await publishOk(patient, OFFER);
    await connectOn(patient, hash);
    const validUntil = NOW + 100;
    rail.pendingResult = { transaction: rail.settleTx, validUntil };

    const timeouts: number[] = [];
    const original = patient.runners.dispatch.bind(patient.runners);
    patient.runners.dispatch = async (order, timeoutMs) => {
      timeouts.push(timeoutMs);
      return original(order, timeoutMs);
    };

    const response = await paidOn(patient, hash);
    expect(response.status).toBe(200);
    expect(timeouts).toHaveLength(1);
    expect(timeouts[0]).toBeLessThanOrEqual((validUntil - NOW - 30) * 1000);
  });

  /** A real runner whose slip carries a hash that does not match its body. */
  async function tamperingRunner(hash: Hex): Promise<void> {
    const socket = new WebSocket(wsUrl(hub));
    let settleReady: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      settleReady = resolve;
    });
    closes.push(() => socket.close());

    const send = (frame: unknown): void => socket.send(JSON.stringify(frame));
    const handle = async (text: string): Promise<void> => {
      const frame = JSON.parse(text) as { t?: string; nonce?: string; order?: JobOrder };
      if (frame.t === "challenge" && typeof frame.nonce === "string") {
        const sig = await seller.signMessage({ message: runnerAuthMessage(frame.nonce) });
        send({ t: "hello", seller: seller.address, offers: [hash], nonce: frame.nonce, sig });
        return;
      }
      if (frame.t === "ready") {
        settleReady();
        return;
      }
      if (frame.t === "ping") {
        send({ t: "pong", ts: 0 });
        return;
      }
      if (frame.t !== "job" || frame.order === undefined) return;
      log.push("dispatch");
      const order = frame.order;
      const body = slipBodyFor(
        order,
        seller.address,
        canonicalHash(order.input),
        canonicalHash({ q: "hello" }),
        NOW,
        [],
      );
      const sellerSig = await seller.signTypedData(slipTypedData(body));
      send({
        t: "result",
        jobId: order.jobId,
        output: { q: "hello" },
        slip: { body, hash: ZERO_HASH, sellerSig },
      });
    };

    socket.onmessage = (event) => {
      void handle(String(event.data)).catch(() => undefined);
    };
    socket.onerror = () => settleReady();
    await ready;
  }
});
