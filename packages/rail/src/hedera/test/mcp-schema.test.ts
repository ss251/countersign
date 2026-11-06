import { describe, expect, test } from "bun:test";
import { checkSchema } from "@countersign/core";
import { offerInputSchema } from "../mcp-schema.ts";

const TOOL_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  properties: {
    transfers: {
      minItems: 1,
      type: "array",
      items: {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object",
        properties: {
          accountId: { type: "string", description: "Recipient account ID (Required)" },
          amount: { type: "number", description: "Amount of HBAR to transfer (Required)" },
        },
        required: ["accountId", "amount"],
      },
      description: "Array of HBAR transfers to RECIPIENTS.",
    },
    isScheduled: { type: "boolean", default: false, description: "Schedule the transfer." },
    transactionMemo: { type: "string", description: "Memo to include." },
  },
  required: ["transfers"],
};

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("expected an object");
  }
  return value as Record<string, unknown>;
}

function amountSchema(offered: unknown): Record<string, unknown> {
  const properties = record(record(offered).properties);
  const transfers = record(properties.transfers);
  const items = record(transfers.items);
  return record(record(items.properties).amount);
}

describe("offerInputSchema", () => {
  test("offers every amount as an integer and drops $schema everywhere", () => {
    const offered = offerInputSchema(TOOL_SCHEMA);
    expect(amountSchema(offered).type).toBe("integer");
    expect(JSON.stringify(offered)).not.toContain("$schema");
    expect(amountSchema(TOOL_SCHEMA).type).toBe("number");
    expect(JSON.stringify(TOOL_SCHEMA)).toContain("$schema");
  });

  test("replaces number in a type array without duplicates", () => {
    const offered = offerInputSchema({
      type: "object",
      properties: {
        expiry: { type: ["number", "null"] },
        mixed: { type: ["number", "integer", "null"] },
        text: { type: ["string", "null"] },
      },
    });
    const properties = record(record(offered).properties);
    expect(record(properties.expiry).type).toEqual(["integer", "null"]);
    expect(record(properties.mixed).type).toEqual(["integer", "null"]);
    expect(record(properties.text).type).toEqual(["string", "null"]);
  });

  test("leaves strings, booleans, required and descriptions untouched", () => {
    const offered = offerInputSchema(TOOL_SCHEMA);
    const properties = record(record(offered).properties);
    const transfers = record(properties.transfers);
    const items = record(transfers.items);
    expect(record(items.properties).accountId).toEqual({
      type: "string",
      description: "Recipient account ID (Required)",
    });
    expect(properties.isScheduled).toEqual({
      type: "boolean",
      default: false,
      description: "Schedule the transfer.",
    });
    expect(items.required).toEqual(["accountId", "amount"]);
    expect(transfers.description).toBe("Array of HBAR transfers to RECIPIENTS.");
    expect(record(offered).required).toEqual(["transfers"]);
  });

  test("the hub gate accepts a whole amount and refuses a fraction", () => {
    const offered = offerInputSchema(TOOL_SCHEMA);
    expect(checkSchema(offered, { transfers: [{ accountId: "0.0.11337065", amount: 1 }] })).toEqual({
      ok: true,
    });
    expect(checkSchema(offered, { transfers: [{ accountId: "0.0.11337065", amount: 0.01 }] }).ok).toBe(
      false,
    );
  });
});
