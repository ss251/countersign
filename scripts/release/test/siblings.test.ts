import { describe, expect, test } from "bun:test";
import { requiredSiblings, tarballShort, type Tarball } from "../siblings.ts";

const cli: Tarball = {
  name: "@countersign-hub/cli",
  file: "/release/countersign-hub-cli-0.1.0.tgz",
};
const mcp: Tarball = {
  name: "@countersign-hub/mcp",
  file: "/release/countersign-hub-mcp-0.1.0.tgz",
};

describe("smoke install siblings", () => {
  test("a staged sibling dependency joins the same install", () => {
    expect(
      requiredSiblings({
        dependencies: { "@countersign-hub/mcp": "^0.1.0", viem: "^2.57.16" },
        available: [cli, mcp],
      }),
    ).toEqual({ siblings: [mcp], missing: [] });
  });

  test("a staged sibling dependency with no tarball is missing", () => {
    expect(
      requiredSiblings({
        dependencies: { "@countersign-hub/mcp": "^0.1.0" },
        available: [cli],
      }),
    ).toEqual({ siblings: [], missing: ["@countersign-hub/mcp"] });
  });

  test("a tarball with no @countersign-hub dependency needs no siblings", () => {
    expect(
      requiredSiblings({
        dependencies: { viem: "^2.57.16" },
        available: [cli, mcp],
      }),
    ).toEqual({ siblings: [], missing: [] });
    expect(requiredSiblings({ dependencies: undefined, available: [cli, mcp] })).toEqual({
      siblings: [],
      missing: [],
    });
  });

  test("the short name drops the scope", () => {
    expect(tarballShort("@countersign-hub/cli")).toBe("cli");
    expect(tarballShort("cli")).toBe("cli");
  });
});
