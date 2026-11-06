/**
 * The OpenAPI adapter: serve one operation of a local OpenAPI 3 JSON document.
 *
 * The document is read with the JSON parser and local component schemas are
 * resolved by hand, so no YAML parser or OpenAPI library is needed.
 */

import { readFileSync } from "node:fs";
import { canonicalHash, type JsonSchema, type Offer, type RailId } from "@countersign/core";
import type { Address, Hex } from "./account.ts";

export interface OpenApiSpec {
  adapter: "openapi";
  specPath: string;
  operationId: string;
  baseUrl: string;
}

export interface OpenApiOperationRef {
  method: string;
  path: string;
  operation: Record<string, unknown>;
  document: Record<string, unknown>;
}

export interface OpenApiOutput {
  operationId: string;
  status: number;
  inputHash: Hex;
  result: unknown;
}

export interface OpenApiOfferArgs {
  seller: Address;
  document: string | OpenApiOperationRef | Record<string, unknown>;
  operationId: string;
  price: string;
  deadline: number;
  rails: RailId[];
  payTo?: Partial<Record<RailId, string>>;
  upstream?: { url: string; licence: string };
  /** The seller's ENS name on Sepolia; it must resolve to `seller`. */
  ens?: string | undefined;
  now: number;
}

type JsonObject = Record<string, unknown>;

const METHODS = ["get", "post", "put", "patch", "delete"] as const;
const PARAMETER_TYPES = new Set(["string", "integer", "number", "boolean"]);
const SCHEMA_REF = "#/components/schemas/";
const ONLY_LOCAL = "Refused. Only local component references are supported.";

/** Read the document and return the one operation that carries `operationId`. */
export function readOperation(specPath: string, operationId: string): OpenApiOperationRef {
  let document: unknown;
  try {
    document = JSON.parse(readFileSync(specPath, "utf8")) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("Refused. Only OpenAPI 3 JSON documents are supported.");
    }
    throw error;
  }
  if (!isRecord(document) || !isOpenApi3(document)) {
    throw new Error("Refused. Only OpenAPI 3 JSON documents are supported.");
  }
  return operationFromDocument(document, operationId);
}

function operationFromDocument(
  document: JsonObject,
  operationId: string,
): OpenApiOperationRef {
  const paths = document.paths;
  const matches: Array<{
    method: string;
    path: string;
    operation: JsonObject;
    pathItem: JsonObject;
  }> = [];

  if (isRecord(paths)) {
    for (const [path, pathItem] of Object.entries(paths)) {
      if (!isRecord(pathItem)) continue;
      for (const method of METHODS) {
        const operation = pathItem[method];
        if (isRecord(operation) && operation.operationId === operationId) {
          matches.push({ method, path, operation, pathItem });
        }
      }
    }
  }

  if (matches.length === 0) {
    throw new Error(`Refused. The OpenAPI document has no operation ${operationId}.`);
  }
  if (matches.length > 1) {
    throw new Error(`Refused. The OpenAPI document repeats operation ${operationId}.`);
  }

  const match = matches[0]!;
  const pathParameters = Array.isArray(match.pathItem.parameters) ? match.pathItem.parameters : [];
  const operationParameters = Array.isArray(match.operation.parameters)
    ? match.operation.parameters
    : [];
  const merged: JsonObject = {
    ...match.operation,
    parameters: [...pathParameters, ...operationParameters],
  };
  const operation = resolveRefs(merged, document, []) as JsonObject;
  validateOperation(operation);

  return { method: match.method, path: match.path, operation, document };
}

/** A document is OpenAPI 3 only when its `openapi` field says 3.x. */
function isOpenApi3(document: JsonObject): boolean {
  return typeof document.openapi === "string" && document.openapi.startsWith("3.");
}

function validateOperation(operation: JsonObject): void {
  for (const parameter of parametersOf(operation)) {
    if (parameter.in === "header" || parameter.in === "cookie") {
      throw new Error("Refused. Header and cookie parameters are not supported.");
    }
    if (parameter.in !== "path" && parameter.in !== "query") continue;
    const name = typeof parameter.name === "string" ? parameter.name : "";
    const schema = parameter.schema;
    if (!isRecord(schema) || !PARAMETER_TYPES.has(schema.type as string)) {
      throw new Error(
        `Refused. Parameter ${name} must be a string, number, integer or boolean.`,
      );
    }
  }

  if (operation.requestBody !== undefined) {
    const content = isRecord(operation.requestBody) ? operation.requestBody.content : undefined;
    const json = isRecord(content) ? content["application/json"] : undefined;
    if (!isRecord(json) || !isRecord(json.schema)) {
      throw new Error("Refused. The request body must be application/json.");
    }
  }
}

/** Resolve every local schema reference in `value`, refusing anything else. */
function resolveRefs(value: unknown, document: JsonObject, stack: string[]): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => resolveRefs(item, document, stack));
  }
  if (!isRecord(value)) return value;

  const ref = value.$ref;
  if (ref !== undefined) {
    if (typeof ref !== "string" || !ref.startsWith(SCHEMA_REF)) {
      throw new Error(ONLY_LOCAL);
    }
    const name = ref.slice(SCHEMA_REF.length);
    if (name === "" || name.includes("/")) throw new Error(ONLY_LOCAL);
    if (stack.includes(name)) {
      throw new Error("Refused. The OpenAPI document has a reference cycle.");
    }
    const components = document.components;
    const schemas = isRecord(components) ? components.schemas : undefined;
    const target = isRecord(schemas) ? schemas[name] : undefined;
    if (target === undefined) {
      throw new Error(`Refused. The OpenAPI document has no schema ${name}.`);
    }
    const resolved = resolveRefs(target, document, [...stack, name]);
    const siblings = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "$ref"));
    if (Object.keys(siblings).length === 0) return resolved;
    return {
      ...(isRecord(resolved) ? resolved : {}),
      ...(resolveRefs(siblings, document, stack) as JsonObject),
    };
  }

  const out: JsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = resolveRefs(item, document, stack);
  }
  return out;
}

/** The JSON Schema a buyer's input must match. */
export function openApiInputSchema(op: OpenApiOperationRef): JsonSchema {
  const properties: Record<string, unknown> = {};
  const required = new Set<string>();

  for (const parameter of parametersOf(op.operation)) {
    const name = String(parameter.name);
    properties[name] = parameter.schema ?? {};
    if (parameter.in === "path" || (parameter.in === "query" && parameter.required === true)) {
      required.add(name);
    }
  }

  const body = jsonBody(op.operation);
  if (body !== undefined) {
    properties.body = body.schema;
    if (body.required) required.add("body");
  }

  return {
    type: "object",
    properties,
    required: [...required],
    additionalProperties: false,
  };
}

/** The JSON Schema the adapter's output must match. */
export function openApiOutputSchema(op: OpenApiOperationRef): JsonSchema {
  const operationId = typeof op.operation.operationId === "string" ? op.operation.operationId : "";
  return {
    type: "object",
    required: ["operationId", "status", "inputHash", "result"],
    additionalProperties: false,
    properties: {
      operationId: { const: operationId },
      status: { type: "integer" },
      inputHash: { type: "string", pattern: "^0x[0-9a-f]{64}$" },
      result: responseSchema(op.operation),
    },
  };
}

/** Build the offer a seller publishes for one OpenAPI operation. */
export function openApiOffer(args: OpenApiOfferArgs): Offer {
  const op = operationRef(args.document, args.operationId);
  const summary = typeof op.operation.summary === "string" ? op.operation.summary : undefined;
  const description =
    typeof op.operation.description === "string" ? op.operation.description : undefined;

  const title = summary !== undefined && summary.trim() !== "" ? summary : args.operationId;
  const offer: Offer = {
    v: 1,
    seller: args.seller,
    title: title.slice(0, 120),
    summary: (description ?? summary ?? "").slice(0, 2000),
    adapter: "openapi",
    input: openApiInputSchema(op),
    output: openApiOutputSchema(op),
    price: args.price,
    deadline: args.deadline,
    bond: "0",
    rails: args.rails,
    issuedAt: args.now,
  };
  if (args.payTo !== undefined && Object.keys(args.payTo).length > 0) offer.payTo = args.payTo;
  if (args.upstream !== undefined) offer.upstream = args.upstream;
  if (args.ens !== undefined) offer.ens = args.ens;
  return offer;
}

/** The seller's `--base-url`, else the document's first server; it must be http(s). */
export function baseUrlFor(document: JsonObject, override?: string): string {
  const servers = document.servers;
  const server = Array.isArray(servers) ? servers[0] : undefined;
  const fromDocument = isRecord(server) && typeof server.url === "string" ? server.url : undefined;
  const raw = override ?? fromDocument;
  if (raw === undefined) {
    throw new Error("Refused. The OpenAPI document has no server URL.");
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Refused. The base URL must be http or https.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Refused. The base URL must be http or https.");
  }
  return raw;
}

/** Call the operation with the buyer's input and return the JSON answer. */
export async function runOpenApi(spec: OpenApiSpec, input: unknown): Promise<OpenApiOutput> {
  if (!isPlainObject(input)) {
    throw new Error("The input must be a JSON object.");
  }

  const op = readOperation(spec.specPath, spec.operationId);
  const url = operationUrl(spec.baseUrl, op, input);
  const headers: Record<string, string> = { accept: "application/json" };
  let body: string | undefined;
  if (jsonBody(op.operation) !== undefined && Object.hasOwn(input, "body")) {
    body = JSON.stringify(input.body);
    headers["content-type"] = "application/json";
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: op.method.toUpperCase(),
      headers,
      redirect: "error",
      ...(body === undefined ? {} : { body }),
    });
  } catch {
    throw new Error("Refused. The operation could not be reached.");
  }

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Refused. The operation answered ${response.status}.`);
  }
  if (response.status === 204) {
    return outputFor(spec.operationId, response.status, input, null);
  }

  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new Error("Refused. The operation could not be reached.");
  }
  if (text.trim() === "") {
    return outputFor(spec.operationId, response.status, input, null);
  }

  let result: unknown;
  try {
    result = JSON.parse(text) as unknown;
  } catch {
    throw new Error("Refused. The operation did not answer JSON.");
  }
  if (!canonicalNumbers(result)) {
    throw new Error("Refused. The response holds a number canonical JSON cannot carry.");
  }
  return outputFor(spec.operationId, response.status, input, result);
}

function operationRef(
  source: OpenApiOfferArgs["document"],
  operationId: string,
): OpenApiOperationRef {
  if (typeof source === "string") return readOperation(source, operationId);
  if (!isRecord(source)) {
    throw new Error("Refused. Only OpenAPI 3 JSON documents are supported.");
  }
  if (
    typeof source.method === "string" &&
    typeof source.path === "string" &&
    isRecord(source.operation) &&
    isRecord(source.document)
  ) {
    return source as unknown as OpenApiOperationRef;
  }
  if (!isOpenApi3(source)) {
    throw new Error("Refused. Only OpenAPI 3 JSON documents are supported.");
  }
  return operationFromDocument(source, operationId);
}

function operationUrl(baseUrl: string, op: OpenApiOperationRef, input: JsonObject): string {
  const base = baseUrl.replace(/\/+$/, "");
  const path = op.path.replace(/\{([^}]+)\}/g, (_match, name: string) =>
    encodePathValue(String(input[name])),
  );
  const url = new URL(`${base}${path.startsWith("/") ? path : `/${path}`}`);
  for (const parameter of parametersOf(op.operation)) {
    if (parameter.in !== "query") continue;
    const name = String(parameter.name);
    if (Object.hasOwn(input, name)) {
      url.searchParams.append(name, String(input[name]));
    }
  }
  return url.toString();
}

/** Percent-encode one path value, keeping dot-only segments from climbing the path. */
function encodePathValue(value: string): string {
  const encoded = encodeURIComponent(value);
  return encoded === "." || encoded === ".." ? encoded.replaceAll(".", "%2E") : encoded;
}

function outputFor(
  operationId: string,
  status: number,
  input: unknown,
  result: unknown,
): OpenApiOutput {
  return { operationId, status, inputHash: canonicalHash(input), result };
}

function parametersOf(operation: JsonObject): JsonObject[] {
  const parameters = operation.parameters;
  return Array.isArray(parameters) ? parameters.filter(isRecord) : [];
}

function jsonBody(
  operation: JsonObject,
): { schema: unknown; required: boolean } | undefined {
  const requestBody = operation.requestBody;
  if (!isRecord(requestBody)) return undefined;
  const content = requestBody.content;
  const json = isRecord(content) ? content["application/json"] : undefined;
  if (!isRecord(json) || json.schema === undefined) return undefined;
  return { schema: json.schema, required: requestBody.required === true };
}

function responseSchema(operation: JsonObject): unknown {
  const responses = operation.responses;
  if (!isRecord(responses)) return {};
  for (const status of ["200", "201"]) {
    const response = responses[status];
    if (!isRecord(response)) continue;
    const content = response.content;
    const json = isRecord(content) ? content["application/json"] : undefined;
    if (isRecord(json) && json.schema !== undefined) return json.schema;
  }
  return {};
}

function canonicalNumbers(value: unknown): boolean {
  if (typeof value === "number") return Number.isSafeInteger(value);
  if (Array.isArray(value)) return value.every(canonicalNumbers);
  if (isRecord(value)) return Object.values(value).every(canonicalNumbers);
  return true;
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlainObject(value: unknown): value is JsonObject {
  if (!isRecord(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}
