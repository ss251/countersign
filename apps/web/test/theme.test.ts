import { describe, expect, test } from "bun:test";
import { PAPER, resolveTheme } from "../src/app/theme.ts";

const html = await Bun.file(new URL("../index.html", import.meta.url)).text();
const tokens = await Bun.file(new URL("../src/styles/tokens.css", import.meta.url)).text();

describe("the theme", () => {
  test("a ?theme= pin wins over the stored pick, which wins over the system", () => {
    expect(resolveTheme("light", "dark")).toBe("light");
    expect(resolveTheme("dark", "light")).toBe("dark");
    expect(resolveTheme(null, "light")).toBe("light");
    expect(resolveTheme("sepia", "dark")).toBe("dark");
    expect(resolveTheme(null, "system")).toBe("system");
  });

  test("the status bar colours are each theme's paper, in index.html and the tokens alike", () => {
    expect(html).toContain(`content="${PAPER.light}" media="(prefers-color-scheme: light)"`);
    expect(html).toContain(`content="${PAPER.dark}" media="(prefers-color-scheme: dark)"`);
    expect(tokens).toContain(`--paper: ${PAPER.light};`);
    expect(tokens).toContain(`--paper: ${PAPER.dark};`);
  });

  test("the stored pick is applied before first paint, from the same key the toggle writes", () => {
    expect(html).toMatch(/<script>[\s\S]*localStorage\.getItem\("countersign:theme"\)[\s\S]*<\/script>[\s\S]*<script type="module"/);
  });
});
