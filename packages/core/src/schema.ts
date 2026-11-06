/**
 * The input and output gates. An offer's schemas are JSON Schema 2020-12; a call whose input
 * fails is refused before payment, and an output that fails is a failed delivery, never released.
 */

import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import { canonicalJson } from "./canonical.ts";
import type { JsonSchema } from "./types.ts";

const ajv = new Ajv2020({ allErrors: false, strict: false, validateFormats: false });
const cache = new Map<string, ValidateFunction>();

export type SchemaCheck = { ok: true } | { ok: false; errors: string[] };

export class SchemaError extends Error {
  override name = "SchemaError";
}

function compiled(schema: JsonSchema): ValidateFunction {
  const key = canonicalJson(schema);
  let fn = cache.get(key);
  if (!fn) {
    try {
      fn = ajv.compile(schema);
    } catch (e) {
      throw new SchemaError(`schema does not compile: ${(e as Error).message}`);
    }
    cache.set(key, fn);
  }
  return fn;
}

/** Throws SchemaError if the schema itself is unusable; use it when publishing an offer. */
export function assertSchema(schema: JsonSchema): void {
  compiled(schema);
}

export function checkSchema(schema: JsonSchema, value: unknown): SchemaCheck {
  const fn = compiled(schema);
  if (fn(value)) return { ok: true };
  return {
    ok: false,
    errors: (fn.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? "is invalid"}`),
  };
}
