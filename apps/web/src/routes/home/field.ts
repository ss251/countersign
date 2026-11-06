import type { Slip } from "@countersign/core";
import { explorerTemplate, networkName } from "../../lib/format.ts";
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
  /** Where the lifted mark sits on the receipt: px in from its left edge, px down to the middle of the title's first line. */
  stampX: number;
  stampY: number;
  stampScale: number;
}

/* At 1440 the evidence carries the frame: 16 px marks on a 22 px pitch, the tape at mid-height (firstmate review 1). */
export const WIDE: Geometry = { mark: 16, pitch: 22, base: 46, buckets: 40, cols: 6, stampX: 16, stampY: 27, stampScale: 1.6 };
export const NARROW: Geometry = { mark: 8, pitch: 12, base: 40, buckets: 24, cols: 4, stampX: 12, stampY: 22, stampScale: 1.6 };

/** The evidence stage's beats: the claim, the tape, the rails, the receipt, the ask, and the exit. */
export const EXIT = 5;

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

/** Said while the hub's first reads are out, in place of any claim that there is none (firstmate, 23:45 IST). */
export const READING = "Reading this hub's payments…";

/** The newest release on any rail. The landing's escrow claims follow escrowRelease, never this. */
export function newestRelease(rows: Settlement[]): Settlement | undefined {
  return newestOf(rows.filter((s) => s.kind === "released"));
}

/**
 * The rails whose money waits in a contract: kind escrow, with the contract's address declared
 * (Arc's escrow, Whitechain's). Held Hedera declares kind escrow but names no contract, and its
 * payee's key alone can execute the schedule (audit A4), so it never stands under an escrow claim.
 */
export function contractRails(rails: RailDeclaration[] | undefined): RailId[] {
  return (rails ?? []).filter((r) => r.kind === "escrow" && typeof r.escrow === "string" && r.escrow !== "").map((r) => r.id);
}

/**
 * The newest release from an escrow contract: the only payment the landing follows under "nothing
 * moves until the output checks out". With no rail declarations there is no contract to name, so none.
 */
export function escrowRelease(rows: Settlement[], rails: RailDeclaration[] | undefined): Settlement | undefined {
  const contract = contractRails(rails);
  return newestOf(rows.filter((s) => s.kind === "released" && contract.includes(s.rail)));
}

/** What a rail is called in a plain sentence. */
const SAID: Partial<Record<RailId, string>> = {
  gateway: "Gateway",
  hedera: "Hedera x402",
  eip3009: "Arc USDC transfers",
  mpp: "Stripe MPP",
  erc8183: "ERC-8183",
};

function listed(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The other rails, said plainly from their own declarations: the ones that pay before delivery,
 * and a hold with no contract behind it in A4's plain words. Nothing when the hub declared no rails.
 */
export function otherRailsLines(rails: RailDeclaration[] | undefined): string[] {
  const all = rails ?? [];
  const first = all.filter((r) => r.kind === "direct" || r.kind === "batched").map((r) => SAID[r.id] ?? r.id);
  const contract = contractRails(all);
  const held = all.filter((r) => r.kind === "escrow" && !contract.includes(r.id));
  const lines: string[] = [];
  if (first.length) lines.push(`${listed(first)} ${first.length === 1 ? "pays" : "pay"} the seller before delivery.`);
  if (held.some((r) => r.network.startsWith("hedera:"))) {
    lines.push("Held Hedera waits for the seller's key, which can also release it without delivering.");
  }
  return lines;
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

/**
 * More rails than this and the groups are crowded: each label splits its chain from its rail on two
 * short lines, and on a wide screen the stepped-back groups narrow to four columns, so neither the
 * labels nor the marks of two neighbouring groups can touch, at four rails or five.
 */
export const ROOMY = 3;

/** Marks per row for a beat: fewer when crowded groups step back into the left half of a wide screen. */
export function colsFor(order: RailId[], beat: number, narrow: boolean, g: Geometry): number {
  return beat >= 3 && !narrow && order.length > ROOMY ? 4 : g.cols;
}

/** 2b: the same marks grouped by rail, each group a small block standing on the line over its label. */
export function groups(rows: Settlement[], order: RailId[], g: Geometry, at: number[], cols: number = g.cols): Map<string, Spot> {
  const out = new Map<string, Spot>();
  order.forEach((rail, i) => {
    const mine = byTime(rows.filter((s) => s.rail === rail));
    const centre = at[i] ?? 50;
    const width = Math.min(cols, mine.length);
    mine.forEach((s, j) => {
      const col = j % cols;
      const row = Math.floor(j / cols);
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

/** The stamp in the receipt's top-left corner, where the newest mark lands, level with the title's first line. */
export function stampSpot(beat: number, narrow: boolean, g: Geometry): Spot {
  const a = asideAt(beat, narrow, g);
  return { x: receiptX(narrow), y: a.y, dx: g.stampX, dy: a.dy + g.stampY, s: g.stampScale, o: 1 };
}

/**
 * Every mark's spot for a beat of the evidence stage.
 * 0 the claim: marks wait, unseen, on the tape. 1 the tape. 2 grouped by rail.
 * 3 the groups step back (to the left half on a wide screen) and the newest lifts into the receipt.
 * 4 the groups leave the frame to the ask box; the receipt's mark stays.
 * 5 the exit: every mark leaves with the rest of the stage's evidence, where it stands, so nothing
 *   is left behind when the frame scrolls away.
 */
export function markSpots(rows: Settlement[], order: RailId[], beat: number, narrow: boolean): Map<string, Spot> {
  const g = narrow ? NARROW : WIDE;
  if (beat <= 1) {
    const t = tape(rows, g);
    if (beat === 0) for (const [k, p] of t) t.set(k, { ...p, s: 0.6, o: 0 });
    return t;
  }
  const at = beat >= 3 && !narrow ? centres(order.length, 0, 42) : centres(order.length);
  const spots = groups(rows, order, g, at, colsFor(order, beat, narrow, g));
  if (beat === 2) return spots;
  const dim = beat === 3 ? (narrow ? 0.22 : 0.3) : 0;
  for (const [k, p] of spots) spots.set(k, { ...p, o: dim });
  const newest = newestOf(rows);
  if (newest) spots.set(keyOf(newest), { ...stampSpot(Math.min(beat, 4), narrow, g), o: beat >= EXIT ? 0 : 1 });
  return spots;
}

/** Where each rail's label sits for a beat: under its group's centre, below the line. */
export function labelSpots(order: RailId[], beat: number, narrow: boolean): Spot[] {
  const g = narrow ? NARROW : WIDE;
  const at = beat >= 3 && !narrow ? centres(order.length, 0, 42) : centres(order.length);
  const o = beat === 2 ? 1 : beat === 3 ? (narrow ? 0.22 : 0.3) : 0;
  return at.map((x) => ({ x, y: g.base, dx: 0, dy: 10, s: 1, o }));
}

export interface HeldBy {
  /** The escrow contract that held this payment, or undefined until a record names it. */
  escrow: string | undefined;
  escrowHref: string | undefined;
  /** The chain's name, from the payment's own network. */
  chain: string;
  txHref: string | undefined;
}

/**
 * Where this payment waited, from its own records only: the escrow from the seller's slip, else from
 * its own rail's declaration; the chain from its network; links from its own explorer. A record that
 * names no escrow leaves the line out rather than borrow another rail's contract.
 */
export function heldBy(release: Settlement, rails: RailDeclaration[] | undefined, slip: Slip | undefined): HeldBy {
  const declared = rails?.find((r) => r.id === release.rail);
  const escrow = slip?.body.escrow ?? declared?.escrow;
  const template = declared?.explorerTx || explorerTemplate(release.network);
  const at = (path: string) => (template.includes("/tx/{tx}") ? template.replace("/tx/{tx}", path) : undefined);
  return {
    escrow,
    escrowHref: escrow ? at(`/address/${encodeURIComponent(escrow)}`) : undefined,
    chain: networkName(release.network),
    txHref: release.explorer ?? (release.tx ? at(`/tx/${encodeURIComponent(release.tx)}`) : undefined),
  };
}
