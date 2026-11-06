import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { RailDeclaration, Settlement } from "../src/lib/types.ts";
import { LifecycleStage, type LifecycleProps } from "../src/routes/home/Lifecycle.tsx";

// A released escrow payment as the hub serves it; no slip is read without the hub.
const RELEASE: Settlement = {
  jobId: `0x${"11".repeat(32)}`,
  offerHash: `0x${"22".repeat(32)}`,
  title: "A signed market brief",
  seller: `0x${"33".repeat(20)}`,
  buyer: `0x${"44".repeat(20)}`,
  amount: "250000",
  rail: "escrow",
  network: "eip155:5042002",
  kind: "released",
  tx: `0x${"55".repeat(32)}`,
  slipHash: `0x${"66".repeat(32)}`,
  at: 1_793_960_000,
};

const RAILS = [{ id: "escrow", escrow: `0x${"77".repeat(20)}` } as RailDeclaration];

const STATEMENTS = [
  "An offer is published.",
  "A buyer countersigns it.",
  "The money is held until the work lands.",
  "The seller signs, and the slip verifies.",
];

const html = (props: LifecycleProps): string => renderToString(createElement(LifecycleStage, props));

describe("the life of one payment", () => {
  test("pinned, one release carries all four statements in order and four steps", () => {
    const out = html({ release: RELEASE, rails: RAILS, hubDown: false, pinned: true, narrow: false });
    let at = -1;
    for (const words of STATEMENTS) {
      const i = out.indexOf(words);
      expect(i).toBeGreaterThan(at);
      at = i;
    }
    expect(out.match(/life__step/g)).toHaveLength(4);
  });

  test("a hub that did not answer says so and draws no steps, even with a stale release", () => {
    const out = html({ release: RELEASE, rails: RAILS, hubDown: true, pinned: true, narrow: false });
    expect(out).toContain("The hub did not answer");
    expect(out).not.toContain("life__step");
  });

  test("no escrow release yet says so plainly, with no steps and no fixtures", () => {
    const out = html({ release: undefined, rails: RAILS, hubDown: false, pinned: true, narrow: false });
    expect(out).toContain("No escrow payment has cleared on this hub yet");
    expect(out).not.toContain("life__step");
  });

  test("less motion gives four static sections and no exit section", () => {
    const out = html({ release: RELEASE, rails: RAILS, hubDown: false, pinned: false, narrow: false });
    const beats = [...out.matchAll(/data-beat="(\d+)"/g)].map((m) => m[1]);
    expect(beats).toEqual(["0", "1", "2", "3"]);
    for (const words of STATEMENTS) expect(out).toContain(words);
  });
});
