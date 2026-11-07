import { describe, expect, test } from "bun:test";
import type { Offer } from "@countersign/core";
import { minimalInput, requiredInput } from "../flows/discovery.flow.ts";

const offer = (input: unknown) => ({ adapter: "skill", input }) as unknown as Offer;

describe("discovery: the unpaid call's input (run 303f, 7 Nov)", () => {
  test("a pre-#372 skill offer requires nothing, so the empty input stays the empty input", () => {
    const old = offer({ type: "object", properties: { question: { type: "string" }, section: { type: "string" } } });
    expect(requiredInput(old)).toEqual([]);
    expect(minimalInput(old)).toEqual({});
  });

  test("a #372-style skill offer requires question, so it gets a question", () => {
    const fresh = offer({ type: "object", properties: { question: { type: "string" } }, required: ["question"] });
    expect(requiredInput(fresh)).toEqual(["question"]);
    expect(Object.keys(minimalInput(fresh))).toEqual(["question"]);
    expect(typeof minimalInput(fresh).question).toBe("string");
  });

  test("each required property gets a value of its own type", () => {
    const typed = offer({
      type: "object",
      properties: { n: { type: "integer" }, b: { type: "boolean" }, a: { type: "array" }, o: { type: "object" }, s: {} },
      required: ["n", "b", "a", "o", "s"],
    });
    expect(minimalInput(typed)).toEqual({ n: 1, b: true, a: [], o: {}, s: "What does this tool do?" });
  });

  test("a schema without required, or with a malformed one, asks for nothing", () => {
    expect(requiredInput(offer(undefined))).toEqual([]);
    expect(requiredInput(offer({ required: "question" }))).toEqual([]);
    expect(requiredInput(offer({ required: ["question", 7] }))).toEqual(["question"]);
  });
});
