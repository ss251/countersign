/**
 * 9 · Web routes. Every route at phone and desktop width, in both themes, with no console errors
 * and no clipped navigation.
 *
 * This needs a browser, and no browser runs on the build machine. The captain cut a headless browser
 * for these checks (STEER-1812): the firstmate's screenshot rounds at 390 and 1440, light and dark,
 * cover them. The flow stays written against a driver interface and reports NOT RUN (cut).
 */

import { check, equal, type Flow } from "../lib/flow.ts";

export interface PageReport {
  /** Console messages at level error, and uncaught exceptions. */
  consoleErrors: string[];
  /** True when any nav item is cut off or overflows the viewport. */
  navClipped: boolean;
  /** True when the page scrolls sideways. */
  horizontalScroll: boolean;
  screenshot?: string;
}

export interface WebDriver {
  open(url: string, viewport: { width: number; height: number }, scheme: "light" | "dark"): Promise<PageReport>;
  close(): Promise<void>;
}

export const WEB_ROUTES = ["/", "/buyer", "/assistant", "/seller", "/merchant", "/registry", "/verify"] as const;
export const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
] as const;
export const SCHEMES = ["light", "dark"] as const;

/** Supplied only when the captain approves a driver; none exists on the build machine. */
let driver: WebDriver | null = null;
export function useWebDriver(d: WebDriver): void {
  driver = d;
}

export const web: Flow = {
  name: "web",
  title: "Web routes at 390 and 1440, light and dark",
  owner: "cs-ui",
  network: "none",
  // Cut by the captain (STEER-1812): the firstmate's screenshot rounds cover the visual checks.
  notRun: () => (driver ? null : "cut: screenshot rounds cover it"),
  async run(ctx) {
    const d = driver;
    check(d, "no web driver");
    const base = process.env.E2E_WEB_URL;
    check(base, "E2E_WEB_URL names the console to load");
    for (const route of WEB_ROUTES) {
      for (const vp of VIEWPORTS) {
        for (const scheme of SCHEMES) {
          await ctx.step(`#${route} · ${vp.width} · ${scheme}`, async () => {
            const report = await d.open(`${base.replace(/\/+$/, "")}/#${route}`, vp, scheme);
            if (report.screenshot) ctx.note(`#${route} ${vp.width} ${scheme}: ${report.screenshot}`);
            equal(report.consoleErrors.length, 0, `console errors (${report.consoleErrors.slice(0, 3).join(" | ")})`);
            equal(report.navClipped, false, "nav clipped");
            equal(report.horizontalScroll, false, "page scrolls sideways");
          });
        }
      }
    }
    await d.close();
  },
};
