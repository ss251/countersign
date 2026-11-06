/**
 * A /settle that carries a lockSig is a bonded v2 fund, which the relay submits as the Lock's
 * funder. Only the hub sends one, so only the hub's bearer token may ask for it, exactly as for
 * /escrow/fail. An unbonded settle stays open. The chain is simulated; nothing here reaches a network.
 */

import { describe, expect, test } from "bun:test";
import { getAddress, type Hex } from "viem";
import { whitechainRail } from "@countersign/rail";
import { createRelayApp } from "../src/server.ts";
import { createTestRelay, NOW } from "./support.ts";

const HUB_TOKEN = "a-hub-token-long-enough";
const LOCK: Hex = `0x${"5a".repeat(65)}`;
const V2 = getAddress("0x7777777777777777777777777777777777777777");

type TestRelay = ReturnType<typeof createTestRelay>;

function appFor(relay: TestRelay, hubToken?: string) {
  return createRelayApp({
    reader: relay.chain,
    relayer: relay.relayer,
    ledger: relay.ledger,
    now: () => NOW,
    config: hubToken ? { hubToken } : {},
  });
}

/** A settle body the gate sees; its payment is not valid, so a forwarded one is refused downstream. */
function settleBody(withLock: boolean) {
  return {
    x402Version: 2,
    paymentPayload: { x402Version: 2, accepted: { scheme: "countersign" }, payload: {} },
    paymentRequirements: { scheme: "countersign", network: "eip155:1874" },
    ...(withLock ? { lockSig: LOCK } : {}),
  };
}

function settle(app: ReturnType<typeof createRelayApp>, body: unknown, headers: Record<string, string> = {}) {
  return app.request("/settle", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function spy(relay: TestRelay) {
  let simulated = 0;
  relay.chain.simulateHook = () => {
    simulated += 1;
  };
  return () => ({ simulated, written: relay.chain.writes.length });
}

describe("a settle that carries a lockSig needs the hub", () => {
  test("without the hub token it is refused 401, and nothing is simulated or submitted", async () => {
    const relay = createTestRelay();
    const seen = spy(relay);
    const res = await settle(appFor(relay, HUB_TOKEN), settleBody(true));
    expect(res.status).toBe(401);
    expect(((await res.json()) as { success: boolean; errorReason: string })).toMatchObject({
      success: false,
      errorReason: "hub_auth_required",
    });
    expect(seen()).toEqual({ simulated: 0, written: 0 });
  });

  test("a wrong bearer is the same as none", async () => {
    const relay = createTestRelay();
    const seen = spy(relay);
    const res = await settle(appFor(relay, HUB_TOKEN), settleBody(true), { authorization: "Bearer not-the-hub-token-at-all" });
    expect(res.status).toBe(401);
    expect(seen()).toEqual({ simulated: 0, written: 0 });
  });

  test("with the hub token it is forwarded to the countersign settle", async () => {
    const relay = createTestRelay();
    const res = await settle(appFor(relay, HUB_TOKEN), settleBody(true), { authorization: `Bearer ${HUB_TOKEN}` });
    expect(res.status).not.toBe(401);
    const out = (await res.json()) as { success: boolean; errorReason?: string };
    // The body passes the gate and reaches settleCountersign, which refuses the invalid payment.
    expect(out.success).toBe(false);
    expect(out.errorReason).not.toBe("hub_auth_required");
  });

  test("a relay with no hub token refuses a lockSig settle 503", async () => {
    const relay = createTestRelay();
    const res = await settle(appFor(relay), settleBody(true));
    expect(res.status).toBe(503);
    expect(((await res.json()) as { errorReason: string }).errorReason).toBe("lock_not_configured");
  });

  test("an unbonded settle without a lockSig is not gated", async () => {
    const relay = createTestRelay();
    const res = await settle(appFor(relay, HUB_TOKEN), settleBody(false));
    expect(res.status).not.toBe(401);
    expect(((await res.json()) as { errorReason?: string }).errorReason).not.toBe("hub_auth_required");
  });
});

describe("the whitechain rail sends the hub token on a settle that carries a lock", () => {
  function recorder() {
    const calls: Array<{ body: Record<string, unknown>; authorization?: string }> = [];
    const fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      calls.push({
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        authorization: new Headers(init?.headers).get("authorization") ?? undefined,
      });
      return Response.json({ success: true, transaction: `0x${"ab".repeat(32)}`, network: "eip155:1874" });
    }) as typeof globalThis.fetch;
    return { calls, fetch };
  }
  const payment = { x402Version: 2 } as never;
  const requirements = { scheme: "countersign" } as never;

  test("v2 with a relay token: a lock carries the bearer, an unbonded settle does not", async () => {
    const { calls, fetch } = recorder();
    const rail = whitechainRail({ relayUrl: "http://relay", version: 2, escrow: V2, relayToken: HUB_TOKEN, fetch });
    await rail.settle(payment, requirements, { lockSig: LOCK });
    await rail.settle(payment, requirements);
    expect(calls.map((call) => [call.body.lockSig ?? null, call.authorization ?? null])).toEqual([
      [LOCK, `Bearer ${HUB_TOKEN}`],
      [null, null],
    ]);
  });

  test("v1, and v2 without a token, send no bearer", async () => {
    for (const opts of [
      { relayUrl: "http://relay", relayToken: HUB_TOKEN },
      { relayUrl: "http://relay", version: 2 as const, escrow: V2 },
    ]) {
      const { calls, fetch } = recorder();
      const rail = whitechainRail({ ...opts, fetch });
      await rail.settle(payment, requirements, { lockSig: LOCK });
      expect(calls[0]!.authorization).toBeUndefined();
    }
  });
});
