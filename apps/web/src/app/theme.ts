import { useEffect } from "react";

/**
 * The theme follows the system. "?theme=dark" or "?theme=light" after the route
 * pins it, which is how screenshots and the recorded demo choose a side.
 */
export function useTheme(requested: string | null): void {
  useEffect(() => {
    const root = document.documentElement;
    if (requested === "dark" || requested === "light") {
      root.dataset.theme = requested;
    } else {
      delete root.dataset.theme;
    }
  }, [requested]);
}
