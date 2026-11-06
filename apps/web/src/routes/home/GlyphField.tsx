import { useEffect, useRef } from "react";

/*
 * The hero's ground: a grid of monospaced glyphs that sits faint and still, and swells into denser
 * characters and brighter ink in rings that spread from the pointer, from clicks, and, when nobody
 * is touching it, from a random cell now and then. One 2D canvas, no WebGL. It draws only while
 * `running`; otherwise it holds one still frame.
 */

/** Sparse to dense: an index into this is how "loud" a cell is. */
const RAMP = " .·:-=+*%#@";
const CELL_W = 14;
const CELL_H = 20;
const RING_SPEED = 0.32; // px per ms
const RING_WIDTH = 46; // px, the ring's soft half-thickness
const RING_LIFE = 2600; // ms
const IDLE_EVERY = 1500; // ms between idle ripples
const TRAIL_EVERY = 90; // ms between pointer-trail ripples

interface Ring {
  x: number;
  y: number;
  t0: number;
  power: number;
}

/** Under reduced motion the field is one still frame: no animation loop, and no ripples from the pointer. */
export function reducesMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Whether the field animates: only when asked to run, and never under reduced motion. */
export function glyphLoopRuns(running: boolean): boolean {
  return running && !reducesMotion();
}

export function GlyphField({ running, theme, target }: { running: boolean; theme: string; target: React.RefObject<HTMLElement | null> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const runRef = useRef(running);
  runRef.current = glyphLoopRuns(running);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const still = reducesMotion();

    const css = getComputedStyle(el);
    const ink = rgb(css.getPropertyValue("--ink"), [216, 220, 255]);
    const steel = rgb(css.getPropertyValue("--steel"), [67, 127, 151]);
    // Dark ink on light paper reads much fainter than light ink on dark at the same alpha.
    const light = theme === "light";
    const font = `${light ? 600 : 500} 13px ${css.getPropertyValue("--mono") || "monospace"}`;
    const floor = light ? 0.32 : 0.18;
    const span = light ? 0.68 : 0.72;

    let w = 0;
    let h = 0;
    let cols = 0;
    let rows = 0;
    const rings: Ring[] = [];
    let lastIdle = 0;
    let lastTrail = 0;
    let lastPointer = -Infinity;
    let raf = 0;

    const size = () => {
      const r = el.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = r.width;
      h = r.height;
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(w / CELL_W) + 1;
      rows = Math.ceil(h / CELL_H) + 1;
    };

    const draw = (now: number) => {
      ctx.clearRect(0, 0, w, h);
      ctx.font = font;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let i = rings.length - 1; i >= 0; i--) if (now - rings[i]!.t0 > RING_LIFE) rings.splice(i, 1);
      const t = now * 0.00025;

      for (let r = 0; r < rows; r++) {
        const y = r * CELL_H + CELL_H / 2;
        for (let c = 0; c < cols; c++) {
          const x = c * CELL_W + CELL_W / 2;
          // A slow, faint drift so the field is never dead flat.
          let v = 0.1 + 0.08 * Math.sin(c * 0.21 + t * 3) * Math.cos(r * 0.27 - t * 2) + 0.05 * Math.sin((c + r) * 0.09 + t * 5);
          for (const ring of rings) {
            const age = now - ring.t0;
            const d = Math.hypot(x - ring.x, y - ring.y) - age * RING_SPEED;
            if (d > RING_WIDTH * 3 || d < -RING_WIDTH * 3) continue;
            const fade = 1 - age / RING_LIFE;
            v += ring.power * fade * fade * Math.exp(-(d * d) / (RING_WIDTH * RING_WIDTH));
          }
          if (v < 0.09) continue;
          v = Math.min(v, 1);
          const glyph = RAMP[Math.min(RAMP.length - 1, Math.floor(v * RAMP.length))]!;
          if (glyph === " ") continue;
          const m = Math.min(1, v * 1.4);
          ctx.fillStyle = `rgb(${mix(steel, ink, m)} / ${floor + span * v})`;
          ctx.fillText(glyph, x, y);
        }
      }
    };

    const frame = (now: number) => {
      if (now - lastIdle > IDLE_EVERY && now - lastPointer > IDLE_EVERY) {
        lastIdle = now;
        rings.push({ x: Math.random() * w, y: Math.random() * h, t0: now, power: 0.55 + Math.random() * 0.3 });
      }
      draw(now);
      raf = runRef.current ? requestAnimationFrame(frame) : 0;
    };

    const local = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onMove = (e: PointerEvent) => {
      const now = performance.now();
      lastPointer = now;
      if (now - lastTrail < TRAIL_EVERY) return;
      lastTrail = now;
      rings.push({ ...local(e), t0: now, power: 0.35 });
    };
    const onDown = (e: PointerEvent) => {
      const now = performance.now();
      lastPointer = now;
      rings.push({ ...local(e), t0: now, power: 1 });
    };

    size();
    const ro = new ResizeObserver(() => {
      size();
      if (!raf) draw(performance.now());
    });
    ro.observe(el);
    // Under reduced motion nothing listens and nothing loops: the field is drawn once and holds.
    const host = still ? null : target.current;
    host?.addEventListener("pointermove", onMove);
    host?.addEventListener("pointerdown", onDown);

    if (runRef.current && !still) raf = requestAnimationFrame(frame);
    else draw(performance.now());

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      host?.removeEventListener("pointermove", onMove);
      host?.removeEventListener("pointerdown", onDown);
    };
    // Restart on theme (new colours) and on running (resume the loop).
  }, [theme, running, target]);

  return <canvas ref={canvas} className="hero__glyphs" />;
}

function rgb(value: string, fallback: [number, number, number]): [number, number, number] {
  const hex = value.trim().match(/^#([0-9a-f]{6})$/i)?.[1];
  if (!hex) return fallback;
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function mix(a: [number, number, number], b: [number, number, number], k: number): string {
  return a.map((v, i) => Math.round(v + (b[i]! - v) * k)).join(" ");
}
