import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { PAYMENT_SIGNATURE_HEADER, parseUnits, toBase64Json } from "@countersign/core";
import { NETWORK, USDT } from "../src/chain.ts";
import { PAYMENT_RETRY_HEADER, whitechainPaywall } from "../src/paywall.ts";
import type { PaywallFetch } from "../src/paywall.ts";
import { NOW, createTestRelay, makeAuthorization, makeRequirements, makeVerifyBody } from "./support.ts";

// cs-w1 adversarial test (B29; runs on cs/wc-11, PR #250). A failing test here is a blocker.
// One payment, one serve. Two lost settle replies leave the claim pending behind a retry token. Two
// token retries then race: the first one's settle answer (settlement_pending) arrives only after the
// second one's (success) has already served the request. The paywall must not put the claim back to
// pending on that late answer: if it does, a third token retry finds a pending claim with a
// transaction, the order lookup says paid, and the handler runs a second time for the same payment.

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("W1 B29: a token retry's late settlement_pending cannot re-open a claim another retry served", () => {
  test("the handler runs once for one payment, whatever order the settle answers arrive in", async () => {
    const relay = createTestRelay();
    const amount = parseUnits("0.05", USDT.decimals);
    const requirements = makeRequirements(relay.merchant.address, amount, { maxTimeoutSeconds: 120 });
    const authorization = makeAuthorization({
      from: relay.buyer.address,
      to: relay.merchant.address,
      value: amount,
      validBefore: BigInt(NOW + 600),
    });
    const body = await makeVerifyBody({ signer: relay.buyer, authorization, requirements });
    const header = toBase64Json(body.paymentPayload);

    let settleCalls = 0;
    let releaseSlow: () => void = () => undefined;
    const slowGate = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    const fetch: PaywallFetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.startsWith("/orders/")) return json({ status: "paid" });
      if (url.pathname === "/verify") return json({ isValid: true, payer: relay.buyer.address });
      settleCalls += 1;
      // The first request's settle and its one retry both lose their replies.
      if (settleCalls <= 2) throw new Error("connection reset");
      // The first token retry: the relay says pending, but the answer arrives late.
      if (settleCalls === 3) {
        await slowGate;
        return json({ success: false, errorReason: "settlement_pending", transaction: "0xpend", network: NETWORK });
      }
      // The second token retry: the payment has landed.
      return json({ success: true, transaction: "0xpend", network: NETWORK, amount: "50000", replayed: true });
    };

    let served = 0;
    const app = new Hono();
    app.get(
      "/forecast",
      whitechainPaywall({
        price: "0.05",
        payTo: relay.merchant.address,
        facilitator: "http://relay.test",
        settle: "before",
        settleRetryDelayMs: 0,
        now: () => NOW,
        fetch,
      }),
      (c) => {
        served += 1;
        return c.json({ forecast: "rain" });
      },
    );
    const ask = (token?: string) =>
      app.request("/forecast", {
        headers: { [PAYMENT_SIGNATURE_HEADER]: header, ...(token ? { [PAYMENT_RETRY_HEADER]: token } : {}) },
      });

    const first = await ask();
    expect(first.status).toBe(402);
    const token = first.headers.get(PAYMENT_RETRY_HEADER);
    expect(token).toBeTruthy();

    const slow = ask(token as string);
    await Bun.sleep(5);
    const fast = await ask(token as string);
    expect(fast.status).toBe(200);
    expect(served).toBe(1);

    releaseSlow();
    expect((await slow).status).toBe(409);

    // The payment was served once. A third retry with the same token must not be served again.
    const third = await ask(token as string);
    expect(served).toBe(1);
    expect(third.status).toBe(409);
  });
});
