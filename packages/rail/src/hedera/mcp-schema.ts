// The offer advertises only what the runner can serve: core's canonical JSON accepts safe
// integers, never fractions, so every number in a tool's input schema is offered as an integer.
import type { JsonSchema } from "@countersign/core";

export function offerInputSchema(toolSchema: unknown): JsonSchema {
  const offered = convert(toolSchema);
  if (!isRecord(offered)) throw new Error("the tool input schema is not an object");
  return offered;
}

function convert(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(convert);
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [name, entry] of Object.entries(value)) {
    if (name === "$schema") continue;
    out[name] = name === "type" ? convertType(entry) : convert(entry);
  }
  return out;
}

function convertType(value: unknown): unknown {
  if (value === "number") return "integer";
  if (!Array.isArray(value) || !value.includes("number")) return convert(value);
  const types: unknown[] = [];
  for (const entry of value) {
    const next = entry === "number" ? "integer" : convert(entry);
    if (!types.includes(next)) types.push(next);
  }
  return types;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
