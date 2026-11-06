import type { Listing } from "../../lib/types.ts";
import { RAIL_LABEL } from "../../lib/format.ts";

/**
 * The assistant's search: rank the hub's live offers against what a person typed, and say why
 * each one fits. Plain term matching, weighted by where the word appears. No model, nothing
 * invented: every reason points at text the seller published.
 */

export interface Match {
  listing: Listing;
  score: number;
  /** Plain sentences, strongest first. */
  why: string[];
}

const STOP = new Set([
  "a", "an", "and", "the", "to", "for", "of", "on", "in", "with", "my", "me", "i", "need", "want", "how", "do",
  "can", "you", "help", "please", "some", "something", "that", "this", "it", "is", "be", "get", "make", "find",
]);

export function terms(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !STOP.has(t)))];
}

const has = (text: string, term: string) => new RegExp(`(^|[^a-z0-9])${term}`, "i").test(text);

export function rank(listings: Listing[], query: string, limit = 3): Match[] {
  const wanted = terms(query);
  if (wanted.length === 0) return [];
  const out: Match[] = [];
  for (const listing of listings) {
    if (listing.status !== "listed") continue;
    const { offer } = listing;
    const inTitle = wanted.filter((t) => has(offer.title, t));
    const inSummary = wanted.filter((t) => !inTitle.includes(t) && has(offer.summary, t));
    const railText = offer.rails.map((r) => `${r} ${RAIL_LABEL[r]}`).join(" ");
    const inRails = wanted.filter((t) => !inTitle.includes(t) && !inSummary.includes(t) && has(railText, t));
    const inSource = wanted.filter(
      (t) => !inTitle.includes(t) && !inSummary.includes(t) && !inRails.includes(t) && offer.upstream && has(offer.upstream.url, t),
    );
    const score = inTitle.length * 3 + inSummary.length * 2 + inRails.length + inSource.length + (listing.online ? 0.5 : 0);
    if (inTitle.length + inSummary.length + inRails.length + inSource.length === 0) continue;
    const why: string[] = [];
    if (inTitle.length) why.push(`Its name matches ${quoteList(inTitle)}.`);
    if (inSummary.length) why.push(`Its description mentions ${quoteList(inSummary)}.`);
    if (inRails.length) why.push(`It settles on ${offer.rails.map((r) => RAIL_LABEL[r]).join(" or ")}.`);
    if (inSource.length) why.push(`It comes from ${offer.upstream!.url.replace(/^https?:\/\//, "")}.`);
    if (listing.online) why.push("Its runner is online now.");
    out.push({ listing, score, why });
  }
  return out.sort((a, b) => b.score - a.score || a.listing.offer.title.localeCompare(b.listing.offer.title)).slice(0, limit);
}

function quoteList(words: string[]): string {
  const q = words.map((w) => `“${w}”`);
  return q.length <= 1 ? (q[0] ?? "") : `${q.slice(0, -1).join(", ")} and ${q.at(-1)}`;
}
