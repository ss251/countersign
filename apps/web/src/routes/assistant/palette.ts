import type { EnvelopeDecision } from "@countersign/core";
import type { Listing } from "../../lib/types.ts";
import { rank, type Match } from "../buyer/assistant.ts";

/** What the envelope says about one match: refused, inside, or inside but above the ask threshold. */
export type Verdict = { decision: EnvelopeDecision; asks: boolean } | null;

export type GroupId = "fits" | "needs" | "refused" | "unchecked";

export interface Group {
  id: GroupId;
  label: string;
  rows: Match[];
}

/**
 * The palette's sections, in the envelope's own words and in the order a person acts on them:
 * what the agent may buy alone, what needs a countersignature, what the envelope refuses. Matches
 * with no envelope to read yet sit in one plain group. Empty groups are left out.
 */
export function groupMatches(matches: Match[], verdictOf: (m: Match) => Verdict): Group[] {
  const groups: Record<GroupId, Match[]> = { fits: [], needs: [], refused: [], unchecked: [] };
  for (const m of matches) {
    const v = verdictOf(m);
    groups[!v ? "unchecked" : !v.decision.ok ? "refused" : v.asks ? "needs" : "fits"].push(m);
  }
  const label: Record<GroupId, string> = {
    fits: "Fits your envelope",
    needs: "Needs your countersignature",
    refused: "Refused by your envelope",
    unchecked: "Matches",
  };
  return (["fits", "needs", "refused", "unchecked"] as const).filter((id) => groups[id].length > 0).map((id) => ({ id, label: label[id], rows: groups[id] }));
}

/** The rows the arrow keys move through: everything but a refusal, which can only be read or allowed. */
export function selectable(groups: Group[]): Match[] {
  return groups.filter((g) => g.id !== "refused").flatMap((g) => g.rows);
}

/** One plain sentence per row: the strongest reason, capitalised and closed. Never a list of raw matches. */
export function plainReason(why: string[]): string {
  const first = why.map((w) => w.trim()).find(Boolean);
  if (!first) return "";
  return `${first.charAt(0).toUpperCase()}${first.slice(1)}${/[.!?]$/.test(first) ? "" : "."}`;
}

/** Three needs that each hit a real offer on this hub, with the offer they hit. */
export function exampleNeeds(listings: Listing[]): Array<{ need: string; hits: Listing }> {
  const listed = listings.filter((l) => l.status === "listed");
  const candidates: string[] = [];
  if (listed.some((l) => /\barc\b/i.test(`${l.offer.title} ${l.offer.summary}`))) candidates.push("deploy a contract on arc");
  // A need is what a person would type: the title's head before any colon, at most four words, never the
  // whole marketing title, so the card under it can say what it finds without repeating it.
  for (const l of listed) candidates.push(needOf(l.offer.title));
  const out: Array<{ need: string; hits: Listing }> = [];
  const used = new Set<string>();
  for (const need of candidates) {
    if (out.length >= 3) break;
    const top = rank(listed, need, 1)[0];
    if (!top || used.has(top.listing.hash) || out.some((x) => x.need === need)) continue;
    used.add(top.listing.hash);
    out.push({ need, hits: top.listing });
  }
  return out;
}

/** "Hedera Agent Kit: an HBAR transfer, built for you to sign" reads as "hedera agent kit". */
export function needOf(title: string): string {
  const head = (title.split(":")[0] ?? title).replace(/[-_]+/g, " ").trim().toLowerCase();
  return head.split(/\s+/).slice(0, 4).join(" ");
}

/** The modifier people press for ⌘K: Cmd on Apple platforms, Ctrl elsewhere. */
export function modKey(platform = typeof navigator === "undefined" ? "" : navigator.platform): "⌘" | "Ctrl" {
  return /mac|iphone|ipad|ipod/i.test(platform) ? "⌘" : "Ctrl";
}
