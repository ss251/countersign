import { describe, expect, test } from "bun:test";
import { floorMajor, nodeEngine } from "../engines.ts";

describe("the staged Node engine", () => {
  test("uses the source package's own engines.node", () => {
    expect(nodeEngine({ engines: { node: ">=22" } })).toBe(">=22");
  });

  test("defaults to >=20 when the source declares no Node engine", () => {
    expect(nodeEngine({})).toBe(">=20");
    expect(nodeEngine({ engines: {} })).toBe(">=20");
  });

  test("reads the major out of a >= floor", () => {
    expect(floorMajor(">=22")).toBe(22);
    expect(floorMajor(">=20")).toBe(20);
    expect(floorMajor(">= 22")).toBe(22);
    expect(floorMajor("^22")).toBeNull();
    expect(floorMajor(undefined)).toBeNull();
  });
});
