import { AmountError, parseUnits, type RailId } from "@countersign/core";
import { symbolFor } from "../../lib/format.ts";
import type { Purchase } from "../../lib/types.ts";

/**
 * Where each rail sits in the wizard. `satisfies Record<RailId, number>` makes this exhaustive:
 * a rail added to core fails the build here until it is ranked, so it can never go missing.
 */
const RAIL_RANK = {
  escrow: 0,
  gateway: 1,
  eip3009: 2,
  whitechain: 3,
  hedera: 4,
  "hedera-scheduled": 5,
  mpp: 6,
  erc8183: 7,
} satisfies Record<RailId, number>;

/** The rails a seller may tick, in the order the wizard shows them. */
export const RAIL_ORDER: readonly RailId[] = (Object.keys(RAIL_RANK) as RailId[]).sort((a, b) => RAIL_RANK[a] - RAIL_RANK[b]);

export const SKILL_NO_FRONT_MATTER = "This file has no front matter. A SKILL.md starts with --- and a name.";
export const SKILL_NO_NAME = "The front matter needs a name.";
export const PRICE_FORMAT_ERROR = "Enter a price like 0.05, with at most 6 decimals.";
export const PRICE_ZERO_ERROR = "The price must be above zero.";
export const DEADLINE_ERROR = "The deadline must be between 10 seconds and 7 days.";
export const RAILS_ERROR = "Pick at least one rail.";
export const UPSTREAM_PAIR_ERROR = "Upstream URL and licence go together.";

const FRONT_MATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const DEADLINE_SECONDS = /^\d+$/;
const MIN_DEADLINE = 10;
const MAX_DEADLINE = 604_800;

export interface ParsedSkill {
  name: string;
  summary: string;
  body: string;
}

export type ParseSkillResult = ({ ok: true } & ParsedSkill) | { ok: false; error: string };

/** Read the simple front matter the runner reads: one `key: value` per line. */
export function parseSkill(text: string): ParseSkillResult {
  const match = FRONT_MATTER.exec(text);
  if (!match) return { ok: false, error: SKILL_NO_FRONT_MATTER };

  const fields = parseFrontMatter(match[1] ?? "");
  const name = fields.get("name")?.trim() ?? "";
  if (!name) return { ok: false, error: SKILL_NO_NAME };

  return {
    ok: true,
    name,
    summary: fields.get("description")?.trim() ?? "",
    body: text.slice(match[0].length).replace(/^\r?\n/, ""),
  };
}

export type PriceResult = { ok: true; atomic: string } | { ok: false; error: string };

/** A decimal price in a 6-decimal stablecoin, as the runner takes it: atomic digits. */
export function priceToAtomic(value: string): PriceResult {
  let atomic: bigint;
  try {
    atomic = parseUnits(value.trim(), 6);
  } catch (error) {
    if (error instanceof AmountError) return { ok: false, error: PRICE_FORMAT_ERROR };
    throw error;
  }
  if (atomic === 0n) return { ok: false, error: PRICE_ZERO_ERROR };
  return { ok: true, atomic: atomic.toString() };
}

export type DeadlineResult = { ok: true; seconds: number } | { ok: false; error: string };

export function parseDeadline(value: string): DeadlineResult {
  const trimmed = value.trim();
  if (!DEADLINE_SECONDS.test(trimmed)) return { ok: false, error: DEADLINE_ERROR };
  const seconds = Number(trimmed);
  if (!Number.isSafeInteger(seconds) || seconds < MIN_DEADLINE || seconds > MAX_DEADLINE) {
    return { ok: false, error: DEADLINE_ERROR };
  }
  return { ok: true, seconds };
}

/** Tick or untick a rail while keeping the canonical order, so rails[0] is preferred. */
export function toggleRail(rails: readonly RailId[], rail: RailId): RailId[] {
  const checked = rails.includes(rail);
  return RAIL_ORDER.filter((candidate) => (candidate === rail ? !checked : rails.includes(candidate)));
}

export interface OfferDraft {
  title: string;
  summary: string;
  price: string;
  deadline: number;
  rails: RailId[];
  upstream?: { url: string; licence: string };
  /** Atomic. Absent is 0, which is all the runner publishes today. */
  bond?: string;
  /** Escrow v2 seconds, 0 to 86400. Absent is 0. */
  reviewWindow?: number;
}

/** The captain's rule (23:25 IST), held by the contract, core and the hub as well: a bond implies a review window. */
/** The smallest window a bonded offer may take: the same line as the contract (orch-cs, 18:18Z, with #164). */
export const MIN_BONDED_WINDOW = 60;
export const BOND_NEEDS_WINDOW = "A bond needs a review window of at least 60 seconds, so set that first.";
export const WINDOW_RANGE = "A review window is 0 to 86,400 seconds.";

/** Why these bond terms cannot be published, or null when they can. */
export function bondTermsError(bond: string | undefined, reviewWindow: number | undefined): string | null {
  const window = reviewWindow ?? 0;
  if (!Number.isInteger(window) || window < 0 || window > 86_400) return WINDOW_RANGE;
  const atomic = bond === undefined || bond === "" ? 0n : BigInt(bond);
  if (atomic > 0n && window < MIN_BONDED_WINDOW) return BOND_NEEDS_WINDOW;
  return null;
}

/**
 * The offer the runner will build, with the seller left for the runner to fill in. It can never carry a
 * bond without a review window: such a draft is refused here, so the wizard cannot express it.
 */
export function offerPreview(draft: OfferDraft): Record<string, unknown> {
  const problem = bondTermsError(draft.bond, draft.reviewWindow);
  if (problem) throw new Error(problem);
  const offer: Record<string, unknown> = {
    v: 1,
    seller: "<your address>",
    title: draft.title,
    summary: draft.summary,
    adapter: "skill",
    price: draft.price,
    deadline: draft.deadline,
    rails: draft.rails,
    bond: draft.bond || "0",
  };
  if (draft.reviewWindow) offer.reviewWindow = draft.reviewWindow;
  if (draft.upstream) offer.upstream = draft.upstream;
  return offer;
}

export interface CommandOptions {
  hub: string;
  price: string;
  deadline: number;
  rails: RailId[];
  upstreamUrl?: string;
  licence?: string;
}

export function publishCommand(options: CommandOptions): string {
  return runnerCommand("publish", options);
}

export function serveCommand(options: CommandOptions): string {
  return runnerCommand("serve", options);
}

/** A chosen hub that is not absolute is reached through this origin. */
export function absoluteHub(known: string | null, origin: string): string {
  if (!known) return origin;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(known)) return known.replace(/\/+$/, "");
  return `${origin.replace(/\/+$/, "")}/${known.replace(/^\/+/, "")}`.replace(/\/+$/, "");
}

export interface ReleaseTotal {
  symbol: string;
  atomic: string;
}

/** Sum released calls per asset symbol, in symbol order. */
export function releaseTotals(purchases: readonly Purchase[]): ReleaseTotal[] {
  const sums = new Map<string, bigint>();
  for (const purchase of purchases) {
    if (purchase.status !== "released") continue;
    const symbol = symbolFor(purchase.rail);
    sums.set(symbol, (sums.get(symbol) ?? 0n) + BigInt(purchase.amount));
  }
  return [...sums.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([symbol, atomic]) => ({ symbol, atomic: atomic.toString() }));
}

function runnerCommand(verb: "publish" | "serve", options: CommandOptions): string {
  const parts = [
    "bun",
    "packages/runner/src/cli.ts",
    verb,
    "--hub",
    quoteIfSpaced(options.hub),
    "--skill",
    "./SKILL.md",
    "--price",
    options.price,
    "--deadline",
    String(options.deadline),
    "--rails",
    options.rails.join(","),
  ];
  if (options.upstreamUrl && options.licence) {
    parts.push("--upstream-url", quoteIfSpaced(options.upstreamUrl), "--licence", quoteIfSpaced(options.licence));
  }
  return parts.join(" ");
}

/**
 * Quote any value a shell could misread: spaces, and also &, ?, ;, $, * and friends, which
 * real upstream URLs carry. Plain values stay bare so the command reads cleanly.
 */
function quoteIfSpaced(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function parseFrontMatter(raw: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    fields.set(key, value);
  }
  return fields;
}
