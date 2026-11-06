import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Hex } from "viem";
import { lineageCycle } from "../src/call.ts";
import { PAYMENT_REQUIRED_HEADER, type ErrorBody, type PaymentPayload } from "../src/deps.ts";
import type { JobRecord, JobStatus } from "../src/store.ts";
import { ASSET, BUYER, ESCROW, NETWORK } from "./fake-rail.ts";
import {
  makeOffer,
  NOW,
  other,
  publish,
  publishOk,
  seller,
  startHub,
  wsUrl,
  type TestHub,
} from "./support.ts";
import { startRunner, type RunnerHandle } from "./runner-client.ts";

describe("lineage cycle refusal", () => {
  let hub: TestHub;
  let runners: RunnerHandle[];
  let offerA: Hex;
  let offerB: Hex;
  let offerC: Hex;
  let jobJ1: Hex;
  let jobJ2: Hex;

  beforeEach(async () => {
    hub = startHub();
    runners = [];
    offerA = await publishOk(hub, makeOffer());
    offerB = await publishOk(hub, makeOffer({ title: "Echo the answer" }));
    const c = await publish(hub, makeOffer({ seller: other.address, title: "Echo the note" }), other);
    if (c.status !== 201) throw new Error(`publish failed with ${c.status}`);
    offerC = ((await c.json()) as { offerHash: Hex }).offerHash;

    jobJ1 = id("a1");
    jobJ2 = id("b2");
    hub.store.putJob(jobFor({ jobId: jobJ1, offerHash: offerA, createdAt: NOW }));
    hub.store.putJob(jobFor({ jobId: jobJ2, offerHash: offerC, createdAt: NOW + 1 }));
  });

  afterEach(() => {
    for (const runner of runners) runner.close();
    hub.close();
  });

  test("a call on the same offer as its ancestor is refused with 409 and no 402", async () => {
    const response = await callWithLineage(offerA, { q: "hello" }, [jobJ1]);

    expect(response.status).toBe(409);
    const body = (await response.json()) as ErrorBody;
    expect(body.code).toBe("lineage-cycle");
    expect(response.headers.get(PAYMENT_REQUIRED_HEADER)).toBeNull();
  });

  test("a call on another offer by the ancestor's seller is refused with 409", async () => {
    const response = await callWithLineage(offerB, { q: "hello" }, [jobJ1]);

    expect(response.status).toBe(409);
    const body = (await response.json()) as ErrorBody;
    expect(body.code).toBe("lineage-cycle");
  });

  test("a matching ancestor deeper in the lineage is refused with 409", async () => {
    const response = await callWithLineage(offerB, { q: "hello" }, [jobJ2, jobJ1]);

    expect(response.status).toBe(409);
    const body = (await response.json()) as ErrorBody;
    expect(body.code).toBe("lineage-cycle");
  });

  test("an unrelated ancestor still answers 402", async () => {
    runners.push(await connect(offerA));

    const response = await callWithLineage(offerA, { q: "hello" }, [jobJ2]);

    expect(response.status).toBe(402);
  });

  test("a jobId the store does not know is skipped and still answers 402", async () => {
    runners.push(await connect(offerA));

    const response = await callWithLineage(offerA, { q: "hello" }, [`0x${"9".repeat(64)}`]);

    expect(response.status).toBe(402);
  });

  test("a call with no lineage still answers 402", async () => {
    runners.push(await connect(offerA));

    const response = await call(hub.url, offerA, { input: { q: "hello" } });

    expect(response.status).toBe(402);
  });

  test("the cycle check runs before the input schema gate", async () => {
    const response = await callWithLineage(offerA, { q: 42 }, [jobJ1]);

    expect(response.status).toBe(409);
    const body = (await response.json()) as ErrorBody;
    expect(body.code).toBe("lineage-cycle");
  });

  test("lineageCycle reads each known ancestor directly", () => {
    const targetA = hub.store.getOffer(offerA);
    const targetB = hub.store.getOffer(offerB);
    if (targetA === null || targetB === null) throw new Error("missing offer");

    expect(lineageCycle(hub.store, targetA, [])).toBe(false);
    expect(lineageCycle(hub.store, targetA, [jobJ1])).toBe(true);
    expect(lineageCycle(hub.store, targetB, [jobJ1])).toBe(true);
    expect(lineageCycle(hub.store, targetB, [jobJ2, jobJ1])).toBe(true);
  });

  function callWithLineage(hash: Hex, input: unknown, lineage: Hex[]): Promise<Response> {
    return call(hub.url, hash, { input, lineage });
  }

  async function connect(hash: Hex): Promise<RunnerHandle> {
    const runner = startRunner({
      url: wsUrl(hub),
      account: seller,
      offers: [hash],
      now: () => NOW,
      respond: async () => ({ output: { q: "hello" } }),
    });
    await runner.ready;
    return runner;
  }
});

function call(url: string, hash: Hex, body: unknown): Promise<Response> {
  return fetch(`${url}/offers/${hash}/call`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function id(label: string): Hex {
  const padded = label.padStart(64, "0").slice(-64);
  return `0x${padded}` as Hex;
}

function jobFor(values: { jobId: Hex; offerHash: Hex; createdAt: number }): JobRecord {
  return {
    jobId: values.jobId,
    offerHash: values.offerHash,
    rail: "escrow",
    buyer: BUYER,
    amount: "1000",
    deadline: values.createdAt + 60,
    status: "settled" satisfies JobStatus,
    payment: paymentOf("1000", ESCROW),
    settleTx: null,
    closeTx: null,
    slipHash: null,
    createdAt: values.createdAt,
    closedAt: null,
  };
}

function paymentOf(amount: string, payTo: string): PaymentPayload {
  return {
    x402Version: 2,
    accepted: {
      scheme: "countersign",
      network: NETWORK,
      amount,
      asset: ASSET,
      payTo,
      maxTimeoutSeconds: 120,
    },
    payload: {},
  };
}
