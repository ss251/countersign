/**
 * The merchant screen's "integrate this in twenty lines" block shows the code the console's own
 * checkout runs, and cannot drift from it: this file fails whenever the generated module differs
 * from a fresh generation out of examples/whitechain (STEER-2210 amendment).
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lineCount, SNIPPET_LINES } from "../src/routes/merchant/Integrate.tsx";
import { CUSTOMER_SNIPPET, MERCHANT_SNIPPET, SNIPPET_PATHS } from "../src/routes/merchant/snippet.generated.ts";
import { SNIPPET_FILES, snippetModule } from "./merchant-snippet-gen.ts";

const root = join(import.meta.dir, "..", "..", "..");

describe("the integration block is the code the checkout runs", () => {
  test("the generated module is exactly what the generator writes today (run it if this fails)", () => {
    const committed = readFileSync(join(root, "apps/web/src/routes/merchant/snippet.generated.ts"), "utf8");
    expect(committed).toBe(snippetModule());
  });

  test("each shown snippet is byte for byte the file the console imports", () => {
    expect(SNIPPET_PATHS).toEqual(SNIPPET_FILES);
    expect(MERCHANT_SNIPPET).toBe(readFileSync(join(root, SNIPPET_FILES.merchant), "utf8"));
    expect(CUSTOMER_SNIPPET).toBe(readFileSync(join(root, SNIPPET_FILES.customer), "utf8"));
  });

  test("the integration is twenty lines or fewer, counted as a reader counts them", () => {
    expect(lineCount("a\nb\n")).toBe(2);
    expect(SNIPPET_LINES).toBe(lineCount(MERCHANT_SNIPPET) + lineCount(CUSTOMER_SNIPPET));
    expect(SNIPPET_LINES).toBeLessThanOrEqual(20);
  });
});
