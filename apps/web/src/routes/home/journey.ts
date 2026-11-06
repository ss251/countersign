/*
 * The journey's geometry and timing, pure so it can be tested without a browser.
 *
 * Five parties on one diagram: the agent and you on one side, the hub between, the seller and the
 * escrow on the other. Five connections. Each beat lights the connection it is about, and from the
 * countersignature on one payment rides them: you to the hub, the hub to the escrow, the escrow to
 * the seller.
 */

export type NodeId = "agent" | "you" | "hub" | "seller" | "escrow";
export type PathId = "ah" | "yh" | "hs" | "he" | "es";

export const BEATS = {
  cast: 0,
  limits: 1,
  countersign: 2,
  held: 3,
  released: 4,
  exit: 5,
} as const;

/** In screens of scroll. The exit is short: the last state holds as the evidence comes up. */
export const WEIGHTS = [1, 1, 1, 1, 1, 0.35] as const;

export const STATEMENTS = [
  "Every purchase has five parties.",
  "The agent signs its limits once.",
  "Above them, you countersign the exact offer and amount.",
  "The money is held until the work lands.",
  "The seller delivers, signs, and the slip verifies.",
] as const;

export const ROLES: Record<NodeId, { name: string; does: string }> = {
  agent: { name: "Agent", does: "Finds a tool and buys it, inside your limits." },
  you: { name: "You", does: "Sign the limits once; countersign anything above them." },
  hub: { name: "Hub", does: "Lists offers and relays the call. Never holds the money." },
  escrow: { name: "Escrow", does: "A contract on chain that holds the payment." },
  seller: { name: "Seller", does: "Delivers the output and signs the slip." },
};

export const NODE_ORDER: readonly NodeId[] = ["agent", "you", "hub", "seller", "escrow"];

export interface Layout {
  w: number;
  h: number;
  nodes: Record<NodeId, { x: number; y: number }>;
  paths: Record<PathId, string>;
}

export const WIDE_LAYOUT: Layout = {
  w: 640,
  h: 420,
  nodes: {
    agent: { x: 100, y: 110 },
    you: { x: 100, y: 310 },
    hub: { x: 320, y: 210 },
    seller: { x: 540, y: 110 },
    escrow: { x: 540, y: 310 },
  },
  paths: {
    ah: "M100 110 C210 110 210 210 320 210",
    yh: "M100 310 C210 310 210 210 320 210",
    hs: "M320 210 C430 210 430 110 540 110",
    he: "M320 210 C430 210 430 310 540 310",
    es: "M540 310 L540 110",
  },
};

export const NARROW_LAYOUT: Layout = {
  w: 360,
  h: 520,
  nodes: {
    agent: { x: 80, y: 70 },
    you: { x: 280, y: 70 },
    hub: { x: 180, y: 240 },
    seller: { x: 80, y: 430 },
    escrow: { x: 280, y: 430 },
  },
  paths: {
    ah: "M80 70 C80 155 180 155 180 240",
    yh: "M280 70 C280 155 180 155 180 240",
    hs: "M180 240 C180 335 80 335 80 430",
    he: "M180 240 C180 335 280 335 280 430",
    es: "M280 430 L80 430",
  },
};

export const PATH_ORDER: readonly PathId[] = ["ah", "yh", "hs", "he", "es"];

const clamp = (v: number) => Math.min(1, Math.max(0, v));
/** A strong ease-out, the same curve as --ease-out, for drawing that answers at once. */
export const easeOut = (t: number): number => 1 - Math.pow(1 - clamp(t), 3);

/** How much of the diagram's rules are drawn: all of them over the first beat, then fully. */
export function drawnAt(beat: number, t: number): number {
  return beat === BEATS.cast ? easeOut(t * 1.4) : 1;
}

/** How visible each party is: they arrive one after another through the first beat. */
export function nodeAt(beat: number, t: number, i: number): number {
  if (beat > BEATS.cast) return 1;
  return easeOut((t * 1.6 - i * 0.14) * 2.5);
}

/** How much of each connection is lit, at a beat and the fraction through it. */
export function litAt(beat: number, t: number): Record<PathId, number> {
  const at = (from: number) => (beat > from ? 1 : beat === from ? easeOut(t * 1.25) : 0);
  return {
    ah: at(BEATS.limits),
    yh: at(BEATS.countersign),
    he: at(BEATS.held),
    // The call goes to the seller while the money waits: it lights a little behind the hold.
    hs: beat > BEATS.held ? 1 : beat === BEATS.held ? easeOut(t * 1.25 - 0.25) : 0,
    es: at(BEATS.released),
  };
}

/** Where the payment is: on which connection, and how far along. None before the countersignature. */
export function dotAt(beat: number, t: number): { path: PathId; t: number } | null {
  if (beat < BEATS.countersign) return null;
  if (beat === BEATS.countersign) return { path: "yh", t: easeOut(t * 1.25) };
  if (beat === BEATS.held) return { path: "he", t: easeOut(t * 1.25) };
  if (beat === BEATS.released) return { path: "es", t: easeOut(t * 1.25) };
  return { path: "es", t: 1 };
}

/** The payment is settled once it has reached the seller. */
export const settledAt = (beat: number, t: number): boolean => beat > BEATS.released || (beat === BEATS.released && t >= 0.8);

/** Points on our own path strings: "M x y C ..." or "M x y L x y". */
export function pointOn(d: string, t: number): { x: number; y: number } {
  const n = d.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
  if (n.length === 4) return { x: n[0]! + (n[2]! - n[0]!) * t, y: n[1]! + (n[3]! - n[1]!) * t };
  const [x0, y0, x1, y1, x2, y2, x3, y3] = n as [number, number, number, number, number, number, number, number];
  const u = 1 - t;
  return {
    x: u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
    y: u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
  };
}
