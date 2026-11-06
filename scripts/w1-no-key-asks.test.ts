import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// cs-w1 policy test (firstmate STEER 21:13:22Z, the captain's principle): nobody pastes a private key into
// a countersign CLI. No user-facing string may ask for or mention one: not the npm READMEs, not
// docs/onboarding.md or the README, not --help text, not an error message. The CS_*_KEY env override may stay
// in code for our own CI, unmentioned: reading process.env is code, not a string, and is not flagged.
// A hit here is a blocker on the PR that carries it.

const ROOT = join(import.meta.dir, "..");
const ASKS = /CS_(?:BUYER|SELLER)_KEY|private[ -]key|paste (?:a |your |the )?(?:private )?key|export (?:a |your |the )?(?:private )?key/i;

const DOCS = [
  "README.md",
  "docs/onboarding.md",
  "packages/cli/README.md",
  "packages/mcp/README.md",
  "packages/relay/README.md",
];

/** Source trees whose strings reach a user of the CLI or the MCP server (usage, errors, prompts, tool results). */
const SOURCES = ["packages/cli/src", "packages/mcp/src", "packages/buyer/src", "packages/runner/src"];

function files(path: string): string[] {
  const full = join(ROOT, path);
  if (!existsSync(full)) return [];
  if (statSync(full).isFile()) return [full];
  return readdirSync(full, { recursive: true })
    .map((name) => join(full, String(name)))
    .filter((file) => /\.(ts|tsx|js|mjs)$/.test(file) && !/\/test\//.test(file) && statSync(file).isFile());
}

/** Every string and template literal in a source file, with the line it starts on. */
function literals(text: string): Array<{ line: number; value: string }> {
  const out: Array<{ line: number; value: string }> = [];
  const pattern = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
  for (const match of text.matchAll(pattern)) {
    const line = text.slice(0, match.index ?? 0).split("\n").length;
    out.push({ line, value: match[0] });
  }
  return out;
}

describe("W1: no user-facing string asks for a private key", () => {
  test("the READMEs and the onboarding doc never mention CS_*_KEY, a private key, or pasting or exporting one", () => {
    const hits: string[] = [];
    for (const doc of DOCS) {
      const full = join(ROOT, doc);
      if (!existsSync(full)) continue;
      readFileSync(full, "utf8")
        .split("\n")
        .forEach((text, index) => {
          if (ASKS.test(text)) hits.push(`${doc}:${index + 1}: ${text.trim().slice(0, 140)}`);
        });
    }
    expect(hits).toEqual([]);
  });

  test("no --help text, error or message string in the CLI, MCP, buyer or runner CLI mentions one", () => {
    const hits: string[] = [];
    for (const root of SOURCES) {
      for (const file of files(root)) {
        for (const { line, value } of literals(readFileSync(file, "utf8"))) {
          if (ASKS.test(value)) hits.push(`${relative(ROOT, file)}:${line}: ${value.replace(/\s+/g, " ").slice(0, 140)}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });
});
