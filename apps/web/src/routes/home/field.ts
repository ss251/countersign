import type { RailDeclaration, RailId, Settlement } from "../../lib/types.ts";

/*
 * The evidence field: one mark per real settlement, never a decorative one. Each beat gives every
 * mark a spot; the page moves marks between spots with transform and opacity only.
 *
 * A spot is an anchor in percent of the field's box (x of its width, y of its height), an offset in
 * px from that anchor, a scale and an opacity. Percent keeps the layout fluid; px keeps marks from
 * touching at any size.
 */

export interface Spot {
  x: number;
  y: number;
  dx: number;
  dy: number;
  s: number;
  o: number;
}

/** Mark size and pitch in px, and where the line the marks stand on sits, in percent of the field's height. */
export interface Geometry {
  mark: number;
  pitch: number;
  base: number;
  /** Time buckets across the tape: marks closer than one bucket stack. */
  buckets: number;
  /** Marks per row when the field groups them by rail. */
  cols: number;
}

export const WIDE: Geometry = { mark: 10, pitch: 14, base: 58, buckets: 56, cols: 6 };
export const NARROW: Geometry = { mark: 8, pitch: 12, base: 40, buckets: 24, cols: 4 };

export const keyOf = (s: Settlement): string => `${s.jobId}-${s.kind}`;

/** Oldest first, ties broken by key so the order never flickers between reads. */
export function byTime(rows: Settlement[]): Settlement[] {
  return [...rows].sort((a, b) => a.at - b.at || keyOf(a).localeCompare(keyOf(b)));
}

/** The newest settlement: the mark that lifts out into the receipt. */
export function newestOf(rows: Settlement[]): Settlement | undefined {
  const sorted = byTime(rows);
  return sorted[sorted.length - 1];
}

/** The newest escrow release. Only this kind may stand under the escrow claim; direct rails settle before delivery. */
export function newestRelease(rows: Settlement[]): Settlement | undefined {
  return newestOf(rows.filter((s) => s.kind === "released"));
}

/** The rails to group by: the hub's declared rails in its order, then any rail a settlement names that it no longer declares. */
export function railOrder(rails: RailDeclaration[] | undefined, rows: Settlement[]): RailId[] {
  const ids: RailId[] = (rails ?? []).map((r) => r.id);
  for (const s of rows) if (!ids.includes(s.rail)) ids.push(s.rail);
  return ids;
}

/** Evenly spaced group centres in percent, across [from, to]. */
export function centres(n: number, from = 0, to = 100): number[] {
  return Array.from({ length: n }, (_, i) => from + ((to - from) * (2 * i + 1)) / (2 * n));
}

/** 2a: the tape. Each mark sits on the line at its time; payments that land close together stack upward. */
export function tape(rows: Settlement[], g: Geometry): Map<string, Spot> {
  const sorted = byTime(rows);
  const out = new Map<string, Spot>();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return out;
  const span = Math.max(1, last.at - first.at);
  const levels = new Map<number, number>();
  for (const s of sorted) {
    const bucket = sorted.length === 1 ? 0 : Math.round(((s.at - first.at) / span) * (g.buckets - 1));
    const level = levels.get(bucket) ?? 0;
    levels.set(bucket, level + 1);
    out.set(keyOf(s), {
      x: 2 + (96 * bucket) / Math.max(1, g.buckets - 1),
      y: g.base,
      dx: 0,
      dy: -(level * g.pitch) - g.mark / 2 - 3,
      s: 1,
      o: 1,
    });
  }
  return out;
}

/** 2b: the same marks grouped by rail, each group a small block standing on the line over its label. */
export function groups(rows: Settlement[], order: RailId[], g: Geometry, at: number[]): Map<string, Spot> {
  const out = new Map<string, Spot>();
  order.forEach((rail, i) => {
    const mine = byTime(rows.filter((s) => s.rail === rail));
    const centre = at[i] ?? 50;
    const width = Math.min(g.cols, mine.length);
    mine.forEach((s, j) => {
      const col = j % g.cols;
      const row = Math.floor(j / g.cols);
      out.set(keyOf(s), {
        x: centre,
        y: g.base,
        dx: (col - (width - 1) / 2) * g.pitch,
        dy: -(row * g.pitch) - g.mark / 2 - 3,
        s: 1,
        o: 1,
      });
    });
  });
  return out;
}

/** Where the receipt and the ask box sit, per beat: an anchor in percent of the field's height, plus px. */
export interface AsideSpot {
  y: number;
  dy: number;
}

/** The receipt's left edge in percent of the field's width: the right column on a wide screen, the full width on a phone. */
export const receiptX = (narrow: boolean): number => (narrow ? 0 : 56);

/** The aside per beat: on a phone it waits under the rail labels in 2c, then rises to the top for 2d. */
export function asideAt(beat: number, narrow: boolean, g: Geometry): AsideSpot {
  if (!narrow) return { y: 0, dy: 0 };
  return beat >= 4 ? { y: 0, dy: 0 } : { y: g.base, dy: 76 };
}

/**
 * The stamp in the receipt's top-left corner, where the newest mark lands: 12 px in, and level with
 * the middle of the title's first line (the receipt's 12 px top padding plus half a 20 px line).
 */
export function stampSpot(beat: number, narrow: boolean, g: Geometry): Spot {
  const a = asideAt(beat, narrow, g);
  return { x: receiptX(narrow), y: a.y, dx: 12, dy: a.dy + 22, s: 1.6, o: 1 };
}

/**
 * Every mark's spot for a beat of the evidence stage.
 * 0 the claim: marks wait, unseen, on the tape. 1 the tape. 2 grouped by rail.
 * 3 the groups step back (to the left half on a wide screen) and the newest lifts into the receipt.
 * 4 the groups leave the frame to the ask box; the receipt's mark stays.
 */
export function markSpots(rows: Settlement[], order: RailId[], beat: number, narrow: boolean): Map<string, Spot> {
  const g = narrow ? NARROW : WIDE;
  if (beat <= 1) {
    const t = tape(rows, g);
    if (beat === 0) for (const [k, p] of t) t.set(k, { ...p, s: 0.6, o: 0 });
    return t;
  }
  const at = beat >= 3 && !narrow ? centres(order.length, 0, 42) : centres(order.length);
  const spots = groups(rows, order, g, at);
  if (beat === 2) return spots;
  const dim = beat === 3 ? (narrow ? 0.22 : 0.3) : 0;
  for (const [k, p] of spots) spots.set(k, { ...p, o: dim });
  const newest = newestOf(rows);
  if (newest) spots.set(keyOf(newest), stampSpot(beat, narrow, g));
  return spots;
}

/** Where each rail's label sits for a beat: under its group's centre, below the line. */
export function labelSpots(order: RailId[], beat: number, narrow: boolean): Spot[] {
  const g = narrow ? NARROW : WIDE;
  const at = beat >= 3 && !narrow ? centres(order.length, 0, 42) : centres(order.length);
  const o = beat === 2 ? 1 : beat === 3 ? (narrow ? 0.22 : 0.3) : 0;
  return at.map((x) => ({ x, y: g.base, dx: 0, dy: 10, s: 1, o }));
}
