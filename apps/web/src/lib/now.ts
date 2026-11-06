import { useEffect, useState } from "react";
import { nowUnix } from "./format.ts";

/** The time in unix seconds, ticking while the tab is visible, so "4 min ago" stays true on an open page. */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(nowUnix);
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") setNow(nowUnix());
    }, everyMs);
    return () => window.clearInterval(id);
  }, [everyMs]);
  return now;
}
