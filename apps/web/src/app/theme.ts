import { useCallback, useEffect, useSyncExternalStore } from "react";

/**
 * The theme follows the system until the visitor picks one with the toggle; the pick is kept in
 * this browser. "?theme=dark" or "?theme=light" after the route pins it over both, which is how
 * screenshots and the recorded demo choose a side. index.html applies the stored pick before
 * first paint, so a reload never flashes the other scheme.
 */

export type ThemeName = "light" | "dark";
export type ThemeChoice = ThemeName | "system";

export const THEME_KEY = "countersign:theme";
/** The paper of each theme, for the browser's status bar. Matches --paper in tokens.css. */
export const PAPER: Record<ThemeName, string> = { light: "#f4f5ff", dark: "#242124" };

const listeners = new Set<() => void>();

export function readStoredTheme(): ThemeChoice {
  try {
    const v = window.localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function writeStoredTheme(choice: ThemeChoice): void {
  try {
    if (choice === "system") window.localStorage.removeItem(THEME_KEY);
    else window.localStorage.setItem(THEME_KEY, choice);
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
  listeners.forEach((l) => l());
}

/** Which theme applies: a URL pin, then the stored pick, then the system. */
export function resolveTheme(requested: string | null, stored: ThemeChoice): ThemeChoice {
  if (requested === "dark" || requested === "light") return requested;
  if (stored !== "system") return stored;
  return "system";
}

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function subscribeSystem(onChange: () => void): () => void {
  listeners.add(onChange);
  const mq = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  mq?.addEventListener("change", onChange);
  return () => {
    listeners.delete(onChange);
    mq?.removeEventListener("change", onChange);
  };
}

/** Applies the theme to <html> and the status bar. Call once, from the shell. */
export function useTheme(requested: string | null): void {
  const stored = useSyncExternalStore(subscribeSystem, readStoredTheme, () => "system" as ThemeChoice);
  useEffect(() => {
    const root = document.documentElement;
    const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
    const choice = resolveTheme(requested, stored);
    if (choice !== "system") {
      root.dataset.theme = choice;
      // A pinned theme must pin the status bar too, or the phone shows the other scheme's colour.
      metas.forEach((m) => {
        m.dataset.media ??= m.media;
        m.media = "all";
        m.content = PAPER[choice];
      });
    } else {
      delete root.dataset.theme;
      metas.forEach((m) => {
        if (m.dataset.media) m.media = m.dataset.media;
        m.content = m.media.includes("dark") ? PAPER.dark : PAPER.light;
      });
    }
  }, [requested, stored]);
}

/** The theme in effect right now, and a toggle that flips it and remembers the pick. */
export function useThemeToggle(): { current: ThemeName; toggle: () => void } {
  const current = useSyncExternalStore(
    subscribeSystem,
    (): ThemeName => {
      const stored = readStoredTheme();
      return stored !== "system" ? stored : systemPrefersDark() ? "dark" : "light";
    },
    (): ThemeName => "dark",
  );
  const toggle = useCallback(() => {
    const next: ThemeName = current === "dark" ? "light" : "dark";
    // Back to following the system when the pick would match it anyway.
    writeStoredTheme(next === (systemPrefersDark() ? "dark" : "light") ? "system" : next);
  }, [current]);
  return { current, toggle };
}
