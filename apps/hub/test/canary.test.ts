import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Hex } from "viem";
import { runCanary } from "../src/canary.ts";
import { makeOffer, NOW, publishOk, seller, startHub, wsUrl, type TestHub } from "./support.ts";
import { startRunner, type RunnerHandle, type RunnerOptions } from "./runner-client.ts";

const OPTIONS = { attempts: 3, gapMs: 10, timeoutMs: 200 };

describe("canary", () => {
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

  test("a healthy runner keeps its offer listed", async () => {
    const hash = await publishOk(hub, makeOffer());
    runners.push(await connect(hub, hash, "answer"));

    const result = await runCanary(deps(hub), OPTIONS);

    expect(result.checked).toEqual([hash]);
    expect(result.delisted).toEqual([]);
    expect(await listed(hub)).toContain(hash);
  });

  test("a silent runner's offer is delisted", async () => {
    const hash = await publishOk(hub, makeOffer());
    runners.push(await connect(hub, hash, "ignore"));

    const result = await runCanary(deps(hub), OPTIONS);

    expect(result.checked).toEqual([hash]);
    expect(result.delisted).toEqual([hash]);
    expect(await listed(hub)).not.toContain(hash);
    expect((await callOffer(hub, hash)).status).toBe(404);
  });

  test("a runner signing with the wrong key delists its offer", async () => {
    const hash = await publishOk(hub, makeOffer());
    runners.push(await connect(hub, hash, "wrong-key"));

    const result = await runCanary(deps(hub), OPTIONS);

    expect(result.checked).toEqual([hash]);
    expect(result.delisted).toEqual([hash]);
    expect(await listed(hub)).not.toContain(hash);
  });

  test("a runner refusing the canary delists its offer", async () => {
    const hash = await publishOk(hub, makeOffer());
    runners.push(await connect(hub, hash, "refuse"));

    const result = await runCanary(deps(hub), OPTIONS);

    expect(result.checked).toEqual([hash]);
    expect(result.delisted).toEqual([hash]);
    expect(await listed(hub)).not.toContain(hash);
  });

  test("an offline offer is neither checked nor delisted", async () => {
    const hash = await publishOk(hub, makeOffer());

    const result = await runCanary(deps(hub), OPTIONS);

    expect(result.checked).toEqual([]);
    expect(result.delisted).toEqual([]);
    expect(await listed(hub)).toContain(hash);
  });

  test("only the offer whose runner fails the canary is delisted", async () => {
    const healthy = makeOffer({ title: "Echo the question" });
    const silent = makeOffer({ title: "Weather lookup", summary: "Looks up the weather." });
    const healthyHash = await publishOk(hub, healthy);
    const silentHash = await publishOk(hub, silent);
    runners.push(await connect(hub, healthyHash, "answer"));
    runners.push(await connect(hub, silentHash, "ignore"));

    const result = await runCanary(deps(hub), OPTIONS);

    expect([...result.checked].sort()).toEqual([healthyHash, silentHash].sort());
    expect(result.delisted).toEqual([silentHash]);
    const remaining = await listed(hub);
    expect(remaining).toContain(healthyHash);
    expect(remaining).not.toContain(silentHash);
  });

  function deps(target: TestHub) {
    return { store: target.store, runners: target.runners, now: target.deps.now };
  }

  async function connect(
    target: TestHub,
    hash: Hex,
    canary: NonNullable<RunnerOptions["canary"]>,
  ): Promise<RunnerHandle> {
    const runner = startRunner({
      url: wsUrl(target),
      account: seller,
      offers: [hash],
      now: () => NOW,
      respond: async () => ({ output: { q: "hello" } }),
      canary,
    });
    await runner.ready;
    return runner;
  }
});

async function listed(hub: TestHub): Promise<string[]> {
  const body = (await fetch(`${hub.url}/offers`).then((r) => r.json())) as {
    offers: Array<{ offerHash: string }>;
  };
  return body.offers.map((entry) => entry.offerHash);
}

function callOffer(hub: TestHub, hash: Hex): Promise<Response> {
  return fetch(`${hub.url}/offers/${hash}/call`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input: { q: "hello" } }),
  });
}
