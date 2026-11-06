// MPP-native demo endpoint for `npx mppx@latest validate`.
// Runs entirely in mock mode: every PaymentIntent is answered in-process.
import { randomBytes } from "node:crypto";
import { mockStripeClient } from "../../packages/rail/src/mpp/mock.ts";
import { Mppx, stripe } from "../../packages/rail/src/mpp/mppx.ts";

const port = Number(process.argv[2] ?? 8798);
const secretKey = randomBytes(32).toString("base64url");
const mock = mockStripeClient();

const mppx = Mppx.create({
  methods: [
    stripe.charge({
      client: mock,
      networkId: "profile_test_mock",
      currency: "usd",
      decimals: 2,
      paymentMethodTypes: ["card"],
    }),
  ],
  secretKey,
  realm: "localhost",
});

const openapi = {
  openapi: "3.1.0",
  info: { title: "Countersign MPP mock rail", version: "0.0.0" },
  paths: {
    "/paid": {
      get: {
        summary: "A paid mock resource",
        "x-payment-info": {
          amount: "50",
          currency: "usd",
          method: "stripe",
          intent: "charge",
          description: "0.50 USD through the mock Stripe client",
        },
        responses: {
          "200": { description: "Paid" },
          "402": { description: "Payment required" },
        },
      },
    },
  },
};

console.log(`mock mode: no Stripe calls, listening on http://localhost:${port}`);
console.log(`ephemeral HMAC challenge secret generated for this process (${secretKey.length} chars, not printed)`);

const server = Bun.serve({
  port,
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/openapi.json") {
      return Response.json(openapi);
    }
    if (request.method === "GET" && url.pathname === "/llms.txt") {
      return new Response(
        "Countersign MPP mock rail. The paid endpoint is GET /paid for 0.50 USD. " +
          "It runs in mock mode: no Stripe calls leave the process.\n",
        { headers: { "content-type": "text/plain; charset=utf-8" } },
      );
    }
    if (url.pathname === "/paid") {
      const result = await mppx.charge({ amount: "0.50" })(request);
      if (result.status === 402) return result.challenge;
      return result.withReceipt(Response.json({ ok: true }));
    }
    return new Response("not found", { status: 404 });
  },
});

process.on("SIGTERM", () => {
  server.stop();
  process.exit(0);
});
