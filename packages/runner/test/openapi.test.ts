import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { Server, ServerWebSocket } from "bun";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertOffer,
  assertSchema,
  canonicalHash,
  checkSchema,
  offerHash as hashOffer,
  RUNNER_PATH,
  type JobOrder,
  type Offer,
  type RunnerToHub,
} from "@countersign/core";
import type { Address, Hex } from "../src/account.ts";
import { runInChild } from "../src/child.ts";
import { parseOptions } from "../src/cli.ts";
import { startRunner } from "../src/daemon.ts";
import {
  openApiOffer,
  readOperation,
  runOpenApi,
  type OpenApiSpec,
} from "../src/openapi.ts";
import { loadViem, type Viem } from "./viem.ts";

const FIXTURE = join(import.meta.dir, "fixtures", "invoices.openapi.json");
const LIMITS = { timeMs: 20_000, maxOutputBytes: 200_000 };
const SELLER = "0x1111111111111111111111111111111111111111" as Address;
const NOW = 1_700_000_000;
const PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const NONCE = "0123456789abcdef0123456789abcdef";
const BUYER = "0x2222222222222222222222222222222222222222";
const ESCROW = "0x4444444444444444444444444444444444444444";
const ASSET = "0x3600000000000000000000000000000000000000";
const INVOICE = { id: "inv_1", amount: "2500", status: "open" };

const viem: Viem = await loadViem();

interface Recorded {
  method: string;
  path: string;
  query: string;
  body: unknown;
}

let server: Server<undefined>;
let baseUrl: string;
let recorded: Recorded[] = [];

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const url = new URL(request.url);
      let body: unknown = null;
      if (request.method === "POST") {
        const text = await request.text();
        body = text === "" ? null : (JSON.parse(text) as unknown);
      }
      recorded.push({
        method: request.method,
        path: url.pathname,
        query: url.search,
        body,
      });

      if (request.method === "GET" && url.pathname === "/invoices/inv_1") {
        return Response.json(INVOICE);
      }
      if (request.method === "GET" && url.pathname === "/float") {
        return Response.json({ amount: 1.5 });
      }
      if (request.method === "POST" && url.pathname === "/invoices") {
        return Response.json({ ...INVOICE, id: "inv_2" }, { status: 201 });
      }
      return Response.json({ error: "not found" }, { status: 404 });
    },
  });
  baseUrl = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  await server.stop(true);
});

beforeEach(() => {
  recorded = [];
});

function specFor(operationId: string): OpenApiSpec {
  return { adapter: "openapi", specPath: FIXTURE, operationId, baseUrl };
}

function offerFor(operationId: string): Offer {
  return openApiOffer({
    seller: SELLER,
    document: FIXTURE,
    operationId,
    price: "1000",
    deadline: 120,
    rails: ["escrow"],
    now: NOW,
  });
}

function writeDocument(document: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "countersign-openapi-"));
  const path = join(dir, "spec.json");
  writeFileSync(path, JSON.stringify(document));
  return path;
}

function baseDocument(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: { title: "Items", version: "1.0.0" },
    paths: {
      "/items": {
        get: {
          operationId: "listItems",
          summary: "List items",
          responses: { "200": { description: "ok" } },
        },
      },
    },
    ...extra,
  };
}

describe("openApiOffer", () => {
  test("builds an offer the hub accepts and resolves the response schema", () => {
    const offer = offerFor("getInvoice");
    expect(() => assertOffer(offer)).not.toThrow();
    expect(() => assertSchema(offer.input)).not.toThrow();
    expect(() => assertSchema(offer.output)).not.toThrow();
    expect(offer.adapter).toBe("openapi");
    expect(offer.title).toBe("Get an invoice");
    expect(offer.summary).toBe("Returns one invoice by id.");
    expect(offer.bond).toBe("0");

    const input = offer.input as { required?: string[] };
    expect(input.required).toContain("id");

    const output = offer.output as {
      properties: { result: Record<string, unknown> };
    };
    expect(output.properties.result).toEqual({
      type: "object",
      properties: {
        id: { type: "string" },
        amount: { type: "string" },
        status: { type: "string" },
      },
      required: ["id", "amount", "status"],
      additionalProperties: false,
    });
    expect(JSON.stringify(output.properties.result)).not.toContain("$ref");
  });

  test("marks a required body required in the input", () => {
    const offer = offerFor("createInvoice");
    expect(() => assertOffer(offer)).not.toThrow();
    expect(() => assertSchema(offer.input)).not.toThrow();
    expect(() => assertSchema(offer.output)).not.toThrow();
    const input = offer.input as {
      required?: string[];
      properties?: Record<string, unknown>;
    };
    expect(input.required).toContain("body");
    expect(input.properties?.body).toEqual({
      type: "object",
      properties: {
        amount: { type: "string" },
        memo: { type: "string" },
      },
      required: ["amount"],
      additionalProperties: false,
    });
  });
});

describe("readOperation refusals", () => {
  test("refuses an unknown operation", () => {
    const path = writeDocument(baseDocument());
    expect(() => readOperation(path, "missing")).toThrow(
      "Refused. The OpenAPI document has no operation missing.",
    );
  });

  test("refuses a repeated operation", () => {
    const path = writeDocument(
      baseDocument({
        paths: {
          "/a": { get: { operationId: "dup", responses: {} } },
          "/b": { post: { operationId: "dup", responses: {} } },
        },
      }),
    );
    expect(() => readOperation(path, "dup")).toThrow(
      "Refused. The OpenAPI document repeats operation dup.",
    );
  });

  test("refuses a header parameter", () => {
    const path = writeDocument(
      baseDocument({
        paths: {
          "/items": {
            get: {
              operationId: "listItems",
              parameters: [
                { name: "authorization", in: "header", schema: { type: "string" } },
              ],
              responses: { "200": { description: "ok" } },
            },
          },
        },
      }),
    );
    expect(() => readOperation(path, "listItems")).toThrow(
      "Refused. Header and cookie parameters are not supported.",
    );
  });

  test("refuses an object-typed query parameter", () => {
    const path = writeDocument(
      baseDocument({
        paths: {
          "/items": {
            get: {
              operationId: "listItems",
              parameters: [{ name: "filter", in: "query", schema: { type: "object" } }],
              responses: { "200": { description: "ok" } },
            },
          },
        },
      }),
    );
    expect(() => readOperation(path, "listItems")).toThrow(
      "Refused. Parameter filter must be a string, number, integer or boolean.",
    );
  });

  test("refuses a body that is not application/json", () => {
    const path = writeDocument(
      baseDocument({
        paths: {
          "/items": {
            post: {
              operationId: "createItem",
              requestBody: {
                content: { "text/plain": { schema: { type: "string" } } },
              },
              responses: { "200": { description: "ok" } },
            },
          },
        },
      }),
    );
    expect(() => readOperation(path, "createItem")).toThrow(
      "Refused. The request body must be application/json.",
    );
  });

  test("refuses an external reference", () => {
    const path = writeDocument(
      baseDocument({
        paths: {
          "/items": {
            get: {
              operationId: "listItems",
              responses: {
                "200": {
                  description: "ok",
                  content: {
                    "application/json": {
                      schema: { $ref: "https://example.test/items.json" },
                    },
                  },
                },
              },
            },
          },
        },
      }),
    );
    expect(() => readOperation(path, "listItems")).toThrow(
      "Refused. Only local component references are supported.",
    );
  });

  test("refuses a Swagger 2 document", () => {
    const path = writeDocument({
      swagger: "2.0",
      info: { title: "Items", version: "1.0.0" },
      paths: {},
    });
    expect(() => readOperation(path, "listItems")).toThrow(
      "Refused. Only OpenAPI 3 JSON documents are supported.",
    );
  });

  test("refuses a reference cycle", () => {
    const path = writeDocument({
      openapi: "3.1.0",
      info: { title: "Items", version: "1.0.0" },
      paths: {
        "/items": {
          get: {
            operationId: "listItems",
            responses: {
              "200": {
                description: "ok",
                content: {
                  "application/json": { schema: { $ref: "#/components/schemas/Node" } },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Node: {
            type: "object",
            properties: { next: { $ref: "#/components/schemas/Node" } },
          },
        },
      },
    });
    expect(() => readOperation(path, "listItems")).toThrow(
      "Refused. The OpenAPI document has a reference cycle.",
    );
  });
});

describe("runOpenApi", () => {
  test("runs the operation in the scrubbed child and hashes the input", async () => {
    const input = { id: "inv_1" };
    const output = await runInChild(specFor("getInvoice"), input, LIMITS);
    expect(output).toEqual({
      operationId: "getInvoice",
      status: 200,
      inputHash: canonicalHash(input),
      result: INVOICE,
    });
    expect(checkSchema(offerFor("getInvoice").output, output).ok).toBe(true);
  });

  test("posts the body as JSON and returns the created invoice", async () => {
    const input = { body: { amount: "2500" } };
    const output = await runInChild(specFor("createInvoice"), input, LIMITS);
    expect(output).toMatchObject({
      operationId: "createInvoice",
      status: 201,
      result: { id: "inv_2", amount: "2500", status: "open" },
    });
    const request = recorded.find((entry) => entry.method === "POST");
    expect(request?.path).toBe("/invoices");
    expect(request?.body).toEqual({ amount: "2500" });
  });

  test("keeps a path parameter in one encoded segment", async () => {
    await expect(runOpenApi(specFor("getInvoice"), { id: "../admin?x=1" })).rejects.toThrow(
      "The operation answered 404",
    );
    expect(recorded[0]?.path).toBe("/invoices/..%2Fadmin%3Fx%3D1");
    expect(recorded.some((entry) => entry.path === "/admin")).toBe(false);
  });

  test("refuses a non-2xx answer without its body", async () => {
    await expect(runOpenApi(specFor("getInvoice"), { id: "missing" })).rejects.toThrow(
      "The operation answered 404",
    );
  });

  test("refuses an answer with a float", async () => {
    await expect(runOpenApi(specFor("getFloat"), {})).rejects.toThrow(
      "canonical JSON cannot carry",
    );
  });

  test("refuses an input that is not an object", async () => {
    await expect(runOpenApi(specFor("getInvoice"), [])).rejects.toThrow(
      "The input must be a JSON object.",
    );
  });
});

describe("the runner serves an OpenAPI offer", () => {
  test("answers a job with the operation's JSON", async () => {
    const seller = viem.privateKeyToAccount(PRIVATE_KEY);
    const offer = openApiOffer({
      seller: seller.address,
      document: FIXTURE,
      operationId: "getInvoice",
      price: "1000",
      deadline: 120,
      rails: ["escrow"],
      now: NOW,
    });
    const offerHash = hashOffer(offer);
    const spec = specFor("getInvoice");

    let socket: ServerWebSocket<undefined> | null = null;
    const getSocket = (): ServerWebSocket<undefined> | null => socket;
    let resolveReply: (message: RunnerToHub) => void = () => undefined;
    const reply = new Promise<RunnerToHub>((resolve) => {
      resolveReply = resolve;
    });

    const hub: Server<undefined> = Bun.serve({
      port: 0,
      fetch(request, srv) {
        if (new URL(request.url).pathname === RUNNER_PATH) {
          if (srv.upgrade(request)) return;
          return new Response("upgrade failed", { status: 500 });
        }
        return new Response("not found", { status: 404 });
      },
      websocket: {
        open(ws) {
          socket = ws;
          ws.send(JSON.stringify({ t: "challenge", nonce: NONCE }));
        },
        message(ws, raw) {
          const text = typeof raw === "string" ? raw : raw.toString("utf8");
          const message = JSON.parse(text) as RunnerToHub;
          if (message.t === "hello") {
            ws.send(
              JSON.stringify({ t: "ready", seller: seller.address, offers: [offerHash] }),
            );
            return;
          }
          if (message.t === "result" || message.t === "fail") {
            resolveReply(message);
          }
        },
      },
    });

    const runner = startRunner({
      hubUrl: `http://127.0.0.1:${hub.port}`,
      account: seller,
      served: [{ offer, spec }],
      limits: { timeMs: 5000, maxOutputBytes: 100_000 },
      now: () => NOW,
    });

    try {
      await runner.ready;
      const order: JobOrder = {
        jobId: `0x${"ab".repeat(32)}`,
        offerHash,
        input: { id: "inv_1" },
        rail: "escrow",
        network: "eip155:5042002",
        buyer: BUYER,
        payTo: seller.address,
        asset: ASSET,
        amount: "1000",
        deadline: NOW + 60,
        escrow: ESCROW,
        chainId: 5042002,
        lineage: [],
      };
      const ws = getSocket();
      if (ws === null) throw new Error("the hub is not connected");
      ws.send(JSON.stringify({ t: "job", order }));

      const message = await Promise.race([
        reply,
        new Promise<never>((_resolve, reject) => {
          setTimeout(() => reject(new Error("the runner did not answer")), 10_000);
        }),
      ]);
      if (message.t !== "result") throw new Error(`expected result, got ${message.t}`);
      expect(message.slip.body.offerHash).toBe(offerHash);
      expect(message.slip.body.inputHash).toBe(canonicalHash(order.input));
      expect(message.slip.body.outputHash).toBe(canonicalHash(message.output));
      expect((message.output as { result?: unknown }).result).toEqual(INVOICE);
    } finally {
      runner.stop();
      await hub.stop(true);
    }
  });
});

describe("--openapi parsing", () => {
  test("pairs each --openapi with the next --operation and its --base-url", () => {
    const options = parseOptions([
      "--hub",
      "http://127.0.0.1:1",
      "--openapi",
      "one.json",
      "--operation",
      "getInvoice",
      "--openapi",
      "two.json",
      "--operation",
      "createInvoice",
      "--base-url",
      "http://127.0.0.1:2",
      "--price",
      "1000",
    ]);
    expect(options.openapis).toEqual([
      { specPath: "one.json", operationId: "getInvoice" },
      {
        specPath: "two.json",
        operationId: "createInvoice",
        baseUrl: "http://127.0.0.1:2",
      },
    ]);
  });

  test("refuses an --openapi without an --operation", () => {
    expect(() =>
      parseOptions(["--hub", "http://127.0.0.1:1", "--openapi", "one.json", "--price", "1000"]),
    ).toThrow("Each --openapi needs a matching --operation.");
  });
});
