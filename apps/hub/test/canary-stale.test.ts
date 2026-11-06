import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Hex } from "viem";
import { runCanary } from "../src/canary.ts";
import { makeOffer, NOW, publishOk, seller, startHub, wsUrl, type TestHub } from "./support.ts";
import { startRunner, type RunnerHandle, type RunnerOptions } from "./runner-client.ts";

describe("canary stale runner", () => {
  let hub: TestHub;
  let runners: RunnerHandle[];
  const lines: string[] = [];

  beforeEach(() => {
    hub = startHub();
    runners = [];
    lines.length = 0;
  });

  afterEach(() => {
    for (const runner of runners) runner.close();
    hub.close();
  });

  test("a runner that stops answering pings is skipped, not delisted", async () => {
    const hash = await publishOk(hub, makeOffer());
    runners.push(await connect(hub, hash, "ignore"));

    const result = await runCanary(deps(hub), {
      attempts: 3,
      gapMs: 10,
      timeoutMs: 200,
      stalePongMs: 50,
    });

    expect(result.delisted).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(await listed(hub)).toContain(hash);
    expect(lines.filter((line) => line.startsWith(`[canary] skipped ${hash}: `))).toHaveLength(1);
  });

  test("a runner that closes during an attempt is skipped, not delisted", async () => {
    const hash = await publishOk(hub, makeOffer());
    const runner = await connect(hub, hash, "ignore");
    runners.push(runner);

    const pending = runCanary(deps(hub), { attempts: 3, gapMs: 10, timeoutMs: 1_000 });
    await Bun.sleep(50);
    runner.close();
    const result = await pending;

    expect(result.delisted).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(hub.store.getOffer(hash)?.delistedAt).toBeNull();
    expect(lines.filter((line) => line.startsWith(`[canary] skipped ${hash}: `))).toHaveLength(1);
  });

  test("a runner that answers pings but ignores the canary is still delisted", async () => {
    const hash = await publishOk(hub, makeOffer());
    runners.push(await connect(hub, hash, "ignore"));

    const result = await runCanary(deps(hub), {
      attempts: 3,
      gapMs: 10,
      timeoutMs: 200,
      stalePongMs: 60_000,
    });

    expect(result.delisted).toEqual([hash]);
    expect(await listed(hub)).not.toContain(hash);
  });

  test("pongAgeMs", async () => {
    const hash = await publishOk(hub, makeOffer());
    expect(hub.runners.pongAgeMs(hash)).toBeNull();

    runners.push(await connect(hub, hash, "answer"));

    const age = hub.runners.pongAgeMs(hash);
    expect(age).not.toBeNull();
    expect(age as number).toBeGreaterThanOrEqual(0);
    expect(age as number).toBeLessThanOrEqual(5_000);
  });

  function deps(target: TestHub, report?: boolean) {
    return {
      store: target.store,
      runners: target.runners,
      now: target.deps.now,
      log: (line: string) => lines.push(line),
      ...(report === true ? { report: true } : {}),
    };
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
