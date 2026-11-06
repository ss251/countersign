import { describe, expect, test } from "bun:test";
import { externalPatterns } from "../external.ts";

describe("the external list", () => {
  test("viem yields the package and its subpaths", () => {
    expect(externalPatterns(["viem"])).toEqual(["viem", "viem/*"]);
  });

  test("a scoped name yields both scoped forms", () => {
    expect(externalPatterns(["@scope/name"])).toEqual(["@scope/name", "@scope/name/*"]);
  });

  test("duplicates collapse and names sort", () => {
    expect(externalPatterns(["viem", "@scope/name", "viem"])).toEqual([
      "@scope/name",
      "@scope/name/*",
      "viem",
      "viem/*",
    ]);
  });

  test("workspace packages are never external", () => {
    expect(() => externalPatterns(["@countersign/core"])).toThrow(/inlined/);
  });
});
