import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";

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

/** A phone: the statement over its evidence, and the marks in their narrow places. */
export const useNarrow = (): boolean => useMedia(NARROW);

export function useBeat(stage: RefObject<HTMLElement | null>, beats: number, pinned: boolean): number {
  const [beat, setBeat] = useState(0);
  useEffect(() => {
    if (!pinned) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      if (stage.current) setBeat(beatAt(stage.current, beats));
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
  }, [stage, beats, pinned]);
  return beat;
}

function beatAt(stage: HTMLElement, beats: number): number {
  const box = stage.getBoundingClientRect();
  const range = box.height - window.innerHeight;
  const progress = range > 0 ? Math.min(1, Math.max(0, -box.top / range)) : 0;
  return Math.min(beats - 1, Math.floor(progress * beats));
}

/**
 * Down to a beat: the middle of its stretch, so it never lands on a threshold. Unpinned, every beat
 * is its own section and this scrolls to it. Smooth unless less motion was asked for.
 */
export function toBeat(stage: HTMLElement | null, beats: number, beat: number): void {
  if (!stage) return;
  const behavior: ScrollBehavior = window.matchMedia(REDUCE).matches ? "auto" : "smooth";
  const frames = stage.querySelectorAll<HTMLElement>(":scope > [data-beat]");
  if (frames.length > 1) {
    frames[beat]?.scrollIntoView({ behavior, block: "start" });
    return;
  }
  const top = stage.getBoundingClientRect().top + window.scrollY;
  const range = stage.offsetHeight - window.innerHeight;
  window.scrollTo({ top: top + (range * (beat + 0.5)) / beats, behavior });
}

/** The element's own height in px, kept current; layers that stack under it read it as a CSS variable. */
export function useHeight(el: RefObject<HTMLElement | null>): number {
  const [h, setH] = useState(0);
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const watch = new ResizeObserver(([entry]) => {
      if (entry) setH(Math.round(entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height));
    });
    watch.observe(node);
    return () => watch.disconnect();
  }, [el]);
  return h;
}
