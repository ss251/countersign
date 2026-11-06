import { describe, expect, test } from "bun:test";
import type { RailDeclaration, RailId, Settlement } from "../src/lib/types.ts";
import { byTime, contractRails, escrowRelease, newestOf, newestRelease, otherRailsLines, railOrder } from "../src/routes/home/field.ts";
import { beatProgress, span } from "../src/routes/home/stage.ts";
import { BEATS, dotAt, drawnAt, litAt, NARROW_LAYOUT, nodeAt, PATH_ORDER, pointOn, settledAt, WEIGHTS, WIDE_LAYOUT } from "../src/routes/home/journey.ts";

// Production's mix on 06 Nov: 6 escrow releases, 3 Gateway and 7 Hedera settlements.
const MIX: Array<[RailId, Settlement["kind"]]> = [
  ...Array.from({ length: 6 }, (): [RailId, Settlement["kind"]] => ["escrow", "released"]),
  ...Array.from({ length: 3 }, (): [RailId, Settlement["kind"]] => ["gateway", "settled"]),
  ...Array.from({ length: 7 }, (): [RailId, Settlement["kind"]] => ["hedera", "settled"]),
];

const row = (i: number, rail: RailId, kind: Settlement["kind"], at: number): Settlement => ({
  jobId: `0x${i.toString(16).padStart(4, "0")}`,
  offerHash: "0xoffer",
  title: `offer ${i}`,
  seller: "0x6be9805162d0f7ae6000000000000000000ca4a",
  amount: "10000",
  rail,
  network: rail === "hedera" ? "hedera:testnet" : "eip155:5042002",
  kind,
  tx: `0xtx${i}`,
  at,
});

// Interleaved in time, with bursts: some payments land seconds apart and must stack, not overlap.
const ROWS = MIX.map(([rail, kind], i) => row(i, rail, kind, 1_793_960_000 + (i % 5 === 0 ? i * 7 : i * 600)));
const RAILS = (["escrow", "gateway", "hedera"] as RailId[]).map((id) => ({ id }) as RailDeclaration);

describe("which payments the landing may follow", () => {
  test("the escrow beat only ever shows an escrow release, never a newer direct-rail payment", () => {
    const later = [...ROWS, row(99, "hedera", "settled", 1_799_999_999)];
    expect(newestOf(later)!.rail).toBe("hedera");
    const release = newestRelease(later)!;
    expect(release.kind).toBe("released");
    expect(release.rail).toBe("escrow");
    expect(newestRelease(ROWS.filter((s) => s.kind !== "released"))).toBeUndefined();
  });

  test("a rail a settlement names but the hub no longer declares still gets its group", () => {
    const order = railOrder(RAILS.slice(0, 1), ROWS);
    expect(order).toEqual(["escrow", "gateway", "hedera"]);
    expect(byTime(ROWS)[0]!.at).toBeLessThanOrEqual(byTime(ROWS)[1]!.at);
  });
});

describe("the escrow claims follow only an escrow contract's release", () => {
  // Production's five rails on 06 Nov, as /rails declares them (only the fields the landing reads).
  const PROD = [
    { id: "escrow", network: "eip155:5042002", kind: "escrow", escrow: "0x19c27D770969291E6A0a305dc1Be1a845E7c1b76" },
    { id: "whitechain", network: "eip155:1874", kind: "escrow", escrow: "0x9279D3edeef4c3738a0b200D762e2985Ff3B7eb4" },
    { id: "gateway", network: "eip155:5042002", kind: "batched" },
    { id: "hedera", network: "hedera:testnet", kind: "direct" },
    { id: "hedera-scheduled", network: "hedera:testnet", kind: "escrow" },
  ] as unknown as RailDeclaration[];

  // The 21:45 mix: the newest release is a held Hedera payment, and direct payments land after it.
  const mixed: Settlement[] = [
    row(1, "escrow", "released", 1_793_979_619),
    row(2, "whitechain", "released", 1_793_979_650),
    row(3, "hedera-scheduled", "released", 1_793_979_700),
    row(4, "hedera", "settled", 1_793_979_656),
    row(5, "gateway", "settled", 1_793_979_800),
  ];

  test("a newer held Hedera release or direct payment never stands under the escrow claim", () => {
    expect(newestRelease(mixed)?.rail).toBe("hedera-scheduled");
    expect(escrowRelease(mixed, PROD)?.rail).toBe("whitechain");
    expect(escrowRelease(mixed.filter((s) => s.rail !== "whitechain"), PROD)?.rail).toBe("escrow");
  });

  test("only rails that declare a contract count, and no declarations means no claim", () => {
    expect(contractRails(PROD)).toEqual(["escrow", "whitechain"]);
    expect(escrowRelease(mixed, undefined)).toBeUndefined();
    expect(escrowRelease(mixed.filter((s) => s.rail.startsWith("hedera") || s.rail === "gateway"), PROD)).toBeUndefined();
  });

  test("the other rails are said from their declarations, with the held rail's plain limit", () => {
    expect(otherRailsLines(PROD)).toEqual([
      "Gateway and Hedera x402 pay the seller before delivery.",
      "Held Hedera waits for the seller's key, which can also release it without delivering.",
    ]);
    for (const line of otherRailsLines(PROD)) {
      expect(line).not.toMatch(/escrow|refund|until the output checks out/i);
    }
    expect(otherRailsLines(undefined)).toEqual([]);
    expect(otherRailsLines(PROD.slice(0, 2))).toEqual([]);
  });
});

describe("the journey's drawing follows the scroll, and only forward", () => {
  const samples = (beat: number) => Array.from({ length: 11 }, (_, i) => [beat, i / 10] as const);
  const all = Array.from({ length: WEIGHTS.length }, (_, b) => samples(b)).flat();

  test("scroll progress maps onto beats by their weights, ending on the exit", () => {
    expect(beatProgress(0, WEIGHTS)).toEqual([0, 0]);
    const [b, t] = beatProgress(1.5 / span(WEIGHTS), WEIGHTS);
    expect(b).toBe(1);
    expect(t).toBeCloseTo(0.5);
    expect(beatProgress(1, WEIGHTS)).toEqual([BEATS.exit, 1]);
    expect(beatProgress(-3, WEIGHTS)[0]).toBe(0);
  });

  test("every connection lights once and never goes dark again as you scroll on", () => {
    let last = litAt(0, 0);
    for (const [b, t] of all) {
      const now = litAt(b, t);
      for (const id of PATH_ORDER) {
        expect(now[id]).toBeGreaterThanOrEqual(last[id] - 1e-9);
        expect(now[id]).toBeGreaterThanOrEqual(0);
        expect(now[id]).toBeLessThanOrEqual(1);
      }
      last = now;
    }
    for (const id of PATH_ORDER) expect(litAt(BEATS.exit, 0)[id]).toBe(1);
  });

  test("the rules and the parties are all drawn by the end of the first beat", () => {
    expect(drawnAt(BEATS.cast, 1)).toBe(1);
    for (let i = 0; i < 5; i++) expect(nodeAt(BEATS.cast, 1, i)).toBe(1);
    expect(nodeAt(BEATS.cast, 0, 0)).toBe(0);
  });

  test("no payment moves before the countersignature, and it is settled only at the seller", () => {
    expect(dotAt(BEATS.cast, 1)).toBeNull();
    expect(dotAt(BEATS.limits, 1)).toBeNull();
    expect(dotAt(BEATS.countersign, 0.5)?.path).toBe("yh");
    expect(dotAt(BEATS.held, 0.5)?.path).toBe("he");
    expect(dotAt(BEATS.released, 0.5)?.path).toBe("es");
    expect(settledAt(BEATS.held, 1)).toBe(false);
    expect(settledAt(BEATS.released, 0.2)).toBe(false);
    expect(settledAt(BEATS.released, 1)).toBe(true);
    expect(settledAt(BEATS.exit, 0)).toBe(true);
  });

  test("each connection runs between the two parties it names, at 1440 and at 390", () => {
    const ends = { ah: ["agent", "hub"], yh: ["you", "hub"], hs: ["hub", "seller"], he: ["hub", "escrow"], es: ["escrow", "seller"] } as const;
    for (const layout of [WIDE_LAYOUT, NARROW_LAYOUT]) {
      for (const id of PATH_ORDER) {
        const [from, to] = ends[id];
        const a = pointOn(layout.paths[id], 0);
        const z = pointOn(layout.paths[id], 1);
        expect(a).toEqual(layout.nodes[from]);
        expect(z).toEqual(layout.nodes[to]);
      }
    }
  });
});
