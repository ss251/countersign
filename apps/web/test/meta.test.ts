import { describe, expect, test } from "bun:test";

// STEER-2225 fix 1: a custom domain is one build value, not a hunt through hard-coded hosts; and the link
// previews claim no more than every rail does (STEER-2120).
const html = await Bun.file(new URL("../index.html", import.meta.url)).text();
const config = await Bun.file(new URL("../vite.config.ts", import.meta.url)).text();

describe("the console's link previews", () => {
  test("the preview image's origin is a build value with today's host as the default", () => {
    // The reviewed social card (STEER-0115): og.png stays in public/, unreferenced.
    expect(html).toContain('<meta property="og:image" content="%VITE_PUBLIC_ORIGIN%/media/og.jpg" />');
    expect(html).toContain('<meta name="twitter:image" content="%VITE_PUBLIC_ORIGIN%/media/og.jpg" />');
    expect(html).not.toContain("og.png");
    expect(html).not.toMatch(/up\.railway\.app/);
    expect(config).toContain('process.env.VITE_PUBLIC_ORIGIN ??= "https://web-production-a58de.up.railway.app"');
  });

  test("the descriptions promise no escrow on rails that have none, and a slip only for a settled call", () => {
    for (const m of html.matchAll(/<meta (?:name="description"|property="og:description") content="([^"]+)"/g)) {
      expect(m[1]).not.toMatch(/escrow until|every call provable/i);
      expect(m[1]).toMatch(/settled call/);
    }
  });
});
