import { isRecord } from "./json.ts";

/**
 * The staged Node floor: the source package's own `engines.node` when it
 * declares one, otherwise `>=20`.
 */
export function nodeEngine(manifest: Record<string, unknown>): string {
  const engines = manifest.engines;
  if (engines === undefined) return ">=20";
  if (!isRecord(engines)) throw new Error("package engines is not an object");
  const node = engines.node;
  if (node === undefined) return ">=20";
  if (typeof node !== "string" || node.trim().length === 0) {
    throw new Error("package engines.node is not a non-empty string");
  }
  return node;
}

/** The major version of a `>=N` Node floor, or null when it is not one. */
export function floorMajor(spec: unknown): number | null {
  if (typeof spec !== "string") return null;
  const match = /^\s*>=\s*(\d+)/.exec(spec);
  if (match === null) return null;
  const major = Number(match[1]);
  return Number.isSafeInteger(major) && major > 0 ? major : null;
}
