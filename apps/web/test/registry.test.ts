import { describe, expect, test } from "bun:test";
import * as fx from "../src/fixtures/index.ts";
import type { Listing } from "../src/lib/types.ts";
import { deliveryRate, groupBySeller, matches } from "../src/routes/registry/index.tsx";

const listings = fx.listings;

describe("registry", () => {
  test("groups every offer under its seller, busiest seller first", () => {
    const groups = groupBySeller(listings);
    expect(groups.reduce((n, g) => n + g.offers.length, 0)).toBe(listings.length);
    expect(new Set(groups.map((g) => g.address)).size).toBe(groups.length);
    for (let i = 1; i < groups.length; i++) expect(groups[i - 1]!.released).toBeGreaterThanOrEqual(groups[i]!.released);
  });

  test("puts delisted offers last within a seller", () => {
    const [first] = listings;
    const delisted: Listing = { ...first!, hash: "0xdead" as Listing["hash"], status: "delisted", offer: { ...first!.offer, title: "aaa" } };
    const g = groupBySeller([delisted, first!]).find((x) => x.address === first!.offer.seller.toLowerCase())!;
    expect(g.offers.at(-1)!.status).toBe("delisted");
  });

  test("filters by text, adapter and rail, and can match nothing", () => {
    expect(listings.filter((l) => matches(l, "ARC", "all", "all")).length).toBeGreaterThan(0);
    expect(listings.filter((l) => matches(l, "", "mcp", "all")).every((l) => l.offer.adapter === "mcp")).toBe(true);
    expect(listings.filter((l) => matches(l, "", "all", "hedera")).every((l) => l.offer.rails.includes("hedera"))).toBe(true);
    expect(listings.filter((l) => matches(l, "no such offer anywhere", "all", "all"))).toEqual([]);
  });

  test("delivery rate is a dash before any call, never 0%", () => {
    expect(deliveryRate(0, 0)).toBe("—");
    expect(deliveryRate(41, 1)).toBe("98%");
    expect(deliveryRate(0, 2)).toBe("0%");
  });
});
