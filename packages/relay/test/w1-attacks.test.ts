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
