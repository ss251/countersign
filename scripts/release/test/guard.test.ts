import { describe, expect, test } from "bun:test";
import {
  findMappedSource,
  findNodeGuardViolations,
  findSourceWithText,
  formatGuardFailure,
} from "../guard.ts";

describe("the Node guard", () => {
  test("Bun.file fails", () => {
    const violations = findNodeGuardViolations("const bytes = await Bun.file(path).arrayBuffer();\n");
    expect(violations).toHaveLength(1);
    expect(violations[0]?.pattern).toBe("Bun.");
    expect(violations[0]?.text).toBe("Bun.");
  });

  test("import.meta.dir fails", () => {
    const violations = findNodeGuardViolations("const here = import.meta.dir;\n");
    expect(violations.map((violation) => violation.pattern)).toEqual(["import.meta.dir"]);
  });

  test("a bun: module specifier fails", () => {
    const violations = findNodeGuardViolations('import { Database } from "bun:sqlite";\n');
    expect(violations.map((violation) => violation.pattern)).toEqual(["bun:"]);
    expect(violations[0]?.text).toBe("bun:sqlite");
  });

  test("plain code passes", () => {
    expect(findNodeGuardViolations("export const answer = 42;\n")).toEqual([]);
  });

  test("a data string mentioning Bun.file passes", () => {
    expect(findNodeGuardViolations('const note = "run this with Bun.file()";\n')).toEqual([]);
  });

  test("a data string mentioning bun:sqlite passes", () => {
    expect(findNodeGuardViolations('const note = "bun:sqlite is not available here";\n')).toEqual(
      [],
    );
  });

  test("comments are ignored", () => {
    expect(findNodeGuardViolations("// Bun.file is not used here\nconst x = 1;\n")).toEqual([]);
  });

  test("the failure names the emitted file", () => {
    const violations = findNodeGuardViolations("const f = await Bun.file(p);\n");
    const message = formatGuardFailure("dist/index.js", violations);
    expect(message).toContain("dist/index.js");
    expect(message).toContain("Bun.");
  });

  test("a source map names the original file", () => {
    const map = JSON.stringify({
      version: 3,
      sources: ["../../packages/relay/src/ledger.ts"],
      sourcesContent: ['import { Database } from "bun:sqlite";\n'],
    });
    expect(findSourceWithText(map, "bun:sqlite", "bun:")).toBe(
      "../../packages/relay/src/ledger.ts",
    );
  });

  test("the mapping names the original file for an emitted position", () => {
    const map = JSON.stringify({
      version: 3,
      sources: ["../../packages/runner/src/child.ts"],
      names: [],
      mappings: "AAAA",
    });
    expect(findMappedSource(map, 1, 1)).toBe("../../packages/runner/src/child.ts");
  });
});
