/**
 * The merchant screen's "integrate this in twenty lines" block shows the code the console's own
 * checkout runs, and cannot drift from it: this file fails whenever the generated module differs
 * from a fresh generation out of examples/whitechain (STEER-2210 amendment).
 *
 * The one difference allowed is the import names: the workspace's @countersign/* scope is another
 * project's on npm, so each import is shown under the name the v0.1.0 release publishes.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lineCount, SNIPPET_LINES } from "../src/routes/merchant/Integrate.tsx";
import { CUSTOMER_SNIPPET, MERCHANT_SNIPPET, SNIPPET_PATHS } from "../src/routes/merchant/snippet.generated.ts";
import { displayedSource, PUBLISHED_SPECIFIERS, SNIPPET_FILES, snippetModule, workspaceSource } from "./merchant-snippet-gen.ts";

const root = join(import.meta.dir, "..", "..", "..");
const source = (file: string) => readFileSync(join(root, file), "utf8");

/** What K3's release publishes of the relay (scripts/release/surface.ts on PR #253). */
const PUBLISHED_RELAY = ["@countersign-hub/relay/paywall", "@countersign-hub/relay/pay-fetch", "@countersign-hub/relay/browser"];

describe("the integration block is the code the checkout runs", () => {
  test("the generated module is exactly what the generator writes today (run it if this fails)", () => {
    const committed = readFileSync(join(root, "apps/web/src/routes/merchant/snippet.generated.ts"), "utf8");
    expect(committed).toBe(snippetModule());
  });

  test("each shown snippet is the file the console imports, with only its import names changed", () => {
    expect(SNIPPET_PATHS).toEqual(SNIPPET_FILES);
    expect(MERCHANT_SNIPPET).toBe(displayedSource(source(SNIPPET_FILES.merchant), SNIPPET_FILES.merchant));
    expect(CUSTOMER_SNIPPET).toBe(displayedSource(source(SNIPPET_FILES.customer), SNIPPET_FILES.customer));
    // Undo the names and the running file comes back byte for byte.
    expect(workspaceSource(MERCHANT_SNIPPET)).toBe(source(SNIPPET_FILES.merchant));
    expect(workspaceSource(CUSTOMER_SNIPPET)).toBe(source(SNIPPET_FILES.customer));
  });

  test("nothing shown would install another project's package", () => {
    for (const shown of [MERCHANT_SNIPPET, CUSTOMER_SNIPPET]) {
      expect(shown).not.toMatch(/["']@countersign\//);
      const specifiers = [...shown.matchAll(/["'](@countersign-hub\/[^"']+)["']/g)].map((match) => match[1] ?? "");
      expect(specifiers.length).toBeGreaterThan(0);
      for (const specifier of specifiers) expect(PUBLISHED_RELAY).toContain(specifier);
    }
    for (const published of Object.values(PUBLISHED_SPECIFIERS)) expect(PUBLISHED_RELAY).toContain(published);
  });

  test("an import with no published name stops the generator instead of being shown as it is", () => {
    expect(() => displayedSource('import { x } from "@countersign/core";\n', "example.ts")).toThrow(/no published name/);
  });

  test("the integration is twenty lines or fewer, counted as a reader counts them", () => {
    expect(lineCount("a\nb\n")).toBe(2);
    expect(SNIPPET_LINES).toBe(lineCount(MERCHANT_SNIPPET) + lineCount(CUSTOMER_SNIPPET));
    expect(SNIPPET_LINES).toBeLessThanOrEqual(20);
  });
});
