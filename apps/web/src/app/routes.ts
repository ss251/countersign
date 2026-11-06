import { lazy, type ComponentType, type LazyExoticComponent } from "react";

/**
 * Routes are folders. "/offer/abc" loads routes/offer/index.tsx with params ["abc"];
 * "/" loads routes/home. A lane adds a screen by adding a folder, so cs-wc's
 * routes/merchant needs no change here.
 */

export interface PageProps {
  params: string[];
  query: URLSearchParams;
}

type PageModule = { default: ComponentType<PageProps> };
type Page = LazyExoticComponent<ComponentType<PageProps>>;

const modules = import.meta.glob<PageModule>("../routes/*/index.tsx");
const cache = new Map<string, Page>();

/** Screens designed for a phone at 390 px. Everything else is a desktop surface. */
const PHONE = new Set(["buyer"]);

export interface Resolved {
  name: string;
  Page: Page;
  params: string[];
  surface: "phone" | "desk";
}

export function resolve(segments: string[]): Resolved | null {
  const name = segments[0] ?? "home";
  if (!/^[a-z][a-z0-9-]*$/.test(name)) return null;
  const key = `../routes/${name}/index.tsx`;
  const load = modules[key];
  if (!load) return null;
  let Page = cache.get(key);
  if (!Page) {
    Page = lazy(load);
    cache.set(key, Page);
  }
  return { name, Page, params: segments.slice(1), surface: PHONE.has(name) ? "phone" : "desk" };
}

export function hasRoute(name: string): boolean {
  return `../routes/${name}/index.tsx` in modules;
}

/** Top-level views, in the order they are shown in navigation. */
export const VIEWS = [
  { name: "buyer", label: "Buyer" },
  { name: "seller", label: "Seller" },
  { name: "merchant", label: "Merchant" },
  { name: "registry", label: "Registry" },
  { name: "verify", label: "Verify" },
  { name: "demo", label: "Demo" },
] as const;
