import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { VerifyResult } from "../src/deps.ts";
import { FakeRail } from "./fake-rail.ts";
import { startRunner, type RunnerHandle } from "./runner-client.ts";
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

class RefusingRail extends FakeRail {
  override async verify(): Promise<VerifyResult> {
    return { isValid: false, invalidReason: "facilitator says no" };
  }
}

describe("the [hub] call log line", () => {
  let hub: TestHub;
  let runner: RunnerHandle | null = null;
  let lines: string[];
  let originalLog: typeof console.log;

  beforeEach(() => {
    lines = [];
    originalLog = console.log;
    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
  });

  afterEach(() => {
    console.log = originalLog;
    runner?.close();
    runner = null;
    hub?.close();
  });

  test("a verify refusal logs the facilitator's reason", async () => {
    hub = startHub({ rails: [new RefusingRail()] });
    const hash = await publishOk(hub, makeOffer());
    runner = await connect(hub, hash);

    const entry = (await requirementsFor(hub, hash)).accepts[0];
    if (!entry) throw new Error("missing accepts entry");
    lines.length = 0;

    const response = await call(hub, hash, { q: "hello" }, paymentFor(entry));
    expect(response.status).toBe(402);

    const calls = hubCalls(lines);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("status=402");
    expect(calls[0]).toContain("reason=facilitator says no");
  });

  test("a bad input logs its code and message", async () => {
    hub = startHub();
    const hash = await publishOk(hub, makeOffer());

    const response = await call(hub, hash, { q: 42 });
    expect(response.status).toBe(422);

    const calls = hubCalls(lines);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("status=422");
    expect(calls[0]).toContain("reason=bad-input:");
  });

  test("a 200 logs no reason", async () => {
    hub = startHub();
    const hash = await publishOk(hub, makeOffer());
    runner = await connect(hub, hash);

    const entry = (await requirementsFor(hub, hash)).accepts[0];
    if (!entry) throw new Error("missing accepts entry");
    lines.length = 0;

    const response = await call(hub, hash, { q: "hello" }, paymentFor(entry));
    expect(response.status).toBe(200);

    const calls = hubCalls(lines);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("status=200");
    expect(calls[0]).not.toContain("reason=");
  });
});

function hubCalls(lines: string[]): string[] {
  return lines.filter((line) => line.startsWith("[hub] call "));
}

async function connect(hub: TestHub, hash: `0x${string}`): Promise<RunnerHandle> {
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
