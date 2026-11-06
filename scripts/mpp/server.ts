// MPP demo endpoints. /paid is mppx-native; /rail/paid goes through the
// Countersign mpp rail, which is the logic the hub will use. Tempo testnet is
// the default method; the Stripe card method is mock-only and behind
// MPP_STRIPE=1.
import { mockStripeClient } from "../../packages/rail/src/mpp/mock.ts";
import {
  assertTempoRecipient,
  createMppRail,
  TEMPO_CURRENCY,
} from "../../packages/rail/src/mpp/index.ts";
import { Mppx, Store, stripe, tempo } from "../../packages/rail/src/mpp/mppx.ts";
import type { Offer, PaymentRequirements } from "../../packages/core/src/index.ts";

const port = Number(process.argv[2] ?? 8798);

function failEnv(name: string, problem: string): never {
  console.error(`${name} ${problem}`);
  process.exit(1);
}

function secretIsLongEnough(value: string): boolean {
  if (value.length >= 43) return true;
  return Buffer.from(value, "base64").byteLength >= 32;
}

function validRecipient(value: string): value is `0x${string}` {
  try {
    assertTempoRecipient(value);
    return true;
  } catch {
    return false;
  }
}

const secretKey = process.env.MPP_SECRET_KEY;
if (!secretKey) failEnv("MPP_SECRET_KEY", "is missing");
if (!secretIsLongEnough(secretKey)) failEnv("MPP_SECRET_KEY", "is too short: needs at least 32 bytes or 43 characters");

const rawRecipient = process.env.MPP_RECIPIENT;
if (!rawRecipient) failEnv("MPP_RECIPIENT", "is missing");
if (!validRecipient(rawRecipient)) {
  failEnv("MPP_RECIPIENT", "is not a checksummed or lowercase non-zero 20-byte hex address");
}
const recipient = rawRecipient;
const cardEnabled = process.env.MPP_STRIPE === "1";

const tempoCharge = tempo.charge({
  testnet: true,
  recipient,
  currencies: [TEMPO_CURRENCY],
  store: Store.memory(),
})[0]!;

const mppx = Mppx.create({
  methods: [tempoCharge],
  secretKey,
  realm: "localhost",
});

const cardMppx = cardEnabled
  ? Mppx.create({
      methods: [
        stripe.charge({
          client: mockStripeClient(),
          networkId: "profile_test_mock",
          currency: "usd",
          decimals: 2,
          paymentMethodTypes: ["card"],
        }),
      ],
      secretKey,
      realm: "localhost",
    })
  : undefined;

const rail = createMppRail({ recipient, secretKey, realm: "localhost" });

const offer: Offer = {
  v: 1,
  seller: "0x1111111111111111111111111111111111111111",
  title: "countersign mpp demo",
  summary: "An offer paid over the mpp rail",
  adapter: "skill",
  input: { type: "object" },
  output: { type: "object" },
  price: "10000",
  deadline: 3600,
  bond: "0",
  rails: ["mpp"],
  payTo: { mpp: recipient },
  issuedAt: Math.floor(Date.now() / 1000),
};

const tempoPaymentInfo = {
  amount: "10000",
  currency: TEMPO_CURRENCY,
  method: "tempo",
  intent: "charge",
  description: "0.01 pathUSD on Tempo Moderato",
};

const openapi = {
  openapi: "3.1.0",
  info: { title: "Countersign MPP demo rail", version: "0.0.0" },
  paths: {
    "/paid": {
      get: {
        summary: "A paid resource served by mppx",
        "x-payment-info": tempoPaymentInfo,
        responses: {
          "200": { description: "Paid" },
          "402": { description: "Payment required" },
        },
      },
    },
    "/rail/paid": {
      get: {
        summary: "A paid resource served through the Countersign mpp rail",
        "x-payment-info": tempoPaymentInfo,
        responses: {
          "200": { description: "Paid" },
          "402": { description: "Payment required" },
        },
      },
    },
    ...(cardEnabled
      ? {
          "/paid-card": {
            get: {
              summary: "A paid resource served by the mock Stripe method",
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
        }
      : {}),
  },
};

const llms = [
  "Countersign MPP demo rail.",
  "Tempo testnet (Moderato, chain 42431, pathUSD), 0.01 per call:",
  "GET /paid (mppx-native) and GET /rail/paid (through the Countersign rail).",
  ...(cardEnabled ? ["GET /paid-card charges 0.50 USD through the mock Stripe client."] : []),
  "The Stripe card method is off unless the server starts with MPP_STRIPE=1.",
  "",
].join("\n");

function challengeResponse(requirements: PaymentRequirements, error: string): Response {
  const mpp = requirements.extra?.mpp as { wwwAuthenticate?: unknown } | undefined;
  const header = typeof mpp?.wwwAuthenticate === "string" ? mpp.wwwAuthenticate : "";
  return Response.json({ error }, { status: 402, headers: { "www-authenticate": header } });
}

console.log(
  `mpp demo on http://localhost:${port}: Tempo testnet (Moderato, chain 42431), pathUSD, 0.01 per call; Stripe card method ${cardEnabled ? "on" : "off"}`,
);

const server = Bun.serve({
  port,
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/openapi.json") {
      return Response.json(openapi);
    }
    if (request.method === "GET" && url.pathname === "/llms.txt") {
      return new Response(llms, { headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    if (request.method === "GET" && url.pathname === "/paid") {
      const result = await mppx.charge({ amount: "0.01" })(request);
      if (result.status === 402) return result.challenge;
      return result.withReceipt(Response.json({ ok: true, resource: "countersign mpp demo" }));
    }
    if (request.method === "GET" && url.pathname === "/rail/paid") {
      const resource = `${url.origin}/rail/paid`;
      const authorization = request.headers.get("authorization");
      if (!authorization || !/^Payment\s+/i.test(authorization)) {
        const requirements = rail.challenge(offer, { resource, now: Math.floor(Date.now() / 1000) });
        return challengeResponse(requirements, "payment required");
      }
      const requirements = rail.challenge(offer, { resource, now: Math.floor(Date.now() / 1000) });
      const payment = {
        x402Version: 2 as const,
        accepted: requirements,
        payload: { credential: authorization },
      };
      const verified = await rail.verify(payment, requirements);
      if (!verified.isValid) {
        const reason = verified.invalidReason ?? "payment_failed";
        return Response.json(
          { error: "refused", reason },
          { status: reason === "replay" ? 409 : 400 },
        );
      }
      const settled = await rail.settle(payment, requirements);
      if (!settled.success) {
        const reason = settled.errorReason ?? "payment_failed";
        if (reason === "replay") {
          return Response.json({ error: "refused", reason }, { status: 409 });
        }
        if (reason === "payment_failed") {
          return Response.json(
            { error: "payment outcome unknown; retry with the same credential", reason },
            { status: 502 },
          );
        }
        return Response.json({ error: "refused", reason }, { status: 400 });
      }
      return Response.json(
        { ok: true, transaction: settled.transaction },
        { status: 200, headers: { "payment-receipt": settled.receipt ?? "" } },
      );
    }
    if (cardEnabled && request.method === "GET" && url.pathname === "/paid-card") {
      const result = await cardMppx!.charge({ amount: "0.50" })(request);
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
