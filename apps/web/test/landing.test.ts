import { describe, expect, test } from "bun:test";
import type { RailDeclaration, RailId, Settlement } from "../src/lib/types.ts";
import {
  byTime,
  centres,
  contractRails,
  escrowRelease,
  EXIT,
  groups,
  keyOf,
  markSpots,
  NARROW,
  newestOf,
  newestRelease,
  otherRailsLines,
  railOrder,
  receiptX,
  tape,
  WIDE,
  type Spot,
} from "../src/routes/home/field.ts";

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
const ORDER = railOrder(RAILS, ROWS);

const where = (p: Spot) => `${p.x.toFixed(3)}|${p.y}|${p.dx}|${p.dy}`;

describe("the landing's evidence field", () => {
  test("every beat draws one mark per settlement: 16 settlements make 16 marks, never more", () => {
    for (const narrow of [false, true]) {
      for (let beat = 0; beat <= EXIT; beat++) {
        const spots = markSpots(ROWS, ORDER, beat, narrow);
        expect(spots.size).toBe(ROWS.length);
        for (const s of ROWS) expect(spots.has(keyOf(s))).toBe(true);
      }
    }
  });

  test("on the tape no two marks share a spot, and every mark stays inside the field", () => {
    for (const g of [WIDE, NARROW]) {
      const spots = [...tape(ROWS, g).values()];
      expect(new Set(spots.map(where)).size).toBe(ROWS.length);
      for (const p of spots) {
        expect(p.x).toBeGreaterThanOrEqual(2);
        expect(p.x).toBeLessThanOrEqual(98);
      }
    }
  });

  test("grouped by rail, each group holds exactly its rail's settlements and no two marks touch", () => {
    const at = centres(ORDER.length);
    const spots = groups(ROWS, ORDER, WIDE, at);
    expect(new Set([...spots.values()].map(where)).size).toBe(ROWS.length);
    ORDER.forEach((rail, i) => {
      const mine = ROWS.filter((s) => s.rail === rail).map((s) => spots.get(keyOf(s))!);
      expect(mine.every((p) => p.x === at[i])).toBe(true);
    });
    expect(ORDER).toEqual(["escrow", "gateway", "hedera"]);
    expect(ROWS.filter((s) => s.rail === "escrow")).toHaveLength(6);
  });

  test("the newest mark lifts into the receipt's stamp; the rest step back, then leave for the ask box", () => {
    const newest = newestOf(ROWS)!;
    for (const narrow of [false, true]) {
      const lifted = markSpots(ROWS, ORDER, 3, narrow).get(keyOf(newest))!;
      expect(lifted.x).toBe(receiptX(narrow));
      expect(lifted.s).toBeGreaterThan(1);
      expect(lifted.o).toBe(1);
      const asked = markSpots(ROWS, ORDER, 4, narrow);
      for (const s of ROWS) if (s !== newest) expect(asked.get(keyOf(s))!.o).toBe(0);
    }
    const claim = markSpots(ROWS, ORDER, 0, false);
    expect([...claim.values()].every((p) => p.o === 0)).toBe(true);
  });

  test("the exit beat leaves nothing behind: every mark, the lifted one too, is gone before the frame scrolls away", () => {
    for (const narrow of [false, true]) {
      const exit = markSpots(ROWS, ORDER, EXIT, narrow);
      expect([...exit.values()].every((p) => p.o === 0)).toBe(true);
    }
  });

  test("with five rails no two marks touch, at 1440 or at 390, grouped or stepped back", () => {
    // Tonight the hub can declare five rails: no group may run into its neighbour as they multiply.
    const five: Array<[RailId, number]> = [["escrow", 9], ["gateway", 4], ["hedera", 8], ["whitechain", 6], ["eip3009", 7]];
    const rows = five.flatMap(([rail, n], r) =>
      Array.from({ length: n }, (_, j) => row(r * 100 + j, rail, rail === "escrow" ? "released" : "settled", 1_793_960_000 + r * 1000 + j * 60)),
    );
    const order = railOrder(five.map(([id]) => ({ id }) as RailDeclaration), rows);
    expect(order).toHaveLength(5);
    for (const [narrow, width, height, g] of [[false, 1180, 464, WIDE], [true, 358, 528, NARROW]] as const) {
      for (const beat of [2, 3]) {
        const seen = [...markSpots(rows, order, beat, narrow).values()]
          .filter((p) => p.o > 0)
          .map((p) => ({ x: (p.x / 100) * width + p.dx, y: (p.y / 100) * height + p.dy, size: g.mark * p.s }));
        for (let a = 0; a < seen.length; a++) {
          for (let b = a + 1; b < seen.length; b++) {
            const [p, q] = [seen[a]!, seen[b]!];
            const reach = (p.size + q.size) / 2;
            const apart = Math.abs(p.x - q.x) >= reach || Math.abs(p.y - q.y) >= reach;
            if (!apart) throw new Error(`beat ${beat} ${narrow ? "390" : "1440"}: marks at ${p.x.toFixed(0)},${p.y.toFixed(0)} and ${q.x.toFixed(0)},${q.y.toFixed(0)} touch`);
          }
        }
      }
    }
  });

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
      // Evidence (captain via firstmate 21:52:02Z): since A4 the Hedera payee is 2-of-2 with the hub, proven on schedule 0.0.11343208.
      "Held Hedera moves only when the seller and the hub both sign.",
    ]);
    for (const line of otherRailsLines(PROD)) {
      expect(line).not.toMatch(/escrow|refund|until the output checks out/i);
    }
    expect(otherRailsLines(undefined)).toEqual([]);
    expect(otherRailsLines(PROD.slice(0, 2))).toEqual([]);
  });
});
