import { describe, expect, test } from "bun:test";
import * as fx from "../src/fixtures/index.ts";
import type { Match } from "../src/routes/buyer/assistant.ts";
import { exampleNeeds, groupMatches, modKey, plainReason, selectable, type Verdict } from "../src/routes/assistant/palette.ts";

const m = (id: string): Match => ({ listing: { ...fx.listings[0]!, hash: `0x${id}` as Match["listing"]["hash"] }, score: 1, why: [] });
const ok = (asks: boolean): Verdict => ({ decision: { ok: true }, asks });
const no: Verdict = { decision: { ok: false, reason: "not-allowlisted", message: "This seller is not on the allowlist." }, asks: false };

describe("assistant palette", () => {
  test("groups follow the envelope: fits, needs you, refused, and drop the empty ones", () => {
    const verdicts: Record<string, Verdict> = { "0xa": ok(false), "0xb": ok(true), "0xc": no, "0xd": ok(false) };
    const groups = groupMatches([m("a"), m("b"), m("c"), m("d")], (x) => verdicts[x.listing.hash]!);
    expect(groups.map((g) => [g.id, g.rows.map((r) => r.listing.hash)])).toEqual([
      ["fits", ["0xa", "0xd"]],
      ["needs", ["0xb"]],
      ["refused", ["0xc"]],
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Fits your envelope", "Needs your countersignature", "Refused by your envelope"]);
  });

  test("the arrow keys skip refusals", () => {
    const groups = groupMatches([m("a"), m("c"), m("b")], (x) => (x.listing.hash === "0xc" ? no : ok(x.listing.hash === "0xb")));
    expect(selectable(groups).map((r) => r.listing.hash)).toEqual(["0xa", "0xb"]);
  });

  test("with no envelope read yet, matches sit in one plain group", () => {
    expect(groupMatches([m("a")], () => null).map((g) => g.label)).toEqual(["Matches"]);
  });

  test("one plain sentence per row, from the strongest reason", () => {
    expect(plainReason(['title has "deploy", "contract" and "arc"', "seller is online"])).toBe('Title has "deploy", "contract" and "arc".');
    expect(plainReason(["  ", "Its name matches “arc”."])).toBe("Its name matches “arc”.");
    expect(plainReason([])).toBe("");
  });

  test("example needs each hit a different real offer", () => {
    const ex = exampleNeeds(fx.listings);
    expect(ex.length).toBeGreaterThan(0);
    expect(ex.length).toBeLessThanOrEqual(3);
    expect(new Set(ex.map((x) => x.hits.hash)).size).toBe(ex.length);
  });

  test("Cmd on Apple platforms, Ctrl elsewhere", () => {
    expect(modKey("MacIntel")).toBe("⌘");
    expect(modKey("iPhone")).toBe("⌘");
    expect(modKey("Win32")).toBe("Ctrl");
    expect(modKey("Linux x86_64")).toBe("Ctrl");
  });
});
