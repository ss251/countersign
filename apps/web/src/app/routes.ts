import type { ComponentType } from "react";
import type { NavGroup } from "./nav.ts";

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
 * story: the landing, a full-bleed scroll under the same shared top bar as every desk screen.
 */
export type Surface = "phone" | "desk" | "bare" | "story";

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

/**
 * Top-level views, in navigation order. The public console shows only finished screens:
 * a view joins the navigation when it is marked ready and its route folder exists.
 */
const ALL_VIEWS = [
  { name: "buyer", label: "Buyer", ready: true, group: "buy" },
  { name: "assistant", label: "Assistant", ready: true, group: "buy" },
  { name: "seller", label: "Seller", ready: true, group: "sell" },
  { name: "merchant", label: "Merchant", ready: true, group: "sell" },
  { name: "developers", label: "Developers", ready: true, group: "sell" },
  { name: "registry", label: "Registry", ready: true, group: "check" },
  { name: "verify", label: "Verify", ready: true, group: "check" },
] as const satisfies readonly { name: string; label: string; ready: boolean; group: NavGroup }[];

export const VIEWS = ALL_VIEWS.filter((v) => v.ready && hasRoute(v.name));

