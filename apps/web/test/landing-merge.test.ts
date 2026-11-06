import { afterEach, describe, expect, test } from "bun:test";
import { glyphLoopRuns, glyphTeal, reducesMotion } from "../src/routes/home/GlyphField.tsx";

// STEER-0355 (the merge with Rajdeep's landing): reduced motion starts no glyph animation loop, the glyphs
// take the teal of tokens.css per theme, and the landing keeps native scroll and production's fonts.

const realWindow = (globalThis as { window?: unknown }).window;
afterEach(() => {
  (globalThis as { window?: unknown }).window = realWindow;
});
const withMotion = (reduce: boolean) => {
  (globalThis as { window?: unknown }).window = { matchMedia: (q: string) => ({ matches: reduce && q.includes("reduce") }) };
};
const read = (rel: string) => Bun.file(new URL(rel, import.meta.url).pathname).text();

describe("reduced motion starts no glyph or diagram animation loop", () => {
  test("under prefers-reduced-motion the glyph field never runs, even when asked to", () => {
    withMotion(true);
    expect(reducesMotion()).toBe(true);
    expect(glyphLoopRuns(true)).toBe(false);
    expect(glyphLoopRuns(false)).toBe(false);
  });
  test("with motion allowed it runs only when asked to (on screen, tab visible)", () => {
    withMotion(false);
    expect(glyphLoopRuns(true)).toBe(true);
    expect(glyphLoopRuns(false)).toBe(false);
  });
  test("the field neither listens to the pointer nor requests a frame when it is still", async () => {
    const src = await read("../src/routes/home/GlyphField.tsx");
    expect(src).toContain("const host = still ? null : target.current;");
    expect(src).toContain("if (runRef.current && !still) raf = requestAnimationFrame(frame);");
  });
  test("under reduced motion the Journey does not pin: each beat is its own still section", async () => {
    const index = await read("../src/routes/home/index.tsx");
    expect(index).toContain("pinned={!reduced}");
  });
});

describe("the hero's settled total is named for what it holds", () => {
  test("any USDT on Whitechain makes it 'Settled (USDC + USDT)'; USDC alone stays 'USDC settled'", async () => {
    const { settledLabel } = await import("../src/routes/home/Hero.tsx");
    const base = { offers: { listed: 1, delisted: 0 }, sellers: 1, buyers: 1, calls: 1, delivered: 1, failed: 0, refunded: 0, closed: 1, volume: "1490000", asOf: 0, runnersOnline: 1 };
    expect(settledLabel({ ...base, byRail: { escrow: { calls: 1, delivered: 1, volume: "1440000" }, whitechain: { calls: 1, delivered: 1, volume: "50000" } } })).toBe("Settled (USDC + USDT)");
    expect(settledLabel({ ...base, byRail: { escrow: { calls: 1, delivered: 1, volume: "1490000" } } })).toBe("USDC settled");
  });
});

describe("the endless animations rest off screen", () => {
  test("the hero and the diagram mark themselves still when unseen, and CSS pauses both", async () => {
    const hero = await read("../src/routes/home/Hero.tsx");
    const journey = await read("../src/routes/home/Journey.tsx");
    const css = await read("../src/routes/home/landing.css");
    expect(hero).toContain('data-still={visible && !reduced ? undefined : ""}');
    expect(journey).toContain("resting={!onView}");
    expect(journey).toContain('data-still={resting ? "" : undefined}');
    expect(css).toContain(".hero[data-still] .hero__down svg,\n.diagram[data-still] .diagram__dot-ring {\n  animation-play-state: paused;");
  });
});

describe("the merge keeps production's look rules", () => {
  test("the glyphs take the tokens' teal: neon on dark, deep on light", () => {
    expect(glyphTeal(false)).toEqual([0, 236, 203]);
    expect(glyphTeal(true)).toEqual([0, 109, 105]);
  });
  test("body and UI stay on the system stack; headings use Countersign Display; no Plus Jakarta Sans or other new face", async () => {
    const tokens = await read("../src/styles/tokens.css");
    const base = await read("../src/styles/base.css");
    const display = await read("../src/styles/display.css");
    const html = await read("../index.html");
    expect(tokens).toContain('--sans: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;');
    expect(tokens).toContain("--display: var(--sans);");
    expect(tokens).toContain('--display-face: "Countersign Display", ui-sans-serif, system-ui, sans-serif;');
    expect(base).toContain('@import "./display.css";');
    // The only face display.css declares is the house face, from the files main already ships.
    expect([...display.matchAll(/font-family: "([^"]+)"/g)].map((m) => m[1])).toEqual(["Countersign Display", "Countersign Display", "Countersign Display", "Countersign Display"]);
    for (const text of [tokens, base, display, html]) expect(text).not.toMatch(/jakarta|gordita/i);
  });
  test("native scroll only: the stage reads scroll with a passive listener and a frame, never a wheel handler", async () => {
    const stage = await read("../src/routes/home/stage.ts");
    expect(stage).toContain('window.addEventListener("scroll", schedule, { passive: true });');
    expect(stage).not.toMatch(/addEventListener\("wheel"|preventDefault\(\)/);
  });
  test("no glow and no text-shadow on the teal", async () => {
    const tokens = await read("../src/styles/tokens.css");
    expect(tokens).not.toMatch(/text-shadow|drop-shadow/);
  });
});
