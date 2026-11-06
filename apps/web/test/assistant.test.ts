import { describe, expect, test } from "bun:test";
import * as fx from "../src/fixtures/index.ts";
import { rank, terms } from "../src/routes/buyer/assistant.ts";

describe("assistant search", () => {
  test("drops filler words and duplicates", () => {
    expect(terms("I need to deploy a contract on Arc, deploy!")).toEqual(["deploy", "contract", "arc"]);
  });

  test("ranks a title match first and says why", () => {
    const [first] = rank(fx.listings, "help me build on arc");
    expect(first?.listing.offer.title).toBe("use-arc");
    expect(first?.why[0]).toContain("“arc”");
  });

  test("explains a description match", () => {
    const matches = rank(fx.listings, "bridge usdc between chains");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.some((m) => m.why.some((w) => w.startsWith("Its description mentions")))).toBe(true);
  });

  test("returns nothing rather than a guess", () => {
    expect(rank(fx.listings, "bake sourdough bread")).toEqual([]);
    expect(rank(fx.listings, "the and of")).toEqual([]);
  });

  test("never offers a delisted listing", () => {
    const delisted = fx.listings.map((l) => ({ ...l, status: "delisted" as const }));
    expect(rank(delisted, "arc")).toEqual([]);
  });
});
