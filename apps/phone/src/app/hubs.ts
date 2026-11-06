/**
 * Which hub this phone talks to. A link can name one with ?hub=, but only a hub this page can
 * trust: the hub it was built for, its own origin, or this device's loopback for development.
 * Anything else is ignored, because a hub decides which jobs reach the phone, and a stranger's
 * hub could ask for this phone's position with nobody paying.
 */

export const DEFAULT_HUB = "https://hub-production-e85e.up.railway.app";
export const DEFAULT_CONSOLE = "https://web-production-a58de.up.railway.app/";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export interface HubChoice {
  hub: string;
  /** A ?hub= this page refused, so the screen can say so. */
  ignored: string | null;
}

export function chooseHub(search: string, built: string | undefined): HubChoice {
  const fallback = built && built.trim() ? built.trim() : DEFAULT_HUB;
  const asked = new URLSearchParams(search).get("hub")?.trim();
  if (!asked) return { hub: fallback, ignored: null };
  return trusted(asked, fallback) ? { hub: asked, ignored: null } : { hub: fallback, ignored: asked };
}

function trusted(asked: string, fallback: string): boolean {
  if (asked.startsWith("/") && !asked.startsWith("//")) return true;
  let url: URL;
  try {
    url = new URL(asked);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (LOOPBACK.has(url.hostname)) return true;
  try {
    return url.origin === new URL(fallback).origin;
  } catch {
    return false;
  }
}
