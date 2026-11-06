/**
 * Canonical JSON: the one byte string every party hashes and signs.
 *
 * Rules (a strict subset of RFC 8785):
 * - object keys sorted by UTF-16 code units, no whitespace anywhere;
 * - strings escaped exactly as JSON.stringify does;
 * - numbers must be safe integers (amounts travel as digit strings, never numbers);
 * - undefined object members are dropped; undefined, functions, symbols, bigints,
 *   NaN and Infinity anywhere else are errors, not silent coercions.
 */

import { keccak256, toBytes, type Hex } from "viem";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export class CanonicalError extends Error {
  override name = "CanonicalError";
}

export function canonicalJson(value: unknown): string {
  return write(value, "$");
}

/** keccak256 over the UTF-8 bytes of the canonical form. */
export function canonicalHash(value: unknown): Hex {
  return keccak256(toBytes(canonicalJson(value)));
}

function write(value: unknown, path: string): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return JSON.stringify(value);
    case "number":
      if (!Number.isSafeInteger(value)) {
        throw new CanonicalError(`${path}: only safe integers are canonical, got ${value}`);
      }
      return Object.is(value, -0) ? "0" : String(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((item, i) => write(item, `${path}[${i}]`)).join(",")}]`;
      }
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        throw new CanonicalError(`${path}: only plain objects are canonical`);
      }
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record)
        .filter((k) => record[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${write(record[k], `${path}.${k}`)}`).join(",")}}`;
    }
    default:
      throw new CanonicalError(`${path}: ${typeof value} is not canonical JSON`);
  }
}
