import { afterAll, describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import * as router from "../src/app/router.tsx";

const REPO = "https://github.com/ss251/countersign";
const SENTENCE =
  "countersign lets an AI agent pay for tools only inside limits you sign, and every payment leaves a slip anyone can check without us.";

// Bun cannot run Vite's import.meta.glob in routes.ts, so read the real view list from its source.
const routesSource = await Bun.file(new URL("../src/app/routes.ts", import.meta.url)).text();
const VIEWS = [...routesSource.matchAll(/\{ name: "([^"]+)", label: "([^"]+)", ready: true \}/g)].map((m) => ({
  name: m[1]!,
  label: m[2]!,
}));

globalThis.window = {
  location: { hash: "#/registry" },
  addEventListener() {},
  removeEventListener() {},
} as unknown as Window & typeof globalThis;

// renderToString reads useSyncExternalStore's server snapshot, which is "/"; pin the location a client would see.
mock.module("../src/app/router.tsx", () => ({
  ...router,
  useLocation: () => router.parseLocation("/registry"),
}));
// The same shape as buyer-shell.test.ts's mock: one process shares one module registry, so every mock of routes.ts carries both.
mock.module("../src/app/routes.ts", () => ({ VIEWS, hasRoute: () => false }));

const { SiteLinks } = await import("../src/app/SiteLinks.tsx");
const { SiteFooter } = await import("../src/app/SiteFooter.tsx");

function anchors(html: string) {
  return [...html.matchAll(/<a\s[^>]*>([^<]*)<\/a>/g)].map((m) => ({ tag: m[0], text: m[1]! }));
}

describe("the site's views", () => {
  test("every view renders in order, then GitHub, and only Registry is current", () => {
    const html = renderToString(createElement(SiteLinks, { className: "landing__link" }));
    const links = anchors(html);

    expect(VIEWS).toHaveLength(6);
    expect(links.map((a) => a.text)).toEqual([...VIEWS.map((v) => v.label), "GitHub"]);
    expect(links.map((a) => a.tag.includes('aria-current="page"'))).toEqual([
      false,
      false,
      false,
      false,
      true,
      false,
      false,
    ]);

    VIEWS.forEach((v, i) => expect(links[i]!.tag).toContain(`href="#/${v.name}"`));
    expect(links[6]!.tag).toContain(`href="${REPO}"`);
    expect(links[6]!.tag).toContain('target="_blank"');
    expect(links[6]!.tag).toContain('rel="noreferrer"');
  });

  test("the footer says what countersign is in one sentence", () => {
    const html = renderToString(createElement(SiteFooter));
    const match = html.match(/^<footer class="site-foot"><p class="site-foot__what">([^<]*)<\/p><\/footer>$/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe(SENTENCE);
  });
});

afterAll(() => {
  mock.restore();
  delete (globalThis as { window?: unknown }).window;
});
