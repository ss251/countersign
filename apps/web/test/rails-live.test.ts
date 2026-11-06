import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { RAIL_LABEL } from "../src/lib/format.ts";
import type { HubStats, RailDeclaration, RailId } from "../src/lib/types.ts";
import { Figures } from "../src/routes/home/Hero.tsx";
import { RailFilters } from "../src/routes/registry/index.tsx";
import { railGroups } from "../src/routes/registry/rails.ts";

const OFFER_RAILS: RailId[] = ["escrow", "gateway", "whitechain", "hedera", "hedera-scheduled"];
const HUB_RAILS: RailId[] = ["escrow", "whitechain", "hedera-scheduled"];

const DECLARED: RailId[] = ["escrow", "whitechain", "hedera-scheduled", "gateway", "hedera"];

function declaration(id: RailId): RailDeclaration {
  return {
    id,
    network: "eip155:5042002",
    scheme: "exact",
    asset: { network: "eip155:5042002", address: "0x3600000000000000000000000000000000000000", symbol: "USDC", decimals: 6 },
    kind: "direct",
    gasPaidBy: "hub",
    finality: "One Arc block.",
    explorerTx: "https://testnet.arcscan.app/tx/{tx}",
  };
}

function hubStats(delivered: number): HubStats {
  return {
    offers: { listed: 4, delisted: 0 },
    sellers: 2,
    buyers: 1,
    calls: delivered,
    delivered,
    failed: 0,
    refunded: 0,
    closed: delivered,
    volume: "1250000",
    byRail: {},
    asOf: 1_793_960_000,
    runnersOnline: 1,
  };
}

const textOf = (html: string) => html.replace(/<[^>]*>/g, "");

describe("railGroups: live is the hub's, listed is what only offers name", () => {
  test("groups the five offer rails by the hub's three", () => {
    expect(railGroups(OFFER_RAILS, HUB_RAILS)).toEqual({
      live: ["escrow", "whitechain", "hedera-scheduled"],
      listed: ["gateway", "hedera"],
    });
  });

  test("unknown hub rails group nothing", () => {
    expect(railGroups(OFFER_RAILS, undefined)).toBeNull();
  });

  test("an empty hub puts every rail in listed", () => {
    expect(railGroups(OFFER_RAILS, [])).toEqual({ live: [], listed: OFFER_RAILS });
  });

  test("a rail named twice appears once, in offer order", () => {
    expect(railGroups(["escrow", "escrow", "gateway", "escrow"], ["escrow"])).toEqual({
      live: ["escrow"],
      listed: ["gateway"],
    });
  });

  test("every hub rail is live even when no offer names it", () => {
    expect(railGroups(["escrow"], ["escrow", "whitechain", "hedera-scheduled"])).toEqual({
      live: ["escrow", "whitechain", "hedera-scheduled"],
      listed: [],
    });
  });

  test("a hub id that is not a rail is left out of live", () => {
    expect(railGroups(["escrow"], ["escrow", "not-a-rail"])).toEqual({ live: ["escrow"], listed: [] });
  });
});

describe("the hero and the Registry count the same live rails", () => {
  for (const k of [1, 3]) {
    test(`${k} hub rails are ${k} live in both places`, () => {
      const hubIds = DECLARED.slice(0, k);
      const groups = railGroups(OFFER_RAILS, hubIds);
      expect(groups?.live.length).toBe(k);
      const rails = hubIds.map(declaration);
      // The landing passes railsLive={hubRails?.length}: the hub's /rails, read at runtime (see the source check below).
      const html = renderToString(createElement(Figures, { stats: hubStats(7), missing: undefined, railsLive: rails.length }));
      expect(textOf(html)).toMatch(new RegExp(`Rails live\\s*${k}(?!\\d)`));
    });
  }
});

describe("the landing's hero number is the hub's /rails length", () => {
  for (const k of [1, 3, 5]) {
    test(`${k} declarations read "Rails live ${k}"`, () => {
      const rails = Array.from({ length: k }, (_, i) => declaration(DECLARED[i]!));
      const html = renderToString(createElement(Figures, { stats: hubStats(7), missing: undefined, railsLive: rails.length }));
      expect(textOf(html)).toMatch(new RegExp(`Rails live\\s*${k}(?!\\d)`));
    });
  }

  test("no hub rails means no live text at all", () => {
    const html = renderToString(createElement(Figures, { stats: hubStats(7), missing: undefined, railsLive: undefined }));
    expect(textOf(html)).not.toContain("Rails live");
  });

  test("the landing feeds the hero the hub's /rails length, never a count that includes retired rails", async () => {
    const index = await Bun.file(new URL("../src/routes/home/index.tsx", import.meta.url).pathname).text();
    expect(index).toContain('const hubRails = rails.source === "hub" ? rails.data : undefined;');
    expect(index).toContain("railsLive={hubRails?.length}");
    expect(index).not.toMatch(/railsLive=\{[^}]*railOrder/);
  });
});

describe("the Registry's rail row names the live rails and the listed-only ones", () => {
  const groups = railGroups(OFFER_RAILS, HUB_RAILS);

  test("live and listed-only labels, with every rail's name still a toggle", () => {
    const html = renderToString(
      createElement(RailFilters, { groups, flat: OFFER_RAILS, rail: "all", onRail: () => {}, count: () => 0 }),
    );
    expect(html).toContain("Live (3)");
    expect(html).toContain("Listed only (2)");
    for (const r of OFFER_RAILS) expect(html).toContain(RAIL_LABEL[r]);
  });

  test("a live rail with no offers still shows its toggle, with a zero count", () => {
    const html = renderToString(
      createElement(RailFilters, { groups: railGroups(["escrow"], HUB_RAILS), flat: ["escrow"], rail: "all", onRail: () => {}, count: () => 0 }),
    );
    expect(html).toContain("Live (3)");
    expect(html).not.toContain("Listed only");
    for (const r of HUB_RAILS) expect(html).toContain(RAIL_LABEL[r]);
    expect(html).toContain('<span class="toggle__n num">0</span>');
  });

  test("without the hub's rails there are no group labels, and every offer rail still shows", () => {
    const html = renderToString(
      createElement(RailFilters, { groups: null, flat: OFFER_RAILS, rail: "all", onRail: () => {}, count: () => 0 }),
    );
    expect(html).toContain("Every rail");
    expect(html).not.toContain("Live (");
    expect(html).not.toContain("Listed only");
    for (const r of OFFER_RAILS) expect(html).toContain(RAIL_LABEL[r]);
  });
});
