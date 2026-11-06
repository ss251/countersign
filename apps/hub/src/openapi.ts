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

const ORDER_SCHEMA: JsonObject = {
  type: "object",
  required: [
    "id",
    "kind",
    "rail",
    "network",
    "networkName",
    "asset",
    "explorer",
    "customer",
    "merchant",
    "amount",
    "fee",
    "refunded",
    "refundable",
    "status",
    "closeKind",
    "createdAt",
    "deadline",
    "receivedAt",
    "closedAt",
    "settleTx",
    "closeTx",
    "refundTxs",
    "slipHash",
    "offerHash",
    "description",
    "settleTxUrl",
    "closeTxUrl",
  ],
  properties: {
    id: { type: "string" },
    kind: { type: "string", enum: ["escrow", "exact"] },
    rail: { type: "string" },
    network: { type: "string" },
    networkName: { type: "string" },
    asset: {
      type: "object",
      required: ["symbol", "decimals"],
      properties: { symbol: { type: "string" }, decimals: { type: "integer" } },
    },
    explorer: { type: ["string", "null"] },
    customer: { type: "string" },
    merchant: { type: "string" },
    amount: { type: "string" },
    fee: { type: "string" },
    refunded: { type: "string" },
    refundable: { type: "string" },
    status: { type: "string" },
    closeKind: { type: ["string", "null"] },
    createdAt: { type: "integer", description: "Unix milliseconds." },
    deadline: { type: "integer", description: "Unix milliseconds." },
    receivedAt: { type: ["integer", "null"], description: "Unix milliseconds." },
    closedAt: { type: ["integer", "null"], description: "Unix milliseconds." },
    settleTx: { type: ["string", "null"] },
    closeTx: { type: ["string", "null"] },
    refundTxs: { type: "array", items: { type: "string" } },
    slipHash: { type: ["string", "null"] },
    offerHash: { type: "string" },
    description: { type: ["string", "null"] },
    settleTxUrl: { type: ["string", "null"] },
    closeTxUrl: { type: ["string", "null"] },
    relayUnavailable: { type: "boolean" },
  },
};

const REFUND_SCHEMA: JsonObject = {
  type: "object",
  required: ["amount", "txHash", "blockNumber", "status", "reason", "at"],
  properties: {
    amount: { type: "string" },
    txHash: { type: "string" },
    blockNumber: { type: "integer" },
    status: { type: "string", enum: ["pending", "confirmed"] },
    reason: { type: ["string", "null"] },
    at: { type: ["integer", "null"] },
  },
};

const JOB_SCHEMA: JsonObject = {
  type: "object",
  required: [
    "jobId",
    "offerHash",
    "title",
    "amount",
    "rail",
    "network",
    "status",
    "at",
    "buyer",
    "seller",
    "settleTx",
    "closeTx",
    "slipHash",
    "explorer",
  ],
  properties: {
    jobId: { type: "string" },
    offerHash: { type: "string" },
    title: { type: "string" },
    amount: { type: "string" },
    rail: { type: "string" },
    network: { type: "string" },
    status: { type: "string" },
    at: { type: "integer", description: "Unix seconds." },
    buyer: { type: "string" },
    seller: { type: "string" },
    settleTx: { type: ["string", "null"] },
    closeTx: { type: ["string", "null"] },
    slipHash: { type: ["string", "null"] },
    explorer: { type: ["string", "null"] },
  },
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
    "/orders": ordersPath(),
    "/orders/{id}": orderPath(),
    "/jobs": jobsPath(),
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
    components: {
      schemas: {
        PaymentRequired: PAYMENT_REQUIRED_SCHEMA,
        Order: ORDER_SCHEMA,
        Refund: REFUND_SCHEMA,
        Job: JOB_SCHEMA,
      },
    },
  };
}

function ordersPath(): JsonObject {
  return {
    get: {
      summary: "List a seller's orders, newest first.",
      parameters: [
        queryParam("seller", "The seller's address.", true),
        {
          ...queryParam("limit", "Maximum orders to return.", false),
          schema: { type: "integer", minimum: 1, maximum: 500, default: 200 },
        },
      ],
      responses: {
        "200": jsonResponse("The seller's orders.", {
          type: "object",
          required: ["orders"],
          properties: { orders: { type: "array", items: { $ref: "#/components/schemas/Order" } } },
        }),
        "400": { description: "The seller is missing or not an address." },
      },
    },
  };
}

function orderPath(): JsonObject {
  return {
    get: {
      summary: "Read one order, with its refunds.",
      parameters: [pathParam("id")],
      responses: {
        "200": jsonResponse("The order and its refunds.", {
          allOf: [
            { $ref: "#/components/schemas/Order" },
            {
              type: "object",
              required: ["refunds"],
              properties: {
                refunds: { type: "array", items: { $ref: "#/components/schemas/Refund" } },
              },
            },
          ],
        }),
        "404": jsonResponse("No such order.", {
          type: "object",
          required: ["code"],
          properties: { code: { type: "string", const: "not_found" } },
        }),
      },
    },
  };
}

function jobsPath(): JsonObject {
  return {
    get: {
      summary: "List a buyer's or a seller's jobs, newest first.",
      parameters: [
        queryParam("buyer", "The buyer's address.", false),
        queryParam("seller", "The seller's address.", false),
        queryParam("limit", "Maximum jobs to return.", false),
      ],
      responses: {
        "200": jsonResponse("The matching jobs.", {
          type: "object",
          required: ["jobs"],
          properties: { jobs: { type: "array", items: { $ref: "#/components/schemas/Job" } } },
        }),
        "400": { description: "Name exactly one of the buyer or the seller." },
      },
    },
  };
}

function queryParam(name: string, description: string, required: boolean): JsonObject {
  return {
    name,
    in: "query",
    required,
    description,
    schema: { type: "string" },
  };
}

function jsonResponse(description: string, schema: JsonObject): JsonObject {
  return { description, content: { "application/json": { schema } } };
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
