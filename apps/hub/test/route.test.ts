import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  slipCommitHash,
  type CallResult,
  type PaymentRequired,
  type RailId,
  type RouteChoice,
} from "../src/deps.ts";
import { ROUTER_POLICY, type Decision } from "../src/route.ts";
import {
  call,
  makeOffer,
  NOW,
  paymentFor,
  publishOk,
  seller,
  startHub,
  wsUrl,
  type TestHub,
} from "./support.ts";
import { FakeRail } from "./fake-rail.ts";
import { startRunner, type RunnerHandle } from "./runner-client.ts";

interface HealthBody {
  router: {
    policy: string;
    health: Record<string, { failures: number; lastFailureAt: number }>;
    recent: Decision[];
  };
}

interface RouteExtension {
  chosen: RailId | null;
  reason: string;
  trace: RouteChoice["trace"];
}

describe("rail routing", () => {
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

  test("a rail whose challenge throws is dropped and its trace says why", async () => {
    hub.close();
    const broken = new FakeRail("escrow");
    broken.failChallenge = true;
    const healthy = new FakeRail("eip3009", "eip155:1874");
    hub = startHub({ rails: [broken, healthy] });
    const hash = await publishOk(hub, makeOffer({ rails: ["escrow", "eip3009"] }));
    runners.push(await connect(hub, hash));

    const response = await call(hub, hash, { q: "hello" });
    expect(response.status).toBe(402);
    const body = (await response.json()) as PaymentRequired & { extensions: { route: RouteExtension } };

    expect(body.accepts.map((entry) => entry.network)).toEqual(["eip155:1874"]);
    expect(body.extensions.route.chosen).toBe("eip3009");
    expect(body.extensions.route.trace.find((entry) => entry.rail === "escrow")).toEqual({
      rail: "escrow",
      eligible: false,
      cost: "0",
      finalitySeconds: null,
      why: "challenge failed: this rail cannot make a challenge",
    });

    const health = (await fetch(`${hub.url}/healthz`).then((res) => res.json())) as HealthBody;
    expect(health.router.health.escrow).toEqual({ failures: 1, lastFailureAt: NOW });
  });

  test("a settle failure moves the next candidate first, and the slip records both attempts", async () => {
    hub.close();
    const first = new FakeRail("escrow");
    first.failSettle = true;
    const second = new FakeRail("gateway", "eip155:1874");
    hub = startHub({ rails: [first, second] });
    const hash = await publishOk(hub, makeOffer({ rails: ["escrow", "gateway"] }));
    runners.push(await connect(hub, hash));

    const initial = await requirements(hub, hash);
    const firstEntry = initial.accepts[0];
    if (!firstEntry) throw new Error("missing accepts entry");
    expect(firstEntry.network).toBe("eip155:5042002");

    const failed = await call(hub, hash, { q: "hello" }, paymentFor(firstEntry));
    expect(failed.status).toBe(402);
    const retry = (await failed.json()) as PaymentRequired & { extensions: { route: RouteExtension } };

    expect(retry.accepts.map((entry) => entry.network)).toEqual(["eip155:1874", "eip155:5042002"]);
    expect(retry.extensions.route.chosen).toBe("gateway");
    expect(retry.extensions.route.trace.find((entry) => entry.rail === "escrow")?.why).toBe("fallback 1");
    const nextEntry = retry.accepts[0];
    if (!nextEntry) throw new Error("missing retry entry");

    const paid = await call(hub, hash, { q: "hello" }, paymentFor(nextEntry));
    expect(paid.status).toBe(200);
    const result = (await paid.json()) as CallResult;

    expect(result.slip.settlement.route?.chosen).toBe("gateway");
    expect(result.slip.settlement.route?.attempts).toEqual([
      { rail: "escrow", outcome: "settle-failed", at: NOW },
      { rail: "gateway", outcome: "settled", at: NOW },
    ]);
    expect(slipCommitHash(result.slip.body)).toBe(result.slip.hash);
  });

  test("the buyer's rail header restricts the accepts and a malformed value is ignored", async () => {
    hub.close();
    hub = startHub({ rails: [new FakeRail("escrow"), new FakeRail("gateway", "eip155:1874")] });
    const hash = await publishOk(hub, makeOffer({ rails: ["escrow", "gateway"] }));
    runners.push(await connect(hub, hash));

    const restricted = await callWith(hub, hash, { "X-Countersign-Rails": "gateway" });
    expect(restricted.status).toBe(402);
    const only = (await restricted.json()) as PaymentRequired;
    expect(only.accepts.map((entry) => entry.network)).toEqual(["eip155:1874"]);

    const malformed = await callWith(hub, hash, { "X-Countersign-Rails": "gateway,bogus" });
    expect(malformed.status).toBe(402);
    const both = (await malformed.json()) as PaymentRequired;
    expect(both.accepts).toHaveLength(2);
  });

  test("the buyer's finality header drops a slower rail", async () => {
    hub.close();
    const escrow = new FakeRail("escrow");
    escrow.declaration.finalitySeconds = 2;
    const gateway = new FakeRail("gateway", "eip155:1874");
    gateway.declaration.finalitySeconds = 900;
    hub = startHub({ rails: [escrow, gateway] });
    const hash = await publishOk(hub, makeOffer({ rails: ["escrow", "gateway"] }));
    runners.push(await connect(hub, hash));

    const response = await callWith(hub, hash, { "X-Countersign-Max-Finality": "60" });
    expect(response.status).toBe(402);
    const body = (await response.json()) as PaymentRequired;
    expect(body.accepts.map((entry) => entry.network)).toEqual(["eip155:5042002"]);
  });

  test("healthz shows the policy, the health record and the recent decisions", async () => {
    hub.close();
    hub = startHub({ rails: [new FakeRail("escrow"), new FakeRail("gateway", "eip155:1874")] });
    const hash = await publishOk(hub, makeOffer({ rails: ["escrow", "gateway"] }));
    runners.push(await connect(hub, hash));

    const response = await call(hub, hash, { q: "hello" });
    expect(response.status).toBe(402);

    const health = (await fetch(`${hub.url}/healthz`).then((res) => res.json())) as HealthBody;
    expect(health.router.policy).toBe(ROUTER_POLICY);
    expect(health.router.health).toEqual({});
    expect(health.router.recent).toHaveLength(1);
    expect(health.router.recent[0]).toEqual({
      at: NOW,
      offerHash: hash,
      chosen: "escrow",
      candidates: ["escrow", "gateway"],
    });
  });
});

async function requirements(hub: TestHub, hash: `0x${string}`): Promise<PaymentRequired> {
  const response = await call(hub, hash, { q: "hello" });
  if (response.status !== 402) throw new Error(`expected 402, got ${response.status}`);
  return (await response.json()) as PaymentRequired;
}

async function callWith(
  hub: TestHub,
  hash: `0x${string}`,
  headers: Record<string, string>,
): Promise<Response> {
  return fetch(`${hub.url}/offers/${hash}/call`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ input: { q: "hello" } }),
  });
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
