import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  fromBase64Json,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  type CallResult,
  type ErrorBody,
  type JobOrder,
  type PaymentRequired,
  type SettleResult,
} from "../src/deps.ts";
import { runJanitor } from "../src/janitor.ts";
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
import { startRunner, type RunnerHandle } from "./runner-client.ts";

describe("paid calls", () => {
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

  test("an unpaid call answers 402 with the same body in the header", async () => {
    hub.close();
    hub = startHub({ rails: [new FakeRail("escrow"), new FakeRail("eip3009", "eip155:1874")] });
    const offer = makeOffer({ rails: ["eip3009", "escrow"] });
    const hash = await publishOk(hub, offer);
    runners.push(await connect(hub, hash));

    const response = await call(hub, hash, { q: "hello" });
    expect(response.status).toBe(402);

    const body = (await response.json()) as PaymentRequired;
    expect(body.x402Version).toBe(2);
    expect(body.resource.url).toBe(`http://hub.test/offers/${hash}/call`);
    expect(body.resource.description).toBe(offer.title);
    expect(body.accepts.map((item) => item.network)).toEqual(["eip155:1874", "eip155:5042002"]);

    const entry = body.accepts[0];
    if (!entry) throw new Error("missing accepts entry");
    expect(entry.scheme).toBe("countersign");
    expect(entry.network).toBe("eip155:1874");
    expect(entry.amount).toBe(offer.price);
    expect(entry.payTo).toBe(offer.seller);
    expect(entry.extra).toMatchObject({ escrow: "0x4444444444444444444444444444444444444444", chainId: 5042002 });

    const header = response.headers.get(PAYMENT_REQUIRED_HEADER);
    expect(header).not.toBeNull();
    expect(fromBase64Json<PaymentRequired>(header ?? "")).toEqual(body);
  });

  test("bad input is refused before any rail method runs", async () => {
    const hash = await publishOk(hub, makeOffer());

    const response = await call(hub, hash, { q: 42 });
    expect(response.status).toBe(422);

    const body = (await response.json()) as ErrorBody & { errors: string[] };
    expect(body.code).toBe("bad-input");
    expect(body.message).toBe("Refused. The input does not match the offer's schema.");
    expect(body.errors.length).toBeGreaterThan(0);
    expect(hub.rail.challengeCalls).toBe(0);
    expect(hub.rail.verifyCalls).toHaveLength(0);
    expect(hub.rail.settleCalls).toHaveLength(0);
  });

  test("an offline seller is refused with 503", async () => {
    const hash = await publishOk(hub, makeOffer());

    const response = await call(hub, hash, { q: "hello" });
    expect(response.status).toBe(503);

    const body = (await response.json()) as ErrorBody;
    expect(body.code).toBe("seller-offline");
    expect(body.message).toBe("The seller is offline. Nothing was charged.");
    expect(hub.rail.challengeCalls).toBe(0);
  });

  test("a paid call releases escrow and stores the slip", async () => {
    const offer = makeOffer();
    const hash = await publishOk(hub, offer);
    runners.push(await connect(hub, hash));

    const requirements = await requirementsFor(hub, hash);
    const entry = requirements.accepts[0];
    if (!entry) throw new Error("missing accepts entry");

    const response = await call(hub, hash, { q: "hello" }, paymentFor(entry));
    expect(response.status).toBe(200);

    const result = (await response.json()) as CallResult;
    expect(result.output).toEqual({ q: "hello" });
    expect(result.slip.hash).toBeDefined();
    expect(result.slip.body.jobId).toBe(NONCE);
    expect(result.slip.settlement.transaction).toBe(hub.rail.releaseTx);

    expect(hub.rail.verifyCalls).toHaveLength(1);
    expect(hub.rail.settleCalls).toHaveLength(1);
    expect(hub.rail.releaseCalls).toHaveLength(1);
    expect(hub.rail.releaseCalls[0]).toEqual({
      jobId: NONCE,
      slipHash: result.slip.hash,
      sellerSig: result.slip.sellerSig,
    });

    const paymentHeader = response.headers.get(PAYMENT_RESPONSE_HEADER);
    expect(paymentHeader).not.toBeNull();
    const settlement = fromBase64Json<SettleResult>(paymentHeader ?? "");
    expect(settlement.success).toBe(true);
    expect(settlement.transaction).toBe(hub.rail.releaseTx);

    const slipResponse = await fetch(`${hub.url}/slips/${result.slip.hash}`);
    expect(slipResponse.status).toBe(200);
    const storedSlip = (await slipResponse.json()) as CallResult["slip"];
    expect(storedSlip.hash).toBe(result.slip.hash);
    expect(storedSlip.body.outputHash).toBe(result.slip.body.outputHash);

    const jobResponse = await fetch(`${hub.url}/jobs/${NONCE}`);
    expect(jobResponse.status).toBe(200);
    const job = (await jobResponse.json()) as Record<string, unknown>;
    expect(job.status).toBe("released");
    expect(job.settleTx).toBe(hub.rail.settleTx);
    expect(job.closeTx).toBe(hub.rail.releaseTx);
    expect(job.slipHash).toBe(result.slip.hash);
  });

  test("a moved price is refused without verify or settle", async () => {
    const hash = await publishOk(hub, makeOffer());
    runners.push(await connect(hub, hash));

    const requirements = await requirementsFor(hub, hash);
    const entry = requirements.accepts[0];
    if (!entry) throw new Error("missing accepts entry");

    const response = await call(hub, hash, { q: "hello" }, paymentFor({ ...entry, amount: "2000" }));
    expect(response.status).toBe(402);

    const body = (await response.json()) as PaymentRequired;
    expect(body.error).toBe("Refused. The price moved after you signed.");
    expect(hub.rail.verifyCalls).toHaveLength(0);
    expect(hub.rail.settleCalls).toHaveLength(0);
  });

  test("an output that fails the schema is a failed delivery, then the janitor refunds", async () => {
    const hash = await publishOk(hub, makeOffer());
    runners.push(await connect(hub, hash, async () => ({ output: { q: 123 } })));

    const requirements = await requirementsFor(hub, hash);
    const entry = requirements.accepts[0];
    if (!entry) throw new Error("missing accepts entry");

    const response = await call(hub, hash, { q: "hello" }, paymentFor(entry));
    expect(response.status).toBe(502);

    const body = (await response.json()) as ErrorBody;
    expect(body.code).toBe("failed-delivery");
    expect(body.message).toBe(
      "Refused. The seller\'s output does not match the offer. Your money returns at the deadline.",
    );
    expect(hub.rail.releaseCalls).toHaveLength(0);

    const failed = await fetch(`${hub.url}/jobs/${NONCE}`).then((r) => r.json());
    expect((failed as { status: string }).status).toBe("failed");

    hub.setNow(NOW + 61);
    const refunded = await runJanitor(hub.deps);
    expect(refunded).toBe(1);
    expect(hub.rail.refundCalls).toEqual([NONCE]);

    const swept = await fetch(`${hub.url}/jobs/${NONCE}`).then((r) => r.json());
    expect((swept as { status: string }).status).toBe("refunded");
    expect((swept as { closeTx: string }).closeTx).toBe(hub.rail.refundTx);
  });
});

async function connect(
  hub: TestHub,
  hash: `0x${string}`,
  respond: (order: JobOrder) => Promise<{ output: unknown } | { fail: string }> = async () => ({
    output: { q: "hello" },
  }),
): Promise<RunnerHandle> {
  const runner = startRunner({
    url: wsUrl(hub),
    account: seller,
    offers: [hash],
    now: () => NOW,
    respond,
  });
  await runner.ready;
  return runner;
}
