import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";

/*
 * A stage is a run of beats over one pinned frame: a sticky frame of one screen inside a stage of
 * `beats` screens. Native scroll only, no library and no change of speed; the beat is read from
 * the stage's position at most once a frame, and only a new beat re-renders anything.
 */

const REDUCE = "(prefers-reduced-motion: reduce)";
const NARROW = "(max-width: 720px)";

function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Asked for less motion: then nothing pins, and every beat is its own section. */
export const useReducedMotion = (): boolean => useMedia(REDUCE);

/** A phone: the diagram above its words. */
export const useNarrow = (): boolean => useMedia(NARROW);

/**
 * Beats are weighted in screens of scroll: a stage pins for the sum of its weights and is one screen
 * taller than that, so its frame scrolls away only after the last beat. An exit beat is short.
 */
export const span = (weights: readonly number[]): number => weights.reduce((a, b) => a + b, 0);

/**
 * Down to a beat: the middle of its stretch, so it never lands on a threshold. Unpinned, every beat
 * is its own section and this scrolls to it. Smooth unless less motion was asked for.
 */
export function toBeat(stage: HTMLElement | null, weights: readonly number[], beat: number): void {
  if (!stage) return;
  const behavior: ScrollBehavior = window.matchMedia(REDUCE).matches ? "auto" : "smooth";
  const frames = stage.querySelectorAll<HTMLElement>(":scope > [data-beat]");
  if (frames.length > 1) {
    frames[beat]?.scrollIntoView({ behavior, block: "start" });
    return;
  }
  const top = stage.getBoundingClientRect().top + window.scrollY;
  const range = stage.offsetHeight - window.innerHeight;
  const middle = (span(weights.slice(0, beat)) + (weights[beat] ?? 1) / 2) / span(weights);
  window.scrollTo({ top: top + range * middle, behavior });
}

/**
 * The beat and how far through it the reader is (0 to 1), read once a frame. Only a new beat
 * re-renders; the progress goes to `onFrame`, which writes styles straight onto elements, so the
 * drawing follows the scroll without React in the loop.
 */
export function useStageFrame(
  stage: RefObject<HTMLElement | null>,
  weights: readonly number[],
  pinned: boolean,
  onFrame: (beat: number, t: number) => void,
): number {
  const [beat, setBeat] = useState(0);
  const frameRef = useRef(onFrame);
  frameRef.current = onFrame;
  useEffect(() => {
    if (!pinned) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      if (!stage.current) return;
      const [b, t] = progressAt(stage.current, weights);
      setBeat(b);
      frameRef.current(b, t);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [stage, weights, pinned]);
  return beat;
}

/** The beat at the stage's scroll position, and the fraction of that beat already scrolled. */
export function progressAt(stage: HTMLElement, weights: readonly number[]): [number, number] {
  const box = stage.getBoundingClientRect();
  const range = box.height - window.innerHeight;
  const progress = range > 0 ? Math.min(1, Math.max(0, -box.top / range)) : 0;
  return beatProgress(progress, weights);
}

/** Pure: overall progress (0 to 1) to [beat, fraction through it]. */
export function beatProgress(progress: number, weights: readonly number[]): [number, number] {
  if (progress >= 1) return [weights.length - 1, 1];
  let left = Math.max(0, progress) * span(weights);
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i] ?? 1;
    if (left < w) return [i, w > 0 ? left / w : 1];
    left -= w;
  }
  return [weights.length - 1, 1];
}
