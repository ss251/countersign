import { describe, expect, test } from "bun:test";

// STEER-2225 fix 1: a custom domain is one build value, not a hunt through hard-coded hosts; and the link
// previews claim no more than every rail does (STEER-2120).
const html = await Bun.file(new URL("../index.html", import.meta.url)).text();
const config = await Bun.file(new URL("../vite.config.ts", import.meta.url)).text();

describe("the console's link previews", () => {
  test("the preview image's origin is a build value with today's host as the default", () => {
    expect(html).toContain('<meta property="og:image" content="%VITE_PUBLIC_ORIGIN%/og.png" />');
    expect(html).not.toMatch(/up\.railway\.app/);
    // Evidence line: the captain renamed the console's Railway host on 07 Nov (firstmate 01:35:48Z); the old
    // web-production-a58de host answers 404 "Application not found", so today's host is counter-sign.
    expect(config).toContain('process.env.VITE_PUBLIC_ORIGIN ??= "https://counter-sign.up.railway.app"');
    expect(config).not.toContain("web-production-a58de");
  });

  test("the descriptions promise no escrow on rails that have none, and a slip only for a settled call", () => {
    for (const m of html.matchAll(/<meta (?:name="description"|property="og:description") content="([^"]+)"/g)) {
      expect(m[1]).not.toMatch(/escrow until|every call provable/i);
      expect(m[1]).toMatch(/settled call/);
    }
  });
});
