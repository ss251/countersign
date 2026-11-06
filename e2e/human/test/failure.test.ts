import { describe, expect, test } from "bun:test";
import { raiseIfFailed } from "../lib/failure.ts";

function caught(call: () => void): unknown {
  try {
    call();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("the failure flag", () => {
  test("a falsy thrown value still fails", () => {
    const empty = caught(() => raiseIfFailed(true, ""));
    expect(empty).toBeInstanceOf(Error);
    expect((empty as Error).message).toBe("");

    const zero = caught(() => raiseIfFailed(true, 0));
    expect(zero).toBeInstanceOf(Error);
    expect((zero as Error).message).toBe("0");
  });

  test("a captured Error keeps its identity", () => {
    const original = new Error("refused");
    expect(caught(() => raiseIfFailed(true, original))).toBe(original);
  });

  test("no captured failure does not throw", () => {
    expect(() => raiseIfFailed(false, "")).not.toThrow();
  });
});
