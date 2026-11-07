import { describe, expect, test } from "bun:test";
import { scrubBuildPaths } from "../scrub.ts";

const ROOT = "/Users/someone/Developer/worktrees/k3-main";

describe("scrubBuildPaths", () => {
  test("rewrites a baked __dirname under node_modules to the part below the root", () => {
    const source = `var __dirname = "${ROOT}/node_modules/thread-stream";\nvar x = 1;`;
    const result = scrubBuildPaths(source, ROOT);
    expect(result.count).toBe(1);
    expect(result.source).toBe(`var __dirname = "/node_modules/thread-stream";\nvar x = 1;`);
    expect(result.source).not.toContain("someone");
  });

  test("rewrites __filename too, and every occurrence", () => {
    const source =
      `var __filename = "${ROOT}/node_modules/a/index.js";\n` +
      `var __dirname = "${ROOT}/node_modules/a";\n` +
      `var __dirname = "${ROOT}/node_modules/@scope/b/lib";`;
    const result = scrubBuildPaths(source, ROOT);
    expect(result.count).toBe(3);
    expect(result.source).not.toContain(ROOT);
  });

  test("leaves every other use of the root alone, so the leak check still fails on it", () => {
    const cases = [
      `var dir = "${ROOT}/node_modules/a";`,
      `var __dirname = "${ROOT}/packages/cli/src";`,
      `console.log("${ROOT}");`,
      `var __dirname = "${ROOT}";`,
    ];
    for (const source of cases) {
      const result = scrubBuildPaths(source, ROOT);
      expect(result.count).toBe(0);
      expect(result.source).toBe(source);
    }
  });

  test("a different root or an empty root changes nothing", () => {
    const source = `var __dirname = "${ROOT}/node_modules/a";`;
    expect(scrubBuildPaths(source, "/elsewhere").count).toBe(0);
    expect(scrubBuildPaths(source, "").count).toBe(0);
  });

  test("a root with regex characters is matched literally", () => {
    const root = "/Users/a.b+c/repo";
    const result = scrubBuildPaths(`var __dirname = "${root}/node_modules/x";`, root);
    expect(result.count).toBe(1);
    expect(scrubBuildPaths(`var __dirname = "/Users/aXb+c/repo/node_modules/x";`, root).count).toBe(0);
  });
});
