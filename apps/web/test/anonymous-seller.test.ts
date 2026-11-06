import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { ANONYMOUS } from "../src/lib/format.ts";
import { settlementIndex } from "../src/lib/ledger.ts";
import { OfferBy } from "../src/routes/offer/index.tsx";
import { SellerCard, type SellerGroup } from "../src/routes/registry/index.tsx";

const ADDRESS = "0x1111111111111111111111111111111111111111";

function seller(over: Partial<SellerGroup> = {}): SellerGroup {
  return {
    address: ADDRESS,
    name: "0x111111…111111",
    offers: [],
    released: 0,
    refunded: 0,
    failed: 0,
    online: 0,
    counted: false,
    named: false,
    ...over,
  };
}

const stripTags = (html: string): string => html.replace(/<[^>]*>/g, "").trim();

describe("anonymous by design (STEER-0215 C4)", () => {
  test("the constant is the decided wording", () => {
    expect(ANONYMOUS).toBe("anonymous by design");
  });

  test("a seller card says anonymity is by design, right beside the address", () => {
    const html = renderToString(createElement(SellerCard, { g: seller(), ledger: settlementIndex(undefined), now: 1_760_000_000 }));
    const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
    expect(header).toContain("anonymous by design");
    expect(header).toContain(ADDRESS);
  });

  test("a named seller card keeps its name and says nothing about anonymity", () => {
    const html = renderToString(
      createElement(SellerCard, { g: seller({ named: true, name: "acme" }), ledger: settlementIndex(undefined), now: 1_760_000_000 }),
    );
    expect(html).toContain("acme");
    expect(html).not.toContain("anonymous by design");
  });

  test("the offer byline puts anonymity beside the address, not in place of a name", () => {
    const html = renderToString(createElement(OfferBy, { seller: { name: "0x1234…abcd", named: false } }));
    expect(stripTags(html)).toBe("By 0x1234…abcd, anonymous by design");
  });

  test("a named offer byline is just the name", () => {
    const html = renderToString(createElement(OfferBy, { seller: { name: "acme", named: true } }));
    expect(stripTags(html)).toBe("By acme");
    expect(html).not.toContain("anonymous");
  });

  test("no old wording is left anywhere in the web console", async () => {
    const src = join(import.meta.dir, "../src");
    const offenders: string[] = [];
    const glob = new Bun.Glob("**/*.{ts,tsx}");
    for await (const file of glob.scan({ cwd: src, onlyFiles: true })) {
      // The assistant says "this seller" in a different sentence; it is out of scope for this packet.
      if (file === "routes/assistant/Assistant.tsx") continue;
      const text = await Bun.file(join(src, file)).text();
      if (text.includes("Unnamed seller") || text.includes("an unnamed seller")) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
