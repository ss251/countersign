import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { liveSplit, NOT_LIVE } from "../src/lib/live.ts";
import type { RailId } from "../src/lib/types.ts";
import { OfferRailLine } from "../src/routes/offer/index.tsx";
import { OfferRowRails } from "../src/routes/registry/index.tsx";

const OFFER_RAILS: RailId[] = ["escrow", "gateway", "hedera"];

const textOf = (html: string) => html.replace(/<[^>]*>/g, "");

describe("liveSplit: live is the hub's, listed is what only offers name", () => {
  test("keeps the offer's order and puts rails the hub does not serve in listed", () => {
    expect(liveSplit(OFFER_RAILS, ["escrow", "whitechain", "hedera-scheduled"])).toEqual({
      live: ["escrow"],
      listed: ["gateway", "hedera"],
    });
  });

  test("unknown hub rails make no claim", () => {
    expect(liveSplit(OFFER_RAILS, undefined)).toBeNull();
  });

  test("a rail named twice appears once, in the offer's order", () => {
    expect(liveSplit(["gateway", "escrow", "gateway", "escrow"], ["escrow"])).toEqual({
      live: ["escrow"],
      listed: ["gateway"],
    });
  });

  test("an empty hub puts every offer rail in listed", () => {
    expect(liveSplit(OFFER_RAILS, [])).toEqual({ live: [], listed: OFFER_RAILS });
  });

  test("a hub rail the offer does not name is not live on this offer", () => {
    expect(liveSplit(["escrow"], ["escrow", "whitechain"])).toEqual({ live: ["escrow"], listed: [] });
  });
});

describe("the decided wording", () => {
  test("NOT_LIVE is exact", () => {
    expect(NOT_LIVE).toBe("listed, not live on this hub");
  });
});

describe("the offer page names live rails and marks the rest", () => {
  test("the live labels come first; the rest carry the decided suffix", () => {
    const text = textOf(renderToString(createElement(OfferRailLine, { rails: OFFER_RAILS, hubRailIds: ["escrow", "whitechain"] })));
    expect(text).toContain("Settles on Arc · escrow");
    expect(text).toContain("Arc · Gateway, Hedera · x402: listed, not live on this hub");
  });

  test("an offer with only live rails carries no suffix", () => {
    const text = textOf(renderToString(createElement(OfferRailLine, { rails: ["escrow"], hubRailIds: ["escrow"] })));
    expect(text).toBe("Settles on Arc · escrow");
    expect(text).not.toContain(NOT_LIVE);
  });

  test("with no hub rails the old single line is unchanged", () => {
    const text = textOf(renderToString(createElement(OfferRailLine, { rails: OFFER_RAILS, hubRailIds: undefined })));
    expect(text).toBe("Settles on Arc · escrow, Arc · Gateway, Hedera · x402");
    expect(text).not.toContain(NOT_LIVE);
  });

  test("no live rail says so plainly", () => {
    const text = textOf(renderToString(createElement(OfferRailLine, { rails: ["gateway"], hubRailIds: ["escrow"] })));
    expect(text).toContain("Settles on no rail live on this hub");
    expect(text).toContain("Arc · Gateway: listed, not live on this hub");
  });
});

describe("the Registry's offer rows name live rails and mark the rest", () => {
  test("the live labels, then the listed ones with the decided suffix", () => {
    const text = textOf(renderToString(createElement(OfferRowRails, { rails: OFFER_RAILS, hubRailIds: ["escrow"] })));
    expect(text).toBe("Arc · escrow · Arc · Gateway, Hedera · x402: listed, not live on this hub");
  });

  test("an all-live row carries no suffix", () => {
    const text = textOf(renderToString(createElement(OfferRowRails, { rails: ["escrow"], hubRailIds: ["escrow"] })));
    expect(text).toBe("Arc · escrow");
    expect(text).not.toContain(NOT_LIVE);
  });

  test("with no hub rails the row is unchanged", () => {
    const text = textOf(renderToString(createElement(OfferRowRails, { rails: OFFER_RAILS, hubRailIds: undefined })));
    expect(text).toBe("Arc · escrow, Arc · Gateway, Hedera · x402");
    expect(text).not.toContain(NOT_LIVE);
  });
});

describe("no old wording is left in the web console", () => {
  test("nothing still says a rail is not declared by this hub", async () => {
    const src = join(import.meta.dir, "../src");
    const offenders: string[] = [];
    const glob = new Bun.Glob("**/*.{ts,tsx}");
    for await (const file of glob.scan({ cwd: src, onlyFiles: true })) {
      const text = await Bun.file(join(src, file)).text();
      if (text.includes("not declared by this hub")) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
