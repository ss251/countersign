import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const FORBIDDEN = ["cs_buyer_key", "cs_seller_key", "private key", "seed phrase", "mnemonic"];
const root = join(import.meta.dir, "..", "..", "..");

const FILES = [
  "packages/buyer/src/hedera/signer.ts",
  "packages/buyer/src/hedera/hub-signer.ts",
  "packages/buyer/src/hedera/trust.ts",
  "packages/buyer/src/hedera/schedule.ts",
  "packages/buyer/src/payer.ts",
  "packages/buyer/src/buy.ts",
  "packages/buyer/src/cli.ts",
  "packages/cli/src/login.ts",
  "packages/cli/src/cli.ts",
  "packages/mcp/src/server.ts",
  "packages/mcp/src/main.ts",
];

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

describe("no user-facing text in the touched files asks for a key", () => {
  test("no string or template literal names one", () => {
    for (const name of FILES) {
      for (const literal of literals(join(root, name))) {
        for (const needle of FORBIDDEN) {
          expect(`${name}: ${literal}`.toLowerCase()).not.toContain(needle);
        }
      }
    }
  });
});
