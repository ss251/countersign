// A stand-in hub for the hedera agent: not the real hub. It lists one hedera offer and settles
// its calls through createHederaRail() with the default facilitators.
//   bun scripts/hedera/hub-standin.ts [port]
console.log("stand-in hub: not the real hub; one hedera offer, settled through the default facilitators.");
import {
  fromBase64Json,
  offerHash,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  toBase64Json,
  type Offer,
  type PaymentPayload,
  type PaymentRequired,
} from "../../packages/core/src/index.ts";
import { createHederaRail, hashscanTx, USDC_TESTNET } from "../../packages/rail/src/hedera/index.ts";
import { need, readEnv } from "./env.ts";

const env = readEnv();
const port = Number(process.argv[2] ?? 8787);
if (!Number.isSafeInteger(port) || port < 0 || port > 65535) {
  console.error(`bad port ${process.argv[2]}`);
  process.exit(2);
}

const payTo = need(env, "HD_SELLER_ID");
const offer: Offer = {
  v: 1,
  seller: (env.HD_SELLER_EVM ?? "0x00000000000000000000000000000000000000a1") as Offer["seller"],
  title: "hedera stand-in call",
  summary: "One paid call from the stand-in hub, settled on the hedera rail.",
  adapter: "mcp",
  input: { type: "object" },
  output: { type: "object" },
  price: "10000",
  deadline: 60,
  bond: "0",
  rails: ["hedera"],
  payTo: { hedera: payTo },
  issuedAt: Math.floor(Date.now() / 1000),
};
const hash = offerHash(offer);
const listing = { offerHash: hash, offer, online: true, status: "listed" as const };

const rail = await createHederaRail();
const declaration = rail.declaration;

function requiredFor(resource: string): PaymentRequired {
  const requirements = rail.challenge(offer, { resource, now: Math.floor(Date.now() / 1000) });
  return { x402Version: 2, resource: { url: resource }, accepts: [requirements] };
}

const server = Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/offers") {
      return Response.json({ offers: [listing] });
    }
    if (request.method === "POST" && url.pathname === `/offers/${hash}/call`) {
      const signature = request.headers.get(PAYMENT_SIGNATURE_HEADER);
      if (!signature) {
        const required = requiredFor(url.toString());
        return new Response(JSON.stringify(required), {
          status: 402,
          headers: { "content-type": "application/json", [PAYMENT_REQUIRED_HEADER]: toBase64Json(required) },
        });
      }
      const payment = fromBase64Json<PaymentPayload>(signature);
      const requirements = requiredFor(url.toString()).accepts[0]!;
      const verified = await rail.verify(payment, requirements);
      if (!verified.isValid) {
        return Response.json(
          { code: "payment_invalid", message: `refused: ${verified.invalidReason ?? "invalid"}` },
          { status: 402 },
        );
      }
      const settlement = await rail.settle(payment, requirements);
      if (!settlement.success) {
        return Response.json(
          { code: "settle_failed", message: settlement.errorReason ?? "settlement failed" },
          { status: 402 },
        );
      }
      const body = {
        output: { ok: true },
        slip: {
          settlement: {
            transaction: settlement.transaction,
            network: settlement.network,
            url: hashscanTx(settlement.transaction),
          },
        },
      };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json", [PAYMENT_RESPONSE_HEADER]: toBase64Json(settlement) },
      });
    }
    return new Response("not found", { status: 404 });
  },
});

console.log(`listening on http://127.0.0.1:${server.port}`);
console.log(`offer    ${hash}  price 0.01 USDC (${USDC_TESTNET})  payTo ${payTo}`);
console.log(`rail     ${declaration.id} ${declaration.network}  facilitator ${rail.active?.name ?? "none"} fee payer ${rail.active?.feePayer ?? "none"}`);
