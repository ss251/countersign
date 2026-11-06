import type { RailId } from "./types.ts";

/** What an offer rail reads when this hub does not settle it. */
export const NOT_LIVE = "listed, not live on this hub";

/**
 * Split an offer's rails by what this hub actually settles. Live rails keep the offer's order and
 * appear once; everything else is listed. Undefined hub rails mean unknown, so no claim is made.
 */
export function liveSplit(
  offerRails: RailId[],
  hubRailIds: readonly string[] | undefined,
): { live: RailId[]; listed: RailId[] } | null {
  if (hubRailIds === undefined) return null;
  const hub = new Set(hubRailIds);
  const live: RailId[] = [];
  const listed: RailId[] = [];
  const seen = new Set<RailId>();
  for (const rail of offerRails) {
    if (seen.has(rail)) continue;
    seen.add(rail);
    if (hub.has(rail)) live.push(rail);
    else listed.push(rail);
  }
  return { live, listed };
}
