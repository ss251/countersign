import { describe, expect, test } from "bun:test";
import * as fx from "../src/fixtures/index.ts";
import type { Listing } from "../src/lib/types.ts";
import { deliveryRate, groupBySeller, matches, settlementIndex, withRecords } from "../src/routes/registry/index.tsx";

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

describe("registry with the hub's /sellers", () => {
  test("takes the hub's counts and ERC-8004 identity over what listings imply", () => {
    const groups = groupBySeller(listings);
    const target = groups[groups.length - 1]!;
    const merged = withRecords(groups, [
      {
        address: target.address,
        name: null,
        payees: {},
        offers: [],
        calls: 9,
        released: 5,
        settled: 2,
        refunded: 1,
        failed: 1,
        volume: "350000",
        erc8004: { agentId: "42", identityRegistry: "0x0000000000000000000000000000000000008004", reputation: null },
      },
    ]);
    const g = merged.find((x) => x.address === target.address)!;
    expect(g.agentId).toBe("42");
    expect(g.released).toBe(7);
    expect(g.refunded).toBe(1);
    expect(g.failed).toBe(1);
    expect(g.name).toBe(target.name);
  });

  test("leaves groups alone when the hub does not serve /sellers", () => {
    const groups = groupBySeller(listings);
    expect(withRecords(groups, null)).toBe(groups);
  });
});

describe("registry: what a seller card reads from the settlements", () => {
  const row = (seller: string, offerHash: string, kind: "released" | "settled" | "refunded", at: number) => ({
    jobId: `0x${at.toString(16)}`,
    offerHash,
    title: "t",
    seller,
    amount: "10000",
    rail: "escrow" as const,
    network: "eip155:5042002",
    kind,
    tx: "0x1",
    at,
  });

  test("the newest settlement per seller and paid or refunded per offer, case-blind", () => {
    const idx = settlementIndex([row("0xAB", "0xO1", "released", 30), row("0xab", "0xo1", "refunded", 20), row("0xab", "0xO2", "settled", 10)]);
    expect(idx.known).toBe(true);
    expect(idx.lastBySeller.get("0xab")?.at).toBe(30);
    expect(idx.byOffer.get("0xo1")).toEqual({ paid: 1, refunded: 1 });
    expect(idx.byOffer.get("0xo2")).toEqual({ paid: 1, refunded: 0 });
  });

  test("a hub that does not list settlements is unknown, not empty", () => {
    expect(settlementIndex(null).known).toBe(false);
    expect(settlementIndex(undefined).known).toBe(false);
    expect(settlementIndex([]).known).toBe(true);
  });
});
