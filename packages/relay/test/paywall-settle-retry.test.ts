import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { Handler } from "hono";
import {
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

type SettleAnswer = Response | "throw" | unknown;

type StubOptions = {
  settles: SettleAnswer[];
  order?: (url: string) => Response | unknown;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stub(options: StubOptions) {
  const calls: { path: string; body: VerifyRequest }[] = [];
  const lookups: string[] = [];
  let settleIndex = 0;
  const fetch: PaywallFetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.startsWith("/orders/")) {
      lookups.push(url.pathname);
      const answer = options.order?.(url.pathname);
      if (answer instanceof Response) return answer;
      return json(answer ?? { status: "not_found" });
    }
    const body = JSON.parse(String(init?.body)) as VerifyRequest;
    calls.push({ path: url.pathname, body });
    if (url.pathname === "/verify") {
      return json({
        isValid: true,
        payer: "0x0000000000000000000000000000000000000001",
      });
    }
    const answer = options.settles[settleIndex];
    settleIndex += 1;
    if (answer === undefined) throw new Error("unexpected settle call");
    if (answer === "throw") throw new Error("connection refused");
    if (answer instanceof Response) return answer;
    return json(answer);
  };
  const settleCalls = () => calls.filter((call) => call.path === "/settle").length;
  return { calls, lookups, fetch, settleCalls };
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

const SUCCESS = {
  success: true,
  transaction: "0xabc",
  network: NETWORK,
  amount: "50000",
};

describe("whitechainPaywall settle retry", () => {
  test("a thrown settle reply is retried and the request is served", async () => {
    const relay = createTestRelay();
    const { fetch, settleCalls } = stub({
      settles: ["throw", { ...SUCCESS, transaction: "0xretried" }],
    });
    const app = appFor(relay, { fetch, settleRetryDelayMs: 0, now: () => NOW });
    const res = await app.request("/forecast", {
      headers: { [PAYMENT_SIGNATURE_HEADER]: await headerFor(relay) },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ forecast: "rain" });
    expect(settleCalls()).toBe(2);
    expect(
      fromBase64Json<Record<string, unknown>>(res.headers.get(PAYMENT_RESPONSE_HEADER)!),
    ).toEqual({ ...SUCCESS, transaction: "0xretried" });
  });

  test("a 502 then a replay of our own retry is served", async () => {
    const relay = createTestRelay();
    const { fetch, settleCalls } = stub({
      settles: [
        new Response("bad gateway", { status: 502 }),
        {
          success: true,
          replayed: true,
          transaction: "0xreplayed",
          network: NETWORK,
          amount: "50000",
        },
      ],
    });
    const app = appFor(relay, { fetch, settleRetryDelayMs: 0, now: () => NOW });
    const res = await app.request("/forecast", {
      headers: { [PAYMENT_SIGNATURE_HEADER]: await headerFor(relay) },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ forecast: "rain" });
    expect(settleCalls()).toBe(2);
    expect(
      fromBase64Json<Record<string, unknown>>(res.headers.get(PAYMENT_RESPONSE_HEADER)!),
    ).toEqual({
      success: true,
      replayed: true,
      transaction: "0xreplayed",
      network: NETWORK,
      amount: "50000",
    });
  });

  test("a plain replay is still refused as already used", async () => {
    const relay = createTestRelay();
    const { fetch, settleCalls } = stub({
      settles: [
        {
          success: true,
          replayed: true,
          transaction: "0xabc",
          network: NETWORK,
          amount: "50000",
        },
      ],
    });
    const app = appFor(relay, { fetch, settleRetryDelayMs: 0, now: () => NOW });
    const res = await app.request("/forecast", {
      headers: { [PAYMENT_SIGNATURE_HEADER]: await headerFor(relay) },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Refused. This payment was already used." });
    expect(settleCalls()).toBe(1);
  });

  test("two lost replies leave a pending claim that the token serves", async () => {
    const relay = createTestRelay();
    const { fetch, lookups, settleCalls } = stub({
      settles: ["throw", new Response("bad gateway", { status: 502 }), SUCCESS],
    });
    let served = 0;
    const app = appFor(
      relay,
      { fetch, settleRetryDelayMs: 0, now: () => NOW },
      (c) => {
        served += 1;
        return c.json({ forecast: "rain" });
      },
    );
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
    expect(await first.json()).toMatchObject({ error: "Refused. settlement_pending" });
    expect(first.headers.get(PAYMENT_RESPONSE_HEADER)).toBeNull();
    const token = retryTokenOf(first);
    expect(settleCalls()).toBe(2);

    const withoutToken = await call();
    expect(withoutToken.status).toBe(409);
    expect(await withoutToken.json()).toEqual({
      error: "Refused. This payment is still settling.",
    });
    expect(settleCalls()).toBe(2);

    const retry = await call(token);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ forecast: "rain" });
    expect(served).toBe(2);
    expect(settleCalls()).toBe(3);
    expect(lookups).toEqual([]);
    expect(
      fromBase64Json<Record<string, unknown>>(retry.headers.get(PAYMENT_RESPONSE_HEADER)!),
    ).toEqual(SUCCESS);
  });

  test("settle before retries a thrown settle and runs the handler once", async () => {
    const relay = createTestRelay();
    const { fetch, settleCalls } = stub({
      settles: ["throw", SUCCESS],
    });
    let served = 0;
    const app = appFor(
      relay,
      { fetch, settleRetryDelayMs: 0, now: () => NOW, settle: "before" },
      (c) => {
        served += 1;
        return c.json({ forecast: "rain" });
      },
    );
    const res = await app.request("/forecast", {
      headers: { [PAYMENT_SIGNATURE_HEADER]: await headerFor(relay) },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ forecast: "rain" });
    expect(served).toBe(1);
    expect(settleCalls()).toBe(2);
    expect(res.headers.get(PAYMENT_RESPONSE_HEADER)).not.toBeNull();
  });

  test("a token retry records a pending transaction and the next retry serves it", async () => {
    const relay = createTestRelay();
    const { fetch, lookups, settleCalls } = stub({
      settles: [
        "throw",
        new Response("bad gateway", { status: 502 }),
        {
          success: false,
          errorReason: "settlement_pending",
          transaction: "0xpending",
          network: NETWORK,
        },
      ],
      order: (url) => (url === "/orders/0xpending" ? { status: "paid" } : { status: "pending" }),
    });
    let served = 0;
    const app = appFor(
      relay,
      { fetch, settleRetryDelayMs: 0, now: () => NOW },
      (c) => {
        served += 1;
        return c.json({ forecast: "rain" });
      },
    );
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
    const token = retryTokenOf(first);
    expect(settleCalls()).toBe(2);
    expect(lookups).toEqual([]);

    const pending = await call(token);
    expect(pending.status).toBe(409);
    expect(await pending.json()).toEqual({
      error: "Refused. This payment is still settling.",
    });
    expect(settleCalls()).toBe(3);
    expect(lookups).toEqual([]);

    const retry = await call(token);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ forecast: "rain" });
    expect(served).toBe(2);
    expect(settleCalls()).toBe(3);
    expect(lookups).toEqual(["/orders/0xpending"]);
    expect(
      fromBase64Json<Record<string, unknown>>(retry.headers.get(PAYMENT_RESPONSE_HEADER)!),
    ).toEqual({
      success: true,
      transaction: "0xpending",
      network: NETWORK,
      payer: relay.buyer.address,
    });
  });
});

describe("whitechainPaywall concurrent token retries", () => {
  test("a late pending reply cannot re-open a claim that a concurrent retry already settled and served", async () => {
    const relay = createTestRelay();
    let releaseLate!: () => void;
    const late = new Promise<void>((resolve) => {
      releaseLate = resolve;
    });
    let settleCall = 0;
    const lookups: string[] = [];
    const fetch: PaywallFetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.startsWith("/orders/")) {
        lookups.push(url.pathname);
        return json({ status: "paid" });
      }
      if (url.pathname === "/verify") {
        return json({ isValid: true, payer: "0x0000000000000000000000000000000000000001" });
      }
      settleCall += 1;
      // The first request loses both of its settle replies.
      if (settleCall <= 2) throw new Error("connection refused");
      // Retry B asks first; its reply arrives only after retry A has been served.
      if (settleCall === 3) {
        await late;
        return json({ success: false, errorReason: "settlement_pending", transaction: "0xlate", network: NETWORK });
      }
      // Retry A settles at once.
      return json(SUCCESS);
    };
    let served = 0;
    const app = appFor(relay, { fetch, settleRetryDelayMs: 0, now: () => NOW }, (c) => {
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
    const token = retryTokenOf(first);
    const servedBefore = served;

    const retryB = call(token);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const retryA = await call(token);
    expect(retryA.status).toBe(200);
    releaseLate();
    expect((await retryB).status).toBe(409);

    const third = await call(token);
    expect(third.status).toBe(409);
    expect(served - servedBefore).toBe(1);
    expect(lookups).toEqual([]);
  });
});

describe("whitechainPaywall a payment the relay still holds as pending", () => {
  test("after our own retry, invalid_transaction_state with a transaction stays pending behind a token", async () => {
    const relay = createTestRelay();
    const { fetch, lookups, settleCalls } = stub({
      settles: [
        "throw",
        { success: false, errorReason: "invalid_transaction_state", transaction: "0xheld", network: NETWORK },
      ],
      order: (url) => (url === "/orders/0xheld" ? { status: "paid" } : { status: "pending" }),
    });
    let served = 0;
    const app = appFor(relay, { fetch, settleRetryDelayMs: 0, now: () => NOW }, (c) => {
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
    const token = retryTokenOf(first);
    expect(settleCalls()).toBe(2);
    const servedBefore = served;

    const retry = await call(token);
    expect(retry.status).toBe(200);
    expect(served - servedBefore).toBe(1);
    expect(lookups).toEqual(["/orders/0xheld"]);
    expect(settleCalls()).toBe(2);
  });

  test("without our own retry, invalid_transaction_state is still a plain refusal", async () => {
    const relay = createTestRelay();
    const { fetch, settleCalls } = stub({
      settles: [{ success: false, errorReason: "invalid_transaction_state", transaction: "0xother", network: NETWORK }],
    });
    const app = appFor(relay, { fetch, settleRetryDelayMs: 0, now: () => NOW });
    const header = await headerFor(relay);
    const first = await app.request("/forecast", { headers: { [PAYMENT_SIGNATURE_HEADER]: header } });
    expect(first.status).toBe(402);
    expect(first.headers.get(PAYMENT_RETRY_HEADER)).toBeNull();
    expect(settleCalls()).toBe(1);
  });
});
