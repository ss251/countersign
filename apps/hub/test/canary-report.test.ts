import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Hex } from "viem";
import { runCanary } from "../src/canary.ts";
import { makeOffer, NOW, publishOk, seller, startHub, wsUrl, type TestHub } from "./support.ts";
import { startRunner, type RunnerHandle, type RunnerOptions } from "./runner-client.ts";

const OPTIONS = { attempts: 3, gapMs: 10, timeoutMs: 200 };

describe("canary report mode", () => {
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

  test("report mode keeps a silent runner's offer", async () => {
    const hash = await publishOk(hub, makeOffer());
    runners.push(await connect(hub, hash, "ignore"));

    const result = await runCanary(deps(hub, true), OPTIONS);

    expect(result.failed).toEqual([hash]);
    expect(result.delisted).toEqual([]);
    expect(await listed(hub)).toContain(hash);
    expect(lines.filter((line) => line.startsWith(`[canary] would delist ${hash}: `))).toHaveLength(1);
  });

  test("report mode logs a healthy runner", async () => {
    const hash = await publishOk(hub, makeOffer());
    runners.push(await connect(hub, hash, "answer"));

    const result = await runCanary(deps(hub, true), OPTIONS);

    expect(lines).toContain(`[canary] ok ${hash}`);
    expect(result.failed).toEqual([]);
    expect(result.delisted).toEqual([]);
  });

  test("delist mode is unchanged and reports its failures", async () => {
    const hash = await publishOk(hub, makeOffer());
    runners.push(await connect(hub, hash, "ignore"));

    const result = await runCanary(deps(hub), OPTIONS);

    expect(result.delisted).toEqual([hash]);
    expect(result.failed).toEqual([hash]);
    expect(await listed(hub)).not.toContain(hash);
    expect(lines.filter((line) => line.startsWith(`[canary] delisted ${hash}: `))).toHaveLength(1);
  });

  test("report mode with one healthy and one silent offer", async () => {
    const healthy = makeOffer({ title: "Echo the question" });
    const silent = makeOffer({ title: "Weather lookup", summary: "Looks up the weather." });
    const healthyHash = await publishOk(hub, healthy);
    const silentHash = await publishOk(hub, silent);
    runners.push(await connect(hub, healthyHash, "answer"));
    runners.push(await connect(hub, silentHash, "ignore"));

    const result = await runCanary(deps(hub, true), OPTIONS);

    expect(result.failed).toEqual([silentHash]);
    expect(result.delisted).toEqual([]);
    const remaining = await listed(hub);
    expect(remaining).toContain(healthyHash);
    expect(remaining).toContain(silentHash);
    expect(lines).toContain(`[canary] ok ${healthyHash}`);
    expect(lines.filter((line) => line.startsWith(`[canary] would delist ${silentHash}: `))).toHaveLength(1);
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
