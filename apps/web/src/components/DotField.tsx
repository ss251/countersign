import { useEffect, useRef } from "react";
import "./DotField.css";

/*
 * A quiet dot field behind the console. The dots are drawn here, not lifted from anywhere: one
 * canvas fixed to the viewport, a 22 px grid of 1.5 px dots at 12% ink, and a wide soft spotlight
 * that lifts the dots near it to at most twice that opacity. The spotlight follows a mouse, then
 * drifts on its own once the pointer has been still for three seconds. Nothing moves under
 * prefers-reduced-motion: the grid is drawn once and no frame is ever requested.
 */

const PITCH = 22;
const DOT_RADIUS = 0.75;
const BASE_ALPHA = 0.12;
const PEAK_SCALE = 2;
const SPOT_FLOOR = 240;
const SPOT_FRACTION = 0.55;
const FOLLOW_TAU_MS = 200;
const IDLE_MS = 3000;
const DRIFT_MS = 24000;
const FRAME_MS = 1000 / 30;
const RESIZE_DEBOUNCE_MS = 140;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** The slice of CanvasRenderingContext2D the field uses. */
export interface DotFieldContext {
  globalAlpha: number;
  fillStyle: string | CanvasGradient | CanvasPattern;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  clearRect(x: number, y: number, width: number, height: number): void;
  beginPath(): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
  fill(): void;
}

/** The slice of HTMLCanvasElement the field uses, so the driver can run without a DOM in tests. */
export interface DotFieldCanvas {
  width: number;
  height: number;
  getContext(contextId: "2d"): DotFieldContext | null;
}

/**
 * Everything outside the canvas that the driver touches. The browser implementation is below;
 * tests supply a small fake so the reduced-motion promise is checked, not assumed.
 */
export interface DotFieldEnvironment {
  reducedMotion(): boolean;
  requestFrame(callback: (time: number) => void): number;
  cancelFrame(handle: number): void;
  setTimer(callback: () => void, delay: number): number;
  clearTimer(handle: number): void;
  now(): number;
  viewport(): { width: number; height: number };
  pixelRatio(): number;
  hidden(): boolean;
  dotColor(): string;
  onPointerMove(handler: (x: number, y: number, pointerType: string) => void): () => void;
  onPointerGone(handler: () => void): () => void;
  onResize(handler: () => void): () => void;
  onVisibility(handler: () => void): () => void;
}

interface Dot {
  x: number;
  y: number;
}

function smoothstep(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped * clamped * (3 - 2 * clamped);
}

/**
 * Mount the field on a canvas. The returned function removes every listener and frame this mount
 * owns; it is safe to call after the component has gone.
 */
export function mountDotField(
  canvas: DotFieldCanvas,
  environment: DotFieldEnvironment = browserEnvironment(canvas),
): () => void {
  const drawing = canvas.getContext("2d");
  if (!drawing) return () => {};
  const context = drawing;

  let width = 0;
  let height = 0;
  let radius = 0;
  let grid: Dot[] = [];
  let frame = 0;
  let scheduled = false;
  let disposed = false;
  let lastFrameAt = 0;
  let resizeTimer: number | null = null;

  const centre = { x: 0, y: 0 };
  let pointer: { x: number; y: number } | null = null;
  let pointerAt = Number.NEGATIVE_INFINITY;

  const reduced = environment.reducedMotion();

  function layout(): void {
    const viewport = environment.viewport();
    width = Math.max(1, viewport.width);
    height = Math.max(1, viewport.height);
    const pixelRatio = Math.max(1, Math.min(environment.pixelRatio(), 2));

    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

    // Centre the grid so the gutters stay even at any viewport size.
    const columns = Math.max(1, Math.round(width / PITCH));
    const rows = Math.max(1, Math.round(height / PITCH));
    const left = (width - (columns - 1) * PITCH) / 2;
    const top = (height - (rows - 1) * PITCH) / 2;

    grid = [];
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        grid.push({ x: left + column * PITCH, y: top + row * PITCH });
      }
    }

    radius = Math.max(SPOT_FLOOR, Math.min(width, height) * SPOT_FRACTION);
    if (centre.x === 0 && centre.y === 0) {
      centre.x = width / 2;
      centre.y = height / 2;
    }
    centre.x = Math.min(width, Math.max(0, centre.x));
    centre.y = Math.min(height, Math.max(0, centre.y));
  }

  function draw(spotlight: { x: number; y: number } | null): void {
    context.clearRect(0, 0, width, height);
    context.fillStyle = environment.dotColor();

    for (const dot of grid) {
      let alpha = BASE_ALPHA;
      if (spotlight) {
        const distance = Math.hypot(dot.x - spotlight.x, dot.y - spotlight.y);
        const glow = smoothstep(1 - distance / radius);
        alpha = BASE_ALPHA * (1 + (PEAK_SCALE - 1) * glow);
      }
      context.globalAlpha = alpha;
      context.beginPath();
      context.arc(dot.x, dot.y, DOT_RADIUS, 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = 1;
  }

  function driftTarget(time: number): { x: number; y: number } {
    const angle = (time / DRIFT_MS) * Math.PI * 2;
    return {
      x: width / 2 + Math.cos(angle) * width * 0.22,
      y: height / 2 + Math.sin(angle) * height * 0.18,
    };
  }

  function update(delta: number, time: number): void {
    const idle = pointer === null || environment.now() - pointerAt >= IDLE_MS;
    const target = idle ? driftTarget(time) : pointer;
    if (!target) return;

    // Exponential easing with a 200 ms time constant covers ~95% of the distance in 600 ms.
    const ease = 1 - Math.exp(-Math.max(0, delta) / FOLLOW_TAU_MS);
    centre.x += (target.x - centre.x) * ease;
    centre.y += (target.y - centre.y) * ease;
  }

  function tick(time: number): void {
    scheduled = false;
    if (disposed) return;
    if (environment.hidden()) return;

    if (lastFrameAt === 0 || time - lastFrameAt >= FRAME_MS) {
      const delta = lastFrameAt === 0 ? 0 : Math.min(time - lastFrameAt, 100);
      lastFrameAt = time;
      update(delta, time);
      draw(centre);
    }
    frame = environment.requestFrame(tick);
    scheduled = true;
  }

  function start(): void {
    if (disposed || scheduled || environment.hidden()) return;
    lastFrameAt = 0;
    frame = environment.requestFrame(tick);
    scheduled = true;
  }

  function stop(): void {
    if (!scheduled) return;
    environment.cancelFrame(frame);
    scheduled = false;
  }

  layout();

  if (reduced) {
    draw(null);
    const offResize = environment.onResize(() => {
      if (resizeTimer !== null) environment.clearTimer(resizeTimer);
      resizeTimer = environment.setTimer(() => {
        resizeTimer = null;
        if (disposed) return;
        layout();
        draw(null);
      }, RESIZE_DEBOUNCE_MS);
    });
    return () => {
      disposed = true;
      if (resizeTimer !== null) environment.clearTimer(resizeTimer);
      offResize();
    };
  }

  const offPointerMove = environment.onPointerMove((x, y, pointerType) => {
    if (pointerType !== "mouse") return;
    pointer = { x, y };
    pointerAt = environment.now();
  });
  const offPointerGone = environment.onPointerGone(() => {
    pointer = null;
  });
  const offResize = environment.onResize(() => {
    if (resizeTimer !== null) environment.clearTimer(resizeTimer);
    resizeTimer = environment.setTimer(() => {
      resizeTimer = null;
      if (disposed) return;
      layout();
    }, RESIZE_DEBOUNCE_MS);
  });
  const offVisibility = environment.onVisibility(() => {
    if (environment.hidden()) stop();
    else start();
  });

  draw(centre);
  start();

  return () => {
    disposed = true;
    stop();
    if (resizeTimer !== null) environment.clearTimer(resizeTimer);
    offPointerMove();
    offPointerGone();
    offResize();
    offVisibility();
  };
}

function browserEnvironment(canvas: DotFieldCanvas): DotFieldEnvironment {
  const finePointer = window.matchMedia("(pointer: fine)");
  return {
    reducedMotion: () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    cancelFrame: (handle) => window.cancelAnimationFrame(handle),
    setTimer: (callback, delay) => window.setTimeout(callback, delay),
    clearTimer: (handle) => window.clearTimeout(handle),
    now: () => performance.now(),
    viewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
    pixelRatio: () => window.devicePixelRatio,
    hidden: () => document.visibilityState !== "visible",
    dotColor: () => getComputedStyle(canvas as HTMLCanvasElement).color,
    onPointerMove(handler) {
      const listener = (event: PointerEvent) => {
        if (!finePointer.matches || event.pointerType !== "mouse") return;
        handler(event.clientX, event.clientY, event.pointerType);
      };
      window.addEventListener("pointermove", listener, { passive: true });
      return () => window.removeEventListener("pointermove", listener);
    },
    onPointerGone(handler) {
      const listener = (event: PointerEvent) => {
        const leftWindow = event.type === "pointerout" && event.relatedTarget === null;
        const touchReleased = event.type === "pointerup" && event.pointerType !== "mouse";
        if (leftWindow || touchReleased) handler();
      };
      const blur = () => handler();
      window.addEventListener("pointerup", listener, { capture: true, passive: true });
      window.addEventListener("pointerout", listener, { capture: true, passive: true });
      window.addEventListener("blur", blur);
      return () => {
        window.removeEventListener("pointerup", listener, { capture: true });
        window.removeEventListener("pointerout", listener, { capture: true });
        window.removeEventListener("blur", blur);
      };
    },
    onResize(handler) {
      window.addEventListener("resize", handler, { passive: true });
      return () => window.removeEventListener("resize", handler);
    },
    onVisibility(handler) {
      document.addEventListener("visibilitychange", handler);
      return () => document.removeEventListener("visibilitychange", handler);
    },
  };
}

export function DotField() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvas.current) return;
    return mountDotField(canvas.current);
  }, []);

  return <canvas ref={canvas} className="dot-field" aria-hidden="true" />;
}
