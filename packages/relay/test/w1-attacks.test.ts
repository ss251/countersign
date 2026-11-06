import { afterEach, describe, expect, test } from "bun:test";
import { NETWORK } from "../src/chain.ts";
import { signAuthorization } from "../src/eip3009.ts";
import { createMerchantApp } from "../src/merchant-server.ts";
import { refundPayment } from "../src/refund.ts";
import { createTestRelay, fakeHash, fakeNonce, makeAuthorization, NOW } from "./support.ts";

// cs-w1 adversarial tests. A failing test here is a blocker.

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("W1 B1: merchant refund endpoint has no authentication", () => {
  test("an anonymous caller cannot make the merchant key sign and send a refund", async () => {
    const relay = createTestRelay();
    const paymentId = fakeHash();
    const relayCalls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      relayCalls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith(`/payments/${paymentId}`)) {
        return new Response(
          JSON.stringify({
            payer: relay.buyer.address,
            payTo: relay.merchant.address,
            amount: "1000000",
            refunded: "0",
            status: "settled",
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    const app = createMerchantApp({ merchant: relay.merchant, relayUrl: "http://relay.test", now: () => NOW });
    // No cookie, no header, no body: the position of any buyer who just received the goods.
    const res = await app.request(`/refund/${paymentId}`, { method: "POST" });

    const reachedRelay = relayCalls.some((c) => c.startsWith("POST http://relay.test/refund"));
    expect([401, 403]).toContain(res.status);
    expect(reachedRelay).toBe(false);
  });
});

describe("W1 B2: a pending refund does not reserve its amount", () => {
  test("after a refund times out pending, a second full refund is refused", async () => {
    const relay = createTestRelay();
    const paymentId = fakeHash();
    relay.ledger.recordPayment({
      id: paymentId,
      network: NETWORK,
      payer: relay.buyer.address,
      payTo: relay.merchant.address,
      amount: 1_000_000n,
      nonce: fakeNonce(),
      txHash: paymentId,
      blockNumber: 10n,
      settledAt: NOW * 1000,
    });
    const build = async () => {
      const authorization = makeAuthorization({
        from: relay.merchant.address,
        to: relay.buyer.address,
        value: 1_000_000n,
      });
      return { paymentId, authorization, signature: await signAuthorization(relay.merchant, authorization) };
    };

    // First click: broadcast, receipt wait times out, the ledger records nothing.
    relay.chain.timeoutReceipt = true;
    const first = await refundPayment(await build(), relay.ctx);
    expect(first).toEqual({ ok: false, reason: "settlement_pending" });

    // Second click with a fresh nonce while the first may still land.
    relay.chain.timeoutReceipt = false;
    await refundPayment(await build(), relay.ctx);

    // Both transactions are on the wire: the merchant has refunded twice the payment.
    expect(relay.chain.writes.length).toBe(1);
  });
});

describe("W1 B1b: the escrow order refund route is unauthenticated too", () => {
  test("an anonymous caller cannot make the merchant key sign a Cancel for a held order", async () => {
    const relay = createTestRelay();
    const jobId = fakeHash();
    const relayCalls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      relayCalls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith(`/orders/${jobId}`)) {
        return new Response(
          JSON.stringify({
            id: jobId,
            kind: "escrow",
            status: "held",
            customer: relay.buyer.address,
            merchant: relay.merchant.address,
            amount: "1000000",
            refunded: "0",
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    const app = createMerchantApp({ merchant: relay.merchant, relayUrl: "http://relay.test", now: () => NOW });
    const res = await app.request(`/orders/${jobId}/refund`, { method: "POST" });

    expect([401, 403]).toContain(res.status);
    expect(relayCalls.some((c) => c.startsWith("POST http://relay.test/escrow/cancel"))).toBe(false);
  });
});

describe("W1 B9: one payment buys more than one response", () => {
  test("a second request that verified before the first settled is not served on the same payment", async () => {
    const { Hono } = await import("hono");
    const { createRelayApp } = await import("../src/server.ts");
    const { whitechainPaywall } = await import("../src/paywall.ts");
    const { PAYMENT_SIGNATURE_HEADER, toBase64Json } = await import("@countersign/core");
    const { makeAuthorization, makeRequirements, makeVerifyBody } = await import("./support.ts");

    const relay = createTestRelay();
    // The real token refuses a used nonce when the relayer simulates the transfer.
    const simulate = relay.chain.simulateContract.bind(relay.chain);
    relay.chain.simulateContract = async (call) => {
      const a = (call.args ?? []) as unknown[];
      if (call.functionName === "transferWithAuthorization" && relay.chain.isUsed(String(a[0]), String(a[5]))) {
        throw new Error("authorization is used");
      }
      return simulate(call);
    };
    const relayApp = createRelayApp({ reader: relay.chain, relayer: relay.relayer, ledger: relay.ledger, now: () => NOW, config: {} });
    const route = async (input: RequestInfo | URL, init?: RequestInit) => relayApp.request(input instanceof Request ? input : new Request(input, init));

    let served = 0;
    const app = new Hono();
    app.get(
      "/forecast",
      whitechainPaywall({ price: "0.05", payTo: relay.merchant.address, facilitator: "http://relay.test", fetch: route as never }),
      async (c) => {
        served++;
        await Bun.sleep(300); // the merchant's real work
        return c.json({ forecast: "rain" });
      },
    );

    const body = await makeVerifyBody({
      signer: relay.buyer,
      authorization: makeAuthorization({ from: relay.buyer.address, to: relay.merchant.address, value: 50_000n }),
      requirements: makeRequirements(relay.merchant.address, 50_000n, { maxTimeoutSeconds: 120 }),
    });
    const header = toBase64Json(body.paymentPayload);
    const call = () => app.request("http://shop.test/forecast", { headers: { [PAYMENT_SIGNATURE_HEADER]: header } });

    const first = call();
    await Bun.sleep(150); // the same payment arrives again while the first is still being served
    const second = call();
    const statuses = [(await first).status, (await second).status];

    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(relay.ledger.listPayments({ payTo: relay.merchant.address })).toHaveLength(1);
    void served;
  });
});

describe("W1 B10: pay-fetch counts spend after the fact, not at signing", () => {
  test("authorisations handed to a server that then answers 500 still count against the budget", async () => {
    const { createPayFetch, SpendLimitError } = await import("../src/pay-fetch.ts");
    const { PAYMENT_REQUIRED_HEADER, PAYMENT_SIGNATURE_HEADER, toBase64Json } = await import("@countersign/core");
    const { NETWORK, USDT } = await import("../src/chain.ts");
    const { makeRequirements } = await import("./support.ts");
    const relay = createTestRelay();
    let signed = 0;
    // A hostile merchant: asks for payment, takes the signed authorisation, then answers 500
    // (so the buyer sees no receipt) and settles the authorisation itself.
    const route = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (!headers.get(PAYMENT_SIGNATURE_HEADER)) {
        const req = makeRequirements(relay.merchant.address, 50_000n, { maxTimeoutSeconds: 1_000_000_000 });
        const body = { x402Version: 2, accepts: [req], resource: { url: String(input) } };
        return new Response(JSON.stringify(body), { status: 402, headers: { [PAYMENT_REQUIRED_HEADER]: toBase64Json(body) } });
      }
      signed++;
      return new Response("boom", { status: 500 });
    }) as never;
    void NETWORK; void USDT;
    const pay = createPayFetch({ account: relay.buyer, fetch: route, now: () => NOW, maxPerCall: "0.10", budget: "0.05" });

    let refusedAt = -1;
    for (let i = 0; i < 5; i++) {
      try {
        await pay("http://evil.test/x");
      } catch (e) {
        if (e instanceof SpendLimitError) {
          refusedAt = i;
          break;
        }
        throw e;
      }
    }
    // Budget 0.05 and each authorisation is 0.05: at most one may ever be handed out.
    expect(signed).toBeLessThanOrEqual(1);
    expect(refusedAt).toBeGreaterThanOrEqual(0);
  });
});
