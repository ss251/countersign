import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { Offer } from "@countersign/core";
import { settlementIndex } from "../src/lib/ledger.ts";
import type { Listing, Settlement } from "../src/lib/types.ts";
import { SellerCard, type SellerGroup } from "../src/routes/registry/index.tsx";

// The Registry's counts say only what is known (firstmate 23:30:49Z, note b): a seller card waiting on the hub's
// records says so instead of "Not counted yet", and an offer row never shows a truncated ledger's count as the total.

const SELLER = "0x6be98051b852824a3923e3b27f9781ceb0c0ca4a";
const HASH = "0x1111111111111111111111111111111111111111111111111111111111111111" as const;
const offer = { v: 1, seller: SELLER, title: "use-arc", summary: "Settles on Arc.", adapter: "skill", price: "10000", deadline: 120, rails: ["escrow"], bond: "0" } as unknown as Offer;
const listing = (stats?: Listing["stats"]): Listing => ({ hash: HASH, offer, seller: { name: "0x6BE9…ca4a", named: false }, status: "listed", online: true, ...(stats ? { stats } : {}) });
const group = (over: Partial<SellerGroup> = {}, l: Listing = listing()): SellerGroup => ({
  address: SELLER,
  name: "0x6BE9…ca4a",
  offers: [l],
  released: 0,
  refunded: 0,
  failed: 0,
  online: 1,
  counted: false,
  named: false,
  ...over,
});
// 48 released settlements for this offer, as the console's own ledger reads them.
const rows = Array.from({ length: 48 }, (_, i) => ({ jobId: `0x${i.toString(16).padStart(64, "0")}`, offerHash: HASH, seller: SELLER, kind: "released", rail: "escrow", at: 1_793_990_000 - i, amount: "10000", title: "use-arc" })) as unknown as Settlement[];
const plain = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
const card = (props: { g: SellerGroup; reading?: boolean; ledgerComplete?: boolean }) =>
  plain(renderToString(createElement(SellerCard, { ledger: settlementIndex(rows), now: 1_793_990_100, ...props })));

describe("a seller card says what is known about its record", () => {
  test("while the hub's records are still loading it reads 'Reading…', never 'Not counted yet'", () => {
    const text = card({ g: group(), reading: true });
    expect(text).toContain("Reading…");
    expect(text).not.toContain("Not counted yet");
  });
  test("once they have answered with no record, it says 'Not counted yet'", () => {
    expect(card({ g: group(), reading: false })).toContain("Not counted yet");
  });
  test("with the hub's record it shows the hub's own total", () => {
    expect(card({ g: group({ counted: true, released: 56 }) })).toContain("56 paid");
  });
});

describe("an offer row never shows a truncated ledger's count as the offer's total", () => {
  test("a truncated ledger (as many rows as were asked for) shows no per-offer count", () => {
    expect(card({ g: group({ counted: true, released: 56 }), ledgerComplete: false })).not.toContain("48 paid");
  });
  test("a whole ledger shows its count", () => {
    expect(card({ g: group({ counted: true, released: 48 }), ledgerComplete: true })).toContain("48 paid");
  });
  test("the hub's own per-offer stats win over the ledger, whole or not", () => {
    const g = group({ counted: true, released: 56 }, listing({ calls: 56, released: 56, refunded: 0 }));
    const text = card({ g, ledgerComplete: false });
    expect((text.match(/56 paid/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(text).not.toContain("48 paid");
  });
});

describe("the merchant ledger keeps a gap between a label and its value at phone width", () => {
  test("the phone term grid has a column gap", async () => {
    const css = await Bun.file(new URL("../src/routes/merchant/merchant.css", import.meta.url).pathname).text();
    expect(css).toContain("    grid-template-columns: 1.25rem minmax(0, 1fr) auto;\n    align-items: baseline;\n    /* A column gap, so a long label (REFUNDED) never touches its value at phone width. */\n    gap: 0 var(--sp-2);");
  });
});
