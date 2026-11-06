import { describe, expect, test } from "bun:test";
import { checkSchema, fromBase64Json, SchemaError, assertSchema, slipBodyFor, toBase64Json, type JobOrder } from "../src/index.ts";

describe("headers", () => {
  test("base64 json round-trips unicode", () => {
    const v = { a: "refusé", n: 1, list: [true, null] };
    expect(fromBase64Json<typeof v>(toBase64Json(v))).toEqual(v);
  });
});

describe("schema gate", () => {
  const schema = { type: "object", properties: { q: { type: "string", maxLength: 5 } }, required: ["q"], additionalProperties: false };
  test("passes a matching value", () => {
    expect(checkSchema(schema, { q: "hi" })).toEqual({ ok: true });
  });
  test("names what failed", () => {
    const r = checkSchema(schema, { q: "too long" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toContain("/q");
    expect(checkSchema(schema, { q: "a", extra: 1 }).ok).toBe(false);
    expect(checkSchema(schema, {}).ok).toBe(false);
  });
  test("refuses a schema that does not compile", () => {
    expect(() => assertSchema({ type: "nonsense" })).toThrow(SchemaError);
  });
});

describe("slipBodyFor", () => {
  const order: JobOrder = {
    jobId: "0x01",
    offerHash: "0x02",
    input: { q: "x" },
    rail: "hedera",
    network: "hedera:testnet",
    buyer: "0.0.11",
    payTo: "0.0.12",
    asset: "0.0.429274",
    amount: "10000",
    deadline: 100,
    lineage: [],
  };
  test("omits the escrow domain off escrow rails", () => {
    const b = slipBodyFor(order, "0x3333333333333333333333333333333333333333", "0x0a", "0x0b", 50);
    expect("escrow" in b).toBe(false);
    expect(b.children).toEqual([]);
  });
  test("carries it on escrow rails", () => {
    const b = slipBodyFor(
      { ...order, rail: "escrow", escrow: "0x4444444444444444444444444444444444444444", chainId: 5042002 },
      "0x3333333333333333333333333333333333333333",
      "0x0a",
      "0x0b",
      50,
    );
    expect(b.chainId).toBe(5042002);
  });
});
