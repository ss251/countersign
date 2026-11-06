import { describe, expect, test } from "bun:test";
import { PUBLISH_SCOPE, publishedName, tarballPrefix } from "../published.ts";

describe("published names", () => {
  test("the scope lives in one constant", () => {
    expect(PUBLISH_SCOPE).toBe("@countersign-hub");
    expect(publishedName("relay")).toBe("@countersign-hub/relay");
  });

  test("another scope changes every generated name", () => {
    expect(publishedName("cli", "@another")).toBe("@another/cli");
  });

  test("the tarball prefix follows npm's scoped naming", () => {
    expect(tarballPrefix("mcp")).toBe("countersign-hub-mcp");
  });
});
