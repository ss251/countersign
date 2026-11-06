import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { Handler } from "hono";
import {
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  fromBase64Json,
  parseUnits,
  toBase64Json,
} from "@countersign/core";
import { NETWORK, USDT } from "../src/chain.ts";
import { PAYMENT_RETRY_HEADER, whitechainPaywall } from "../src/paywall.ts";
import type { PaywallFetch, PaywallOptions } from "../src/paywall.ts";
import type { VerifyRequest } from "../src/exact.ts";
import {
  NOW,
  createTestRelay,
  makeAuthorization,
  makeRequirements,
  makeVerifyBody,
} from "./support.ts";

type TestRelay = ReturnType<typeof createTestRelay>;

function appFor(
  relay: TestRelay,
  options: Partial<PaywallOptions> & { fetch: PaywallFetch },
  handler: Handler = (c) => c.json({ forecast: "rain" }),
) {
  const app = new Hono();
  const paywall = whitechainPaywall({
    price: "0.05",
    payTo: relay.merchant.address,
    facilitator: "http://relay.test",
    description: "Mumbai weather",
    ...options,
  });
  app.get("/forecast", paywall, handler);
  return app;
}

type StubOptions = {
  verify?: (body: VerifyRequest) => unknown;
  settle?: (body: VerifyRequest) => unknown;
  order?: (url: string) => Response | unknown;
};

function stub(options: StubOptions = {}) {
  const calls: { path: string; body: VerifyRequest }[] = [];
  const lookups: string[] = [];
  const fetch: PaywallFetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.startsWith("/orders/")) {
      lookups.push(url.pathname);
      const answer = await options.order?.(url.pathname);
      if (answer instanceof Response) return answer;
      if (answer === undefined) {
        return new Response(JSON.stringify({ error: "not_found" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify(answer), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    const body = JSON.parse(String(init?.body)) as VerifyRequest;
    calls.push({ path: url.pathname, body });
    const out =
      url.pathname === "/verify"
        ? (options.verify?.(body) ?? { isValid: true, payer: "0x0000000000000000000000000000000000000001" })
        : (options.settle?.(body) ?? {
            success: true,
            transaction: "0xabc",
            network: NETWORK,
            amount: "50000",
          });
    return new Response(JSON.stringify(out), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { calls, lookups, fetch };
}

async function headerFor(relay: TestRelay): Promise<string> {
  const amount = parseUnits("0.05", USDT.decimals);
  const requirements = makeRequirements(relay.merchant.address, amount, {
    maxTimeoutSeconds: 120,
  });
  const authorization = makeAuthorization({
    from: relay.buyer.address,
    to: relay.merchant.address,
    value: amount,
    validBefore: BigInt(NOW + 600),
  });
  const body = await makeVerifyBody({ signer: relay.buyer, authorization, requirements });
  return toBase64Json(body.paymentPayload);
}

function retryTokenOf(response: Response): string {
  const token = response.headers.get(PAYMENT_RETRY_HEADER);
  if (!token) throw new Error("the pending answer carries no retry token");
  return token;
}

describe("whitechainPaywall", () => {
  test("an unpaid request gives 402 with matching header and body", async () => {
    const relay = createTestRelay();
    const { fetch, calls } = stub();
    const res = await appFor(relay, { fetch }).request("/forecast");
    expect(res.status).toBe(402);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("Payment required.");
    expect(body.x402Version).toBe(2);
    expect(body.resource).toEqual({
      url: "http://localhost/forecast",
      description: "Mumbai weather",
      mimeType: "application/json",
    });
    expect(body.accepts).toEqual([
      {
        scheme: "exact",
        network: "eip155:1874",
        amount: "50000",
        asset: USDT.address,
        payTo: relay.merchant.address,
        maxTimeoutSeconds: 120,
        extra: { assetTransferMethod: "eip3009", name: "Tether USD", version: "1" },
      },
    ]);
    expect(fromBase64Json<Record<string, unknown>>(res.headers.get(PAYMENT_REQUIRED_HEADER)!)).toEqual(body);
    expect(calls).toEqual([]);
  });

  test("a garbage header gives the parse refusal", async () => {
    const relay = createTestRelay();
    let handled = false;
    const { fetch } = stub();
    const app = appFor(relay, { fetch }, (c) => {
      handled = true;
      return c.json({ forecast: "rain" });
    });
    const res = await app.request("/forecast", {
      headers: { [PAYMENT_SIGNATURE_HEADER]: "not base64 at all!" },
    });
    expect(res.status).toBe(402);
    expect(((await res.json()) as { error: string }).error).toBe(
      "Refused. The payment header does not parse.",
    );
    expect(handled).toBe(false);
  });

  test("a decodable but shapeless header is refused as unparseable", async () => {
    const relay = createTestRelay();
    const { fetch } = stub();
    const res = await appFor(relay, { fetch }).request("/forecast", {
      headers: { [PAYMENT_SIGNATURE_HEADER]: toBase64Json("not a payment") },
    });
    expect(res.status).toBe(402);
    expect(((await res.json()) as { error: string }).error).toBe(
      "Refused. The payment header does not parse.",
    );
  });

  test("an invalid verify gives 402 and the handler never runs", async () => {
    const relay = createTestRelay();
    let handled = false;
    const { fetch, calls } = stub({
      verify: () => ({ isValid: false, invalidReason: "insufficient_funds" }),
    });
    const app = appFor(relay, { fetch }, (c) => {
      handled = true;
      return c.json({ forecast: "rain" });
    });
    const res = await app.request("/forecast", {
      headers: { [PAYMENT_SIGNATURE_HEADER]: await headerFor(relay) },
    });
    expect(res.status).toBe(402);
    expect(((await res.json()) as { error: string }).error).toBe(
      "Refused. insufficient_funds",
    );
    expect(handled).toBe(false);
    expect(calls.map((call) => call.path)).toEqual(["/verify"]);
  });

  test("a valid payment runs the handler, settles, and sets the response header", async () => {
    const relay = createTestRelay();
    let handled = false;
    const { fetch, calls } = stub();
    const app = appFor(relay, { fetch }, (c) => {
      handled = true;
      return c.json({ forecast: "rain" });
    });
    const res = await app.request("/forecast", {
      headers: { [PAYMENT_SIGNATURE_HEADER]: await headerFor(relay) },
    });
    expect(res.status).toBe(200);
    expect(handled).toBe(true);
    expect(await res.json()).toEqual({ forecast: "rain" });
    expect(calls.map((call) => call.path)).toEqual(["/verify", "/settle"]);
    expect(fromBase64Json<Record<string, unknown>>(res.headers.get(PAYMENT_RESPONSE_HEADER)!)).toEqual({
      success: true,
      transaction: "0xabc",
      network: NETWORK,
      amount: "50000",
    });
    expect(calls[1]!.body.paymentRequirements).toEqual(calls[0]!.body.paymentRequirements);
    expect(calls[1]!.body.paymentRequirements.amount).toBe("50000");
  });

  test("a handler failure is never settled", async () => {
    const relay = createTestRelay();
    const { fetch, calls } = stub();
    const app = appFor(relay, { fetch }, (c) => c.json({ error: "boom" }, 500));
    const res = await app.request("/forecast", {
      headers: { [PAYMENT_SIGNATURE_HEADER]: await headerFor(relay) },
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "boom" });
    expect(calls.map((call) => call.path)).toEqual(["/verify"]);
  });

  test("a failed settle gives 402 without the resource body", async () => {
    const relay = createTestRelay();
    const { fetch } = stub({
      settle: () => ({
        success: false,
        errorReason: "invalid_transaction_state",
        transaction: "",
        network: NETWORK,
      }),
    });
    const res = await appFor(relay, { fetch }).request("/forecast", {
      headers: { [PAYMENT_SIGNATURE_HEADER]: await headerFor(relay) },
    });
    expect(res.status).toBe(402);
    const body = (await res.json()) as { error: string; accepts: unknown[] };
    expect(body.error).toBe("Refused. invalid_transaction_state");
    expect(body.accepts).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain("rain");
    expect(res.headers.get(PAYMENT_RESPONSE_HEADER)).toBeNull();
    expect(
      fromBase64Json<Record<string, unknown>>(res.headers.get(PAYMENT_REQUIRED_HEADER)!),
    ).toEqual(body);
  });

  test("an unreachable facilitator gives 503", async () => {
    const relay = createTestRelay();
    const fetch: PaywallFetch = async () => {
      throw new Error("connection refused");
    };
    const res = await appFor(relay, { fetch }).request("/forecast", {
      headers: { [PAYMENT_SIGNATURE_HEADER]: await headerFor(relay) },
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "The payment service is unreachable." });
  });

  test("a concurrent replay gets 409 and never runs the handler", async () => {
    const relay = createTestRelay();
    const { fetch } = stub();
    let served = 0;
    const app = appFor(relay, { fetch, now: () => NOW }, async (c) => {
      served += 1;
      await Bun.sleep(50);
      return c.json({ forecast: "rain" });
    });
    const header = await headerFor(relay);
    const call = () => app.request("/forecast", { headers: { [PAYMENT_SIGNATURE_HEADER]: header } });

    const first = call();
    await Bun.sleep(10);
    const second = await call();
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: "Refused. This payment was already used." });
    expect((await first).status).toBe(200);
    expect(served).toBe(1);
  });

  test("a replay after settlement gets 409 and never runs the handler", async () => {
    const relay = createTestRelay();
    const { fetch, calls } = stub();
    let served = 0;
    const app = appFor(relay, { fetch, now: () => NOW }, (c) => {
      served += 1;
      return c.json({ forecast: "rain" });
    });
    const header = await headerFor(relay);
    const call = () => app.request("/forecast", { headers: { [PAYMENT_SIGNATURE_HEADER]: header } });

    expect((await call()).status).toBe(200);
    const replay = await call();
    expect(replay.status).toBe(409);
    expect(await replay.json()).toEqual({ error: "Refused. This payment was already used." });
    expect(served).toBe(1);
    expect(calls.filter((call) => call.path === "/settle")).toHaveLength(1);
  });

  test("a replay after a failed handler is allowed because no money moved", async () => {
    const relay = createTestRelay();
    const { fetch, calls } = stub();
    let attempts = 0;
    const app = appFor(relay, { fetch, now: () => NOW }, (c) => {
      attempts += 1;
      return attempts === 1 ? c.json({ error: "boom" }, 500) : c.json({ ok: true });
    });
    const header = await headerFor(relay);
    const call = () => app.request("/forecast", { headers: { [PAYMENT_SIGNATURE_HEADER]: header } });

    expect((await call()).status).toBe(500);
    expect((await call()).status).toBe(200);
    expect(attempts).toBe(2);
    expect(calls.filter((call) => call.path === "/verify")).toHaveLength(2);
    expect(calls.filter((call) => call.path === "/settle")).toHaveLength(1);
  });

  test("a settle answer with replayed true is refused as already used", async () => {
    const relay = createTestRelay();
    const { fetch } = stub({
      settle: () => ({
        success: true,
        replayed: true,
        transaction: "0xabc",
        network: NETWORK,
        amount: "50000",
      }),
    });
    const app = appFor(relay, { fetch, now: () => NOW });
    const res = await app.request("/forecast", {
      headers: { [PAYMENT_SIGNATURE_HEADER]: await headerFor(relay) },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Refused. This payment was already used." });
  });

  test("settle before runs the handler only after the payment settled", async () => {
    const relay = createTestRelay();
    const { fetch, calls } = stub();
    let settledBeforeHandler = false;
    const app = appFor(relay, { fetch, now: () => NOW, settle: "before" }, (c) => {
      settledBeforeHandler = calls.some((call) => call.path === "/settle");
      return c.json({ forecast: "rain" });
    });
    const res = await app.request("/forecast", {
      headers: { [PAYMENT_SIGNATURE_HEADER]: await headerFor(relay) },
    });
    expect(res.status).toBe(200);
    expect(settledBeforeHandler).toBe(true);
    expect(res.headers.get(PAYMENT_RESPONSE_HEADER)).not.toBeNull();
  });

  test("a pending settle keeps the claim and refuses the next presentation", async () => {
    const relay = createTestRelay();
    const clock = NOW;
    const { fetch, calls, lookups } = stub({
      settle: () => ({
        success: false,
        errorReason: "settlement_pending",
        transaction: "0xpending",
        network: NETWORK,
        amount: "50000",
      }),
    });
    let served = 0;
    const app = appFor(relay, { fetch, now: () => clock }, (c) => {
      served += 1;
      return c.json({ forecast: "rain" });
    });
    const header = await headerFor(relay);
    const call = (retryToken?: string) =>
      app.request("/forecast", {
        headers: {
          [PAYMENT_SIGNATURE_HEADER]: header,
          ...(retryToken ? { [PAYMENT_RETRY_HEADER]: retryToken } : {}),
        },
      });

    const first = await call();
    expect(first.status).toBe(402);
    expect(((await first.json()) as { error: string }).error).toBe(
      "Refused. settlement_pending",
    );
    expect(
      fromBase64Json<Record<string, unknown>>(first.headers.get(PAYMENT_RESPONSE_HEADER)!),
    ).toEqual({
      success: false,
      errorReason: "settlement_pending",
      transaction: "0xpending",
      network: NETWORK,
      amount: "50000",
    });
    const token = retryTokenOf(first);
    expect(token).toMatch(/^0x[0-9a-f]{32}$/);
    expect(served).toBe(1);

    const second = await call();
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({
      error: "Refused. This payment is still settling.",
    });
    expect(served).toBe(1);
    expect(calls.filter((entry) => entry.path === "/settle")).toHaveLength(1);
    expect(lookups).toEqual([]);

    const third = await call(token);
    expect(third.status).toBe(409);
    expect(await third.json()).toEqual({
      error: "Refused. This payment is still settling.",
    });
    expect(served).toBe(1);
    expect(lookups).toEqual(["/orders/0xpending"]);
  });

  test("a pending retry without the matching token is refused without an order lookup", async () => {
    const relay = createTestRelay();
    const { fetch, calls, lookups } = stub({
      settle: () => ({
        success: false,
        errorReason: "settlement_pending",
        transaction: "0xlanded",
        network: NETWORK,
      }),
      order: () => ({ status: "paid" }),
    });
    let served = 0;
    const app = appFor(relay, { fetch, now: () => NOW, settle: "before" }, (c) => {
      served += 1;
      return c.json({ forecast: "rain" });
    });
    const header = await headerFor(relay);
    const call = (retryToken?: string) =>
      app.request("/forecast", {
        headers: {
          [PAYMENT_SIGNATURE_HEADER]: header,
          ...(retryToken ? { [PAYMENT_RETRY_HEADER]: retryToken } : {}),
        },
      });

    const pending = await call();
    expect(pending.status).toBe(402);
    const token = retryTokenOf(pending);
    const sameLength = `${token.slice(0, -1)}${token.endsWith("0") ? "1" : "0"}`;

    for (const [name, retryToken] of [
      ["missing", undefined],
      ["same-length wrong", sameLength],
      ["shorter", "0x"],
      ["longer", `${token}00`],
    ] as const) {
      const retry = await call(retryToken);
      expect({ name, status: retry.status }).toEqual({ name, status: 409 });
      expect({ name, body: await retry.json() }).toEqual({
        name,
        body: { error: "Refused. This payment is still settling." },
      });
    }

    expect(served).toBe(0);
    expect(lookups).toEqual([]);
    expect(calls.filter((entry) => entry.path === "/settle")).toHaveLength(1);
  });

  test("a chain observer cannot take the service of a landed pending payment", async () => {
    const relay = createTestRelay();
    const { fetch, lookups } = stub({
      settle: () => ({
        success: false,
        errorReason: "settlement_pending",
        transaction: "0xlanded",
        network: NETWORK,
      }),
      order: () => ({ status: "paid" }),
    });
    let served = 0;
    const app = appFor(relay, { fetch, now: () => NOW, settle: "before" }, (c) => {
      served += 1;
      return c.json({ forecast: "rain" });
    });
    const header = await headerFor(relay);
    const call = (retryToken?: string) =>
      app.request("/forecast", {
        headers: {
          [PAYMENT_SIGNATURE_HEADER]: header,
          ...(retryToken ? { [PAYMENT_RETRY_HEADER]: retryToken } : {}),
        },
      });

    const pending = await call();
    expect(pending.status).toBe(402);
    const token = retryTokenOf(pending);

    // The signed authorisation is public once broadcast; replaying it is not enough.
    const observer = await call();
    expect(observer.status).toBe(409);
    expect(await observer.json()).toEqual({
      error: "Refused. This payment is still settling.",
    });
    expect(served).toBe(0);
    expect(lookups).toEqual([]);

    const payer = await call(token);
    expect(payer.status).toBe(200);
    expect(await payer.json()).toEqual({ forecast: "rain" });
    expect(served).toBe(1);
    expect(lookups).toEqual(["/orders/0xlanded"]);
  });

  test("a pending claim is released once the authorisation has expired", async () => {
    const relay = createTestRelay();
    let clock = NOW;
    let pending = true;
    const { fetch } = stub({
      settle: () =>
        pending
          ? {
              success: false,
              errorReason: "settlement_pending",
              transaction: "0xpending",
              network: NETWORK,
            }
          : {
              success: true,
              transaction: "0xabc",
              network: NETWORK,
              amount: "50000",
            },
    });
    let served = 0;
    const app = appFor(relay, { fetch, now: () => clock }, (c) => {
      served += 1;
      return c.json({ forecast: "rain" });
    });
    const header = await headerFor(relay);
    const call = () => app.request("/forecast", { headers: { [PAYMENT_SIGNATURE_HEADER]: header } });

    expect((await call()).status).toBe(402);
    pending = false;
    clock = NOW + 600 + 61;
    expect((await call()).status).toBe(200);
    expect(served).toBe(2);

    const third = await call();
    expect(third.status).toBe(409);
    expect(await third.json()).toEqual({ error: "Refused. This payment was already used." });
    expect(served).toBe(2);
  });

  test("a pending payment that landed is served once", async () => {
    const relay = createTestRelay();
    const { fetch, calls, lookups } = stub({
      settle: () => ({
        success: false,
        errorReason: "settlement_pending",
        transaction: "0xlanded",
        network: NETWORK,
      }),
      order: () => ({ status: "paid" }),
    });
    let served = 0;
    const app = appFor(relay, { fetch, now: () => NOW, settle: "before" }, (c) => {
      served += 1;
      return c.json({ forecast: "rain" });
    });
    const header = await headerFor(relay);
    const call = (retryToken?: string) =>
      app.request("/forecast", {
        headers: {
          [PAYMENT_SIGNATURE_HEADER]: header,
          ...(retryToken ? { [PAYMENT_RETRY_HEADER]: retryToken } : {}),
        },
      });

    const first = await call();
    expect(first.status).toBe(402);
    expect(served).toBe(0);
    const token = retryTokenOf(first);

    const retry = await call(token);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ forecast: "rain" });
    expect(served).toBe(1);
    expect(
      fromBase64Json<Record<string, unknown>>(retry.headers.get(PAYMENT_RESPONSE_HEADER)!),
    ).toEqual({
      success: true,
      transaction: "0xlanded",
      network: NETWORK,
      payer: relay.buyer.address,
    });
    expect(lookups).toEqual(["/orders/0xlanded"]);
    expect(calls.filter((entry) => entry.path === "/settle")).toHaveLength(1);

    const third = await call(token);
    expect(third.status).toBe(409);
    expect(await third.json()).toEqual({ error: "Refused. This payment was already used." });
    expect(served).toBe(1);
    expect(lookups).toHaveLength(1);
  });

  test("a pending payment that is still settling stays refused", async () => {
    const relay = createTestRelay();
    const { fetch, calls } = stub({
      settle: () => ({
        success: false,
        errorReason: "settlement_pending",
        transaction: "0xlanded",
        network: NETWORK,
      }),
      order: () => ({ status: "pending" }),
    });
    let served = 0;
    const app = appFor(relay, { fetch, now: () => NOW, settle: "before" }, (c) => {
      served += 1;
      return c.json({ forecast: "rain" });
    });
    const header = await headerFor(relay);
    const call = (retryToken?: string) =>
      app.request("/forecast", {
        headers: {
          [PAYMENT_SIGNATURE_HEADER]: header,
          ...(retryToken ? { [PAYMENT_RETRY_HEADER]: retryToken } : {}),
        },
      });

    const first = await call();
    expect(first.status).toBe(402);
    const retry = await call(retryTokenOf(first));
    expect(retry.status).toBe(409);
    expect(await retry.json()).toEqual({ error: "Refused. This payment is still settling." });
    expect(served).toBe(0);
    expect(calls.filter((entry) => entry.path === "/settle")).toHaveLength(1);
  });

  test("a pending payment with a refunded order is not served", async () => {
    const relay = createTestRelay();
    const { fetch, calls } = stub({
      settle: () => ({
        success: false,
        errorReason: "settlement_pending",
        transaction: "0xlanded",
        network: NETWORK,
      }),
      order: () => ({ status: "refunded" }),
    });
    let served = 0;
    const app = appFor(relay, { fetch, now: () => NOW, settle: "before" }, (c) => {
      served += 1;
      return c.json({ forecast: "rain" });
    });
    const header = await headerFor(relay);
    const call = (retryToken?: string) =>
      app.request("/forecast", {
        headers: {
          [PAYMENT_SIGNATURE_HEADER]: header,
          ...(retryToken ? { [PAYMENT_RETRY_HEADER]: retryToken } : {}),
        },
      });

    const first = await call();
    expect(first.status).toBe(402);
    const retry = await call(retryTokenOf(first));
    expect(retry.status).toBe(409);
    expect(await retry.json()).toEqual({ error: "Refused. This payment is still settling." });
    expect(served).toBe(0);
    expect(calls.filter((entry) => entry.path === "/settle")).toHaveLength(1);
  });

  test("a failing pending lookup leaves the payment still settling", async () => {
    const cases: { name: string; order: () => Response | unknown }[] = [
      {
        name: "throws",
        order: () => {
          throw new Error("connection refused");
        },
      },
      { name: "404", order: () => new Response("{}", { status: 404 }) },
      { name: "500", order: () => new Response("{}", { status: 500 }) },
      { name: "non-json", order: () => new Response("not json", { status: 200 }) },
    ];

    for (const entry of cases) {
      const relay = createTestRelay();
      const { fetch } = stub({
        settle: () => ({
          success: false,
          errorReason: "settlement_pending",
          transaction: "0xlanded",
          network: NETWORK,
        }),
        order: entry.order,
      });
      let served = 0;
      const app = appFor(relay, { fetch, now: () => NOW, settle: "before" }, (c) => {
        served += 1;
        return c.json({ forecast: "rain" });
      });
      const header = await headerFor(relay);
      const call = (retryToken?: string) =>
        app.request("/forecast", {
          headers: {
            [PAYMENT_SIGNATURE_HEADER]: header,
            ...(retryToken ? { [PAYMENT_RETRY_HEADER]: retryToken } : {}),
          },
        });

      const first = await call();
      expect(first.status).toBe(402);
      const retry = await call(retryTokenOf(first));
      expect({ case: entry.name, status: retry.status }).toEqual({
        case: entry.name,
        status: 409,
      });
      expect({ case: entry.name, body: await retry.json() }).toEqual({
        case: entry.name,
        body: { error: "Refused. This payment is still settling." },
      });
      expect({ case: entry.name, served }).toEqual({ case: entry.name, served: 0 });
    }
  });

  test("two concurrent retries after a pending payment lands serve exactly one", async () => {
    const relay = createTestRelay();
    const { fetch } = stub({
      settle: () => ({
        success: false,
        errorReason: "settlement_pending",
        transaction: "0xlanded",
        network: NETWORK,
      }),
      order: async () => {
        await Bun.sleep(20);
        return { status: "paid" };
      },
    });
    let served = 0;
    const app = appFor(relay, { fetch, now: () => NOW, settle: "before" }, async (c) => {
      served += 1;
      await Bun.sleep(10);
      return c.json({ forecast: "rain" });
    });
    const header = await headerFor(relay);
    const call = (retryToken?: string) =>
      app.request("/forecast", {
        headers: {
          [PAYMENT_SIGNATURE_HEADER]: header,
          ...(retryToken ? { [PAYMENT_RETRY_HEADER]: retryToken } : {}),
        },
      });

    const pending = await call();
    expect(pending.status).toBe(402);
    const token = retryTokenOf(pending);
    const [first, second] = await Promise.all([call(token), call(token)]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect(served).toBe(1);
    const refused = first.status === 409 ? first : second;
    expect(await refused.json()).toEqual({ error: "Refused. This payment was already used." });
  });

  test("a settle failure that is not pending releases the claim at once", async () => {
    const relay = createTestRelay();
    let failure = true;
    const { fetch } = stub({
      settle: () =>
        failure
          ? {
              success: false,
              errorReason: "invalid_transaction_state",
              transaction: "",
              network: NETWORK,
            }
          : {
              success: true,
              transaction: "0xabc",
              network: NETWORK,
              amount: "50000",
            },
    });
    let served = 0;
    const app = appFor(relay, { fetch, now: () => NOW, settle: "before" }, (c) => {
      served += 1;
      return c.json({ forecast: "rain" });
    });
    const header = await headerFor(relay);
    const call = () => app.request("/forecast", { headers: { [PAYMENT_SIGNATURE_HEADER]: header } });

    const refused = await call();
    expect(refused.status).toBe(402);
    expect(((await refused.json()) as { error: string }).error).toBe(
      "Refused. invalid_transaction_state",
    );
    expect(served).toBe(0);

    failure = false;
    expect((await call()).status).toBe(200);
    expect(served).toBe(1);
  });
});
