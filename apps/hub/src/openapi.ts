import { acceptsFor, callBodySchema, resourceFor, type DiscoveryDeps } from "./discovery.ts";
import type { StoredOffer } from "./store.ts";

type JsonObject = Record<string, unknown>;

const PAYMENT_SIGNATURE_PARAMETER: JsonObject = {
  name: "PAYMENT-SIGNATURE",
  in: "header",
  required: false,
  description: "The base64-encoded x402 v2 payment payload.",
  schema: { type: "string" },
};

const PAYMENT_REQUIRED_RESPONSE: JsonObject = {
  description: "Payment is required before the call runs.",
  headers: {
    "PAYMENT-REQUIRED": {
      description: "The base64-encoded PaymentRequired body.",
      schema: { type: "string" },
    },
  },
  content: {
    "application/json": { schema: { $ref: "#/components/schemas/PaymentRequired" } },
  },
};

const PAYMENT_REQUIRED_SCHEMA: JsonObject = {
  type: "object",
  properties: {
    x402Version: { type: "integer", const: 2 },
    error: { type: "string" },
    resource: {
      type: "object",
      properties: {
        url: { type: "string" },
        description: { type: "string" },
        mimeType: { type: "string" },
      },
      required: ["url"],
    },
    accepts: { type: "array", items: { type: "object" } },
    extensions: { type: "object" },
  },
  required: ["x402Version", "resource", "accepts"],
};

export function openapiDocument(deps: DiscoveryDeps): JsonObject {
  const paths: JsonObject = {
    "/offers": { get: { summary: "List listed offers." } },
    "/offers/{offerHash}": {
      get: { summary: "Read one listed offer.", parameters: [pathParam("offerHash")] },
    },
    "/offers/{offerHash}/call": callPath(),
    "/slips/{slipHash}": {
      get: { summary: "Read a countersigned slip.", parameters: [pathParam("slipHash")] },
    },
    "/jobs/{jobId}": {
      get: { summary: "Read one job.", parameters: [pathParam("jobId")] },
    },
    "/discovery/resources": { get: { summary: "List x402 discovery resources." } },
    "/rails": { get: { summary: "List settlement rails." } },
    "/ratings": {
      get: { summary: "Seller ratings derived from verified slips, refunds and failed deliveries." },
    },
    "/ratings/{seller}": {
      get: { summary: "One seller's derived rating, with a line per offer.", parameters: [pathParam("seller")] },
    },
    "/stats": { get: { summary: "Hub totals derived from the job ledger." } },
  };

  for (const stored of deps.store.listOffers()) {
    paths[`/offers/${stored.offerHash}/call`] = offerPath(deps, stored);
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "countersign hub",
      version: "0.1.0",
      description:
        "Escrowed, countersigned x402 calls to software that sells itself.",
    },
    servers: [{ url: deps.publicUrl }],
    paths,
    components: { schemas: { PaymentRequired: PAYMENT_REQUIRED_SCHEMA } },
  };
}

function pathParam(name: string): JsonObject {
  return { name, in: "path", required: true, schema: { type: "string" } };
}

function callPath(): JsonObject {
  return {
    post: {
      summary: "Call a listed offer with an x402 payment.",
      parameters: [PAYMENT_SIGNATURE_PARAMETER],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                input: { type: "object" },
                lineage: { type: "array", items: { type: "string" } },
              },
              required: ["input"],
            },
          },
        },
      },
      responses: {
        "200": {
          description: "The seller's output and the countersigned slip.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { output: { type: "object" }, slip: { type: "object" } },
                required: ["output", "slip"],
              },
            },
          },
        },
        "402": PAYMENT_REQUIRED_RESPONSE,
        "422": { description: "The input does not match the offer's schema." },
        "503": { description: "The seller is offline or no configured rail serves the offer." },
      },
    },
  };
}

function offerPath(deps: DiscoveryDeps, stored: StoredOffer): JsonObject {
  const offer = stored.offer;
  const resource = resourceFor(deps.publicUrl, stored.offerHash);
  return {
    post: {
      summary: offer.title,
      description: offer.summary || offer.title,
      parameters: [PAYMENT_SIGNATURE_PARAMETER],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: callBodySchema(offer),
          },
        },
      },
      responses: {
        "200": {
          description: "The seller's output and the countersigned slip.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { output: offer.output, slip: { type: "object" } },
                required: ["output", "slip"],
              },
            },
          },
        },
        "402": PAYMENT_REQUIRED_RESPONSE,
        "422": { description: "The input does not match the offer's schema." },
        "503": { description: "The seller is offline or no configured rail serves the offer." },
      },
      "x-x402-accepts": acceptsFor(deps.rails, offer, resource, deps.now()),
    },
  };
}
