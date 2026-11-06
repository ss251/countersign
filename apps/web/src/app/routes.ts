import type { ComponentType } from "react";

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
type Page = ComponentType<PageProps>;

// Eager on purpose: one bundle, one stylesheet, nothing to wait for on a cold load.
const modules = import.meta.glob<PageModule>("../routes/*/index.tsx", { eager: true });

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
  const mod = modules[key];
  if (!mod) return null;
  return { name, Page: mod.default, params: segments.slice(1), surface: PHONE.has(name) ? "phone" : "desk" };
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
