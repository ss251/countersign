import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Hex } from "viem";
import { lineageCycle } from "../src/call.ts";
import { PAYMENT_REQUIRED_HEADER, type ErrorBody } from "../src/deps.ts";
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

describe("lineage naming the offer or seller directly", () => {
  let hub: TestHub;
  let runners: RunnerHandle[];
  let offerA: Hex;
  let offerC: Hex;

  beforeEach(async () => {
    hub = startHub();
    runners = [];
    offerA = await publishOk(hub, makeOffer());
    await publishOk(hub, makeOffer({ title: "Echo the answer" }));
    const c = await publish(hub, makeOffer({ seller: other.address, title: "Echo the note" }), other);
    if (c.status !== 201) throw new Error(`publish failed with ${c.status}`);
    offerC = ((await c.json()) as { offerHash: Hex }).offerHash;
  });

  afterEach(() => {
    for (const runner of runners) runner.close();
    hub.close();
  });

  // An offer hash repeated in the lineage is #214's purchase cycle (422), checked first; the
  // seller and ancestor-job cases below stay D17's lineage cycle (409). Both come before any 402.
  test("a lineage naming the target's own offer hash is refused with 422 and no 402", async () => {
    const response = await callWithLineage(offerA, { q: "hello" }, [offerA]);

    expect(response.status).toBe(422);
    const body = (await response.json()) as ErrorBody;
    expect(body.code).toBe("purchase-cycle");
    expect(response.headers.get(PAYMENT_REQUIRED_HEADER)).toBeNull();
  });

  test("a lineage naming the target's seller is refused with 409", async () => {
    const response = await callWithLineage(offerA, { q: "hello" }, [seller.address]);

    expect(response.status).toBe(409);
    const body = (await response.json()) as ErrorBody;
    expect(body.code).toBe("lineage-cycle");
  });

  test("the comparison does not care about case", async () => {
    const upper = `0x${offerA.slice(2).toUpperCase()}` as Hex;

    const response = await callWithLineage(offerA, { q: "hello" }, [upper]);

    expect(response.status).toBe(422);
    const body = (await response.json()) as ErrorBody;
    expect(body.code).toBe("purchase-cycle");
    expect(response.headers.get(PAYMENT_REQUIRED_HEADER)).toBeNull();
  });

  test("another offer's hash is not this offer's cycle and still answers 402", async () => {
    runners.push(await connect(offerA));

    const response = await callWithLineage(offerA, { q: "hello" }, [offerC]);

    expect(response.status).toBe(402);
  });

  test("lineageCycle reads the offer hash and seller entries directly", () => {
    const storedA = hub.store.getOffer(offerA);
    if (storedA === null) throw new Error("missing offer");

    expect(lineageCycle(hub.store, storedA, [offerA])).toBe(true);
    expect(lineageCycle(hub.store, storedA, [seller.address])).toBe(true);
    expect(lineageCycle(hub.store, storedA, [offerC])).toBe(false);
  });

  function callWithLineage(hash: Hex, input: unknown, lineage: Hex[]): Promise<Response> {
    return fetch(`${hub.url}/offers/${hash}/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input, lineage }),
    });
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
