import { useMemo, useSyncExternalStore, type AnchorHTMLAttributes } from "react";

/**
 * Hash router. Routes live after the "#", so the built app is a folder of
 * static files that works from any host and any path, including file://.
 */

export interface Location {
  /** "/offer/abc" */
  path: string;
  /** ["offer", "abc"] */
  segments: string[];
  query: URLSearchParams;
}

function readHash(): string {
  const hash = window.location.hash;
  return hash.startsWith("#") ? hash.slice(1) : hash;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

export function parseLocation(raw: string): Location {
  const q = raw.indexOf("?");
  const pathPart = q === -1 ? raw : raw.slice(0, q);
  const queryPart = q === -1 ? "" : raw.slice(q + 1);
  const segments = pathPart
    .split("/")
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });
  return { path: `/${segments.join("/")}`, segments, query: new URLSearchParams(queryPart) };
}

export function useLocation(): Location {
  const raw = useSyncExternalStore(subscribe, readHash, () => "/");
  return useMemo(() => parseLocation(raw), [raw]);
}

export function href(to: string): string {
  return `#${to.startsWith("/") ? to : `/${to}`}`;
}

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  const target = href(to);
  if (options.replace) {
    window.history.replaceState(window.history.state, "", target);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    window.location.hash = target;
  }
}

type LinkProps = { to: string } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">;

export function Link({ to, ...rest }: LinkProps) {
  return <a href={href(to)} {...rest} />;
}
