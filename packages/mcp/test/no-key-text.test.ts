import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const FORBIDDEN = ["cs_buyer_key", "cs_seller_key", "private key"];
const cwd = join(import.meta.dir, "..");
const src = join(cwd, "src");

function literals(file: string): string[] {
  const tree = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      found.push(node.text);
    } else if (ts.isTemplateExpression(node)) {
      found.push(node.head.text);
      for (const span of node.templateSpans) found.push(span.literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

describe("no user-facing text asks for a key", () => {
  test("no string or template literal in the MCP sources names a key", () => {
    for (const name of readdirSync(src).filter((entry) => entry.endsWith(".ts"))) {
      for (const literal of literals(join(src, name))) {
        for (const needle of FORBIDDEN) {
          expect(`${name}: ${literal}`.toLowerCase()).not.toContain(needle);
        }
      }
    }
  });

  test("--help names none of them", async () => {
    const child = Bun.spawn(["bun", "src/cli.ts", "--help"], {
      cwd,
      env: { PATH: process.env.PATH ?? "" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(code).toBe(0);
    const output = `${stdout}\n${stderr}`.toLowerCase();
    for (const needle of FORBIDDEN) expect(output).not.toContain(needle);
  });
});
