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

/**
 * phone: a 390 px screen that draws its own chrome (the buyer).
 * desk:  the shared top bar and a desktop layout.
 * bare:  no app chrome at all, for pages a customer opens, like a receipt.
 */
export type Surface = "phone" | "desk" | "bare";

type PageModule = {
  default: ComponentType<PageProps>;
  /** A route may declare its surface, per sub-path: export const surface = (params) => ... */
  surface?: Surface | ((params: string[]) => Surface);
};
type Page = ComponentType<PageProps>;

// Eager on purpose: one bundle, one stylesheet, nothing to wait for on a cold load.
const modules = import.meta.glob<PageModule>("../routes/*/index.tsx", { eager: true });

/** Screens designed for a phone at 390 px. Everything else is a desktop surface. */
const PHONE = new Set(["buyer"]);

export interface Resolved {
  name: string;
  Page: Page;
  params: string[];
  surface: Surface;
}

export function resolve(segments: string[]): Resolved | null {
  const name = segments[0] ?? "home";
  if (!/^[a-z][a-z0-9-]*$/.test(name)) return null;
  const key = `../routes/${name}/index.tsx`;
  const mod = modules[key];
  if (!mod) return null;
  const params = segments.slice(1);
  const declared = typeof mod.surface === "function" ? mod.surface(params) : mod.surface;
  return { name, Page: mod.default, params, surface: declared ?? (PHONE.has(name) ? "phone" : "desk") };
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
