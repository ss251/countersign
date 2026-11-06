import { useEffect } from "react";

/**
 * The theme follows the system. "?theme=dark" or "?theme=light" after the route
 * pins it, which is how screenshots and the recorded demo choose a side.
 */
export function useTheme(requested: string | null): void {
  useEffect(() => {
    const root = document.documentElement;
    const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
    if (requested === "dark" || requested === "light") {
      root.dataset.theme = requested;
      // A pinned theme must pin the status bar too, or the phone shows the other scheme's colour.
      const paper = requested === "dark" ? "#121210" : "#f3f0e9";
      metas.forEach((m) => {
        m.dataset.media ??= m.media;
        m.media = "all";
        m.content = paper;
      });
    } else {
      delete root.dataset.theme;
      metas.forEach((m) => {
        if (m.dataset.media) m.media = m.dataset.media;
        m.content = m.media.includes("dark") ? "#121210" : "#f3f0e9";
      });
    }
  }, [requested]);
}
