import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { PrivateKeyAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import {
  canonicalHash,
  lockTypedData,
  runnerAuthMessage,
  slipBodyFor,
  slipHash,
  slipTypedData,
  type ErrorBody,
  type HubToRunner,
  type JobOrder,
  type PaymentPayload,
  type PaymentRequirements,
  type RunnerToHub,
} from "../src/deps.ts";
import { CHAIN_ID, ESCROW, FakeRail } from "./fake-rail.ts";
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

/** The address that would submit fund. A payee's Lock names it. */
const SUBMITTER = "0x6666666666666666666666666666666666666666" as Address;
const BUYER = "0x7777777777777777777777777777777777777777" as Address;
const SALT = "42";

class RecordingRail extends FakeRail {
  readonly funder?: Address;
  readonly settleOpts: Array<{ lockSig?: Hex } | undefined> = [];

  constructor(funder?: Address) {
    super();
    if (funder !== undefined) this.funder = funder;
  }

  override async settle(
    payment: PaymentPayload,
    requirements: PaymentRequirements,
    opts?: { lockSig?: Hex },
  ) {
    this.settleOpts.push(opts);
    return super.settle(payment, requirements);
  }
}

type LockFrame = Extract<HubToRunner, { t: "lock" }>;
type LockAnswer = { sig: Hex } | { refused: string };

interface LockRunnerOptions {
  url: string;
  account: PrivateKeyAccount;
  offers: Hex[];
  now: () => number;
  answer: (frame: LockFrame) => Promise<LockAnswer>;
}

interface LockRunner {
  ready: Promise<void>;
  close(): void;
  locks: LockFrame[];
}

/** A real WebSocket runner that signs hello, answers locks and jobs, and writes slips. */
function startLockRunner(options: LockRunnerOptions): LockRunner {
  const socket = new WebSocket(options.url);
  const locks: LockFrame[] = [];
  let settled = false;
  let resolveReady: () => void = () => undefined;
  let rejectReady: (error: Error) => void = () => undefined;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const settleReady = (): void => {
    if (settled) return;
    settled = true;
    resolveReady();
  };
  const failReady = (error: Error): void => {
    if (settled) return;
    settled = true;
    rejectReady(error);
  };

  const send = (frame: RunnerToHub): void => {
    socket.send(JSON.stringify(frame));
  };

  const answerJob = async (order: JobOrder): Promise<void> => {
    const body = slipBodyFor(
      order,
      options.account.address,
      canonicalHash(order.input),
      canonicalHash(order.input),
      options.now(),
    );
    const hash = slipHash(body);
    const sellerSig = await options.account.signTypedData(slipTypedData(body));
    send({
      t: "result",
      jobId: order.jobId,
      output: order.input,
      slip: { body, hash, sellerSig },
    });
  };

  const handle = async (text: string): Promise<void> => {
    let frame: HubToRunner;
    try {
      frame = JSON.parse(text) as HubToRunner;
    } catch {
      return;
    }

    switch (frame.t) {
      case "challenge": {
        const sig = await options.account.signMessage({
          message: runnerAuthMessage(frame.nonce),
        });
        send({
          t: "hello",
          seller: options.account.address,
          offers: options.offers,
          nonce: frame.nonce,
          sig,
        });
        break;
      }
      case "ready":
        settleReady();
        break;
      case "ping":
        send({ t: "pong", ts: frame.ts });
        break;
      case "job":
        try {
          await answerJob(frame.order);
        } catch (error) {
          send({
            t: "fail",
            jobId: frame.order.jobId,
            reason: error instanceof Error ? error.message : "refused",
          });
        }
        break;
      case "lock": {
        locks.push(frame);
        try {
          const answer = await options.answer(frame);
          if ("refused" in answer) {
            send({ t: "lock-refused", jobId: frame.jobId, reason: answer.refused });
          } else {
            send({ t: "locked", jobId: frame.jobId, sig: answer.sig });
          }
        } catch (error) {
          send({
            t: "lock-refused",
            jobId: frame.jobId,
            reason: error instanceof Error ? error.message : "refused",
          });
        }
        break;
      }
      case "error":
        failReady(new Error(frame.message));
        break;
    }
  };

  socket.onmessage = (event) => {
    void handle(String(event.data));
  };
  socket.onerror = () => failReady(new Error("runner socket error"));
  socket.onclose = () => failReady(new Error("runner socket closed"));

  return {
    ready,
    close: () => socket.close(),
    locks,
  };
}

function termsPayment(
  accepted: PaymentRequirements,
  terms: { bond?: string; reviewWindow?: number },
  nonce: Hex = NONCE,
): PaymentPayload {
  return {
    x402Version: 2,
    accepted,
    payload: {
      authorization: { nonce },
      terms: {
        buyer: BUYER,
        payee: seller.address,
        amount: "1000",
        deadline: NOW + 60,
        salt: SALT,
        bond: "0",
        reviewWindow: 0,
        ...terms,
      },
    },
  };
}

describe("the hub's lock step", () => {
  let hub: TestHub;
  let rail: RecordingRail;
  let runners: LockRunner[];

  beforeEach(() => {
    rail = new RecordingRail(SUBMITTER);
    hub = startHub({ rails: [rail] });
    runners = [];
  });

  afterEach(() => {
    for (const runner of runners) runner.close();
    hub.close();
  });

  async function connect(hash: Hex, answer: LockRunnerOptions["answer"]): Promise<LockRunner> {
    const runner = startLockRunner({
      url: wsUrl(hub),
      account: seller,
      offers: [hash],
      now: () => NOW,
      answer,
    });
    runners.push(runner);
    await runner.ready;
    return runner;
  }

  test("a bonded v2 payment settles with the seller's lock signature", async () => {
    const hash = await publishOk(hub, makeOffer({ bond: "100", reviewWindow: 300 }));
    let expected: Hex | undefined;
    const runner = await connect(hash, async (frame) => {
      expected = await seller.signTypedData(
        lockTypedData(frame.chainId, frame.escrow, frame.jobId, frame.funder),
      );
      return { sig: expected };
    });

    const entry = (await requirementsFor(hub, hash)).accepts[0];
    if (!entry) throw new Error("missing accepts entry");
    const response = await call(
      hub,
      hash,
      { q: "hello" },
      termsPayment(entry, { bond: "100", reviewWindow: 300 }),
    );

    expect(response.status).toBe(200);
    expect(runner.locks).toHaveLength(1);
    expect(runner.locks[0]).toMatchObject({
      jobId: NONCE,
      offerHash: hash,
      escrow: ESCROW,
      chainId: CHAIN_ID,
      bond: "100",
      funder: SUBMITTER,
      terms: {
        buyer: BUYER,
        payee: seller.address,
        amount: "1000",
        deadline: NOW + 60,
        salt: SALT,
        bond: "100",
        reviewWindow: 300,
      },
    });
    expect(rail.settleOpts).toEqual([{ lockSig: expected }]);
  });

  test("a refused lock answers 409 seller-declined and never settles", async () => {
    const hash = await publishOk(hub, makeOffer({ bond: "100", reviewWindow: 300 }));
    const runner = await connect(hash, async () => ({
      refused: "Refused. The seller did not accept.",
    }));

    const entry = (await requirementsFor(hub, hash)).accepts[0];
    if (!entry) throw new Error("missing accepts entry");
    const response = await call(
      hub,
      hash,
      { q: "hello" },
      termsPayment(entry, { bond: "100", reviewWindow: 300 }),
    );

    expect(response.status).toBe(409);
    const body = (await response.json()) as ErrorBody;
    expect(body.code).toBe("seller-declined");
    expect(body.message).toBe(
      "Refused. The seller did not accept this job, so nothing was charged.",
    );
    expect(runner.locks).toHaveLength(1);
    expect(rail.settleCalls).toHaveLength(0);
  });

  test("a lock that finds no runner answers 409 seller-declined and never settles", async () => {
    const hash = await publishOk(hub, makeOffer({ bond: "100", reviewWindow: 300 }));
    const runner = await connect(hash, async () => ({
      refused: "Refused. The seller did not accept.",
    }));
    hub.runners.lock = async () => ({ refused: "offline" });

    const entry = (await requirementsFor(hub, hash)).accepts[0];
    if (!entry) throw new Error("missing accepts entry");
    const response = await call(
      hub,
      hash,
      { q: "hello" },
      termsPayment(entry, { bond: "100", reviewWindow: 300 }),
    );

    expect(response.status).toBe(409);
    const body = (await response.json()) as ErrorBody;
    expect(body.code).toBe("seller-declined");
    expect(runner.locks).toHaveLength(0);
    expect(rail.settleCalls).toHaveLength(0);
  });

  test("a bonded call on a rail with no funder answers 503 and sends no lock", async () => {
    hub.close();
    rail = new RecordingRail();
    hub = startHub({ rails: [rail] });

    const hash = await publishOk(hub, makeOffer({ bond: "100", reviewWindow: 300 }));
    const runner = await connect(hash, async () => ({ sig: `0x${"ab".repeat(65)}` }));

    const entry = (await requirementsFor(hub, hash)).accepts[0];
    if (!entry) throw new Error("missing accepts entry");
    const response = await call(
      hub,
      hash,
      { q: "hello" },
      termsPayment(entry, { bond: "100", reviewWindow: 300 }),
    );

    expect(response.status).toBe(503);
    const body = (await response.json()) as ErrorBody;
    expect(body.code).toBe("rail-unavailable");
    expect(body.message).toBe(
      "Refused. This rail cannot fund a bonded job right now. Nothing was charged.",
    );
    expect(runner.locks).toHaveLength(0);
    expect(rail.settleCalls).toHaveLength(0);
  });

  test("an unbonded v2 payment never asks for a lock and settles with no opts", async () => {
    const hash = await publishOk(hub, makeOffer({ reviewWindow: 300 }));
    let lockCalls = 0;
    hub.runners.lock = async () => {
      lockCalls += 1;
      return { sig: `0x${"11".repeat(65)}` };
    };
    await connect(hash, async () => ({ refused: "Refused. No lock was expected." }));

    const entry = (await requirementsFor(hub, hash)).accepts[0];
    if (!entry) throw new Error("missing accepts entry");
    const response = await call(
      hub,
      hash,
      { q: "hello" },
      termsPayment(entry, { bond: "0", reviewWindow: 300 }),
    );

    expect(response.status).toBe(200);
    expect(lockCalls).toBe(0);
    expect(rail.settleOpts).toEqual([undefined]);
  });

  test("a v1 payment never asks for a lock and settles with no opts", async () => {
    const hash = await publishOk(hub, makeOffer());
    let lockCalls = 0;
    hub.runners.lock = async () => {
      lockCalls += 1;
      return { sig: `0x${"11".repeat(65)}` };
    };
    await connect(hash, async () => ({ refused: "Refused. No lock was expected." }));

    const entry = (await requirementsFor(hub, hash)).accepts[0];
    if (!entry) throw new Error("missing accepts entry");
    const response = await call(hub, hash, { q: "hello" }, paymentFor(entry));

    expect(response.status).toBe(200);
    expect(lockCalls).toBe(0);
    expect(rail.settleOpts).toEqual([undefined]);
  });
});
