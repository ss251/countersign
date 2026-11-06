import { afterEach, describe, expect, test } from "bun:test";
import { glyphLoopRuns, reducesMotion } from "../src/routes/home/GlyphField.tsx";
import { settledLabel } from "../src/routes/home/Hero.tsx";
import type { HubStats } from "../src/lib/types.ts";

// The two #324 fixes on top of Rajdeep's merged landing (firstmate 23:17:14Z): the hero's total is named for
// what it holds, and reduced motion starts no glyph loop and no pointer listeners.

const realWindow = (globalThis as { window?: unknown }).window;
afterEach(() => {
  (globalThis as { window?: unknown }).window = realWindow;
});
const withMotion = (reduce: boolean) => {
  (globalThis as { window?: unknown }).window = { matchMedia: (q: string) => ({ matches: reduce && q.includes("reduce") }) };
};
const stats = (byRail: HubStats["byRail"]): HubStats => ({
  offers: { listed: 1, delisted: 0 },
  sellers: 1,
  buyers: 1,
  calls: 1,
  delivered: 1,
  failed: 0,
  refunded: 0,
  closed: 1,
  volume: "1490000",
  byRail,
  asOf: 0,
  runnersOnline: 1,
});

describe("the hero's settled total is named for what it holds", () => {
  test("any USDT on Whitechain makes it 'Settled (USDC + USDT)', as production /stats has today", () => {
    expect(settledLabel(stats({ escrow: { calls: 1, delivered: 1, volume: "1440000" }, whitechain: { calls: 1, delivered: 1, volume: "50000" } }))).toBe(
      "Settled (USDC + USDT)",
    );
  });
  test("USDC alone stays 'USDC settled', and a zero Whitechain volume changes nothing", () => {
    expect(settledLabel(stats({ escrow: { calls: 1, delivered: 1, volume: "1490000" } }))).toBe("USDC settled");
    expect(settledLabel(stats({ whitechain: { calls: 0, delivered: 0, volume: "0" } }))).toBe("USDC settled");
  });
});

describe("reduced motion starts no glyph loop and no pointer listeners", () => {
  test("under prefers-reduced-motion the field never runs, even when asked to", () => {
    withMotion(true);
    expect(reducesMotion()).toBe(true);
    expect(glyphLoopRuns(true)).toBe(false);
  });
  test("with motion allowed it runs only when asked to", () => {
    withMotion(false);
    expect(glyphLoopRuns(true)).toBe(true);
    expect(glyphLoopRuns(false)).toBe(false);
  });
  test("when still, the field neither listens to the pointer nor requests a frame", async () => {
    const src = await Bun.file(new URL("../src/routes/home/GlyphField.tsx", import.meta.url).pathname).text();
    expect(src).toContain("const host = still ? null : target.current;");
    expect(src).toContain("if (runRef.current && !still) raf = requestAnimationFrame(frame);");
    expect(src).toContain("runRef.current = glyphLoopRuns(running);");
  });
});
