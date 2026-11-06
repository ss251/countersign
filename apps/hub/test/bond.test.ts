/**
 * The hub's delivery gate and the seller bond. A gate failure asks the escrow's arbiter to fail
 * the job; a runner error or a timeout does not, and keeps the deadline refund.
 */

import { afterEach, describe, expect, test } from "bun:test";
import type { Hex } from "viem";
import type { ErrorBody, JobOrder } from "../src/deps.ts";
import { GATE_FAILED } from "../src/bond.ts";
import { startRunner, type RunnerHandle } from "./runner-client.ts";
import { NETWORK } from "./fake-rail.ts";
import {
  call,
  makeOffer,
  NONCE,
  paymentFor,
  publishOk,
  requirementsFor,
  seller,
  startHub,
  wsUrl,
  type TestHub,
} from "./support.ts";

const FAIL_TX = `0x${"dd".repeat(32)}` as Hex;

function gateFails(hub: TestHub): Hex[] {
  const calls: Hex[] = [];
  const escrow = hub.rail.escrow;
  if (!escrow) throw new Error("the test rail has no escrow");
  escrow.failDelivery = async (jobId) => {
    calls.push(jobId);
    return { success: true, transaction: FAIL_TX, network: NETWORK };
  };
  return calls;
}

describe("the delivery gate and the seller bond", () => {
  let hub: TestHub;
  let runners: RunnerHandle[] = [];

  afterEach(() => {
    for (const runner of runners) runner.close();
    runners = [];
    hub.close();
  });

  test("a gate failure calls failDelivery once and answers with the bond message", async () => {
    hub = startHub();
    const calls = gateFails(hub);
    const hash = await publishOk(hub, makeOffer());
    runners.push(await connect(hub, hash, async () => ({ output: { q: 123 } })));

    const entry = (await requirementsFor(hub, hash)).accepts[0];
    if (!entry) throw new Error("missing accepts entry");
    const response = await call(hub, hash, { q: "hello" }, paymentFor(entry));

    expect(response.status).toBe(502);
    const body = (await response.json()) as ErrorBody;
    expect(body.code).toBe("failed-delivery");
    expect(body.message).toBe(GATE_FAILED);
    expect(calls).toEqual([NONCE]);

    const job = (await fetch(`${hub.url}/jobs/${NONCE}`).then((r) => r.json())) as {
      status: string;
      closeTx: string | null;
    };
    expect(job.status).toBe("failed");
    expect(job.closeTx).toBe(FAIL_TX);
  });

  test("a runner error does not call failDelivery and keeps the deadline refund message", async () => {
    hub = startHub();
    const calls = gateFails(hub);
    const hash = await publishOk(hub, makeOffer());
    runners.push(await connect(hub, hash, async () => ({ fail: "the skill refused" })));

    const entry = (await requirementsFor(hub, hash)).accepts[0];
    if (!entry) throw new Error("missing accepts entry");
    const response = await call(hub, hash, { q: "hello" }, paymentFor(entry));

    expect(response.status).toBe(502);
    const body = (await response.json()) as ErrorBody;
    expect(body.message).toBe(
      "Refused. The seller's output does not match the offer. Your money returns at the deadline.",
    );
    expect(calls).toHaveLength(0);
  });

  test("a rail without failDelivery keeps today's message", async () => {
    hub = startHub();
    const hash = await publishOk(hub, makeOffer());
    runners.push(await connect(hub, hash, async () => ({ output: { q: 123 } })));

    const entry = (await requirementsFor(hub, hash)).accepts[0];
    if (!entry) throw new Error("missing accepts entry");
    const response = await call(hub, hash, { q: "hello" }, paymentFor(entry));

    expect(response.status).toBe(502);
    const body = (await response.json()) as ErrorBody;
    expect(body.message).toBe(
      "Refused. The seller's output does not match the offer. Your money returns at the deadline.",
    );
  });
});

async function connect(
  hub: TestHub,
  hash: Hex,
  respond: (order: JobOrder) => Promise<{ output: unknown } | { fail: string }>,
): Promise<RunnerHandle> {
  const runner = startRunner({
    url: wsUrl(hub),
    account: seller,
    offers: [hash],
    now: () => 1_700_000_000,
    respond,
  });
  await runner.ready;
  return runner;
}
