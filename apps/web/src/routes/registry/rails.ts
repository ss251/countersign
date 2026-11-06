import type { RailId } from "@countersign/core";

/** live: in the hub's /rails. listed: named in offers but not live. Null hub rails mean unknown: no grouping. */
export function railGroups(
  offerRails: RailId[],
  hubRailIds: readonly string[] | undefined,
): { live: RailId[]; listed: RailId[] } | null {
  if (hubRailIds === undefined) return null;
  const hub = new Set(hubRailIds);
  const live: RailId[] = [];
  const listed: RailId[] = [];
  for (const rail of new Set(offerRails)) {
    if (hub.has(rail)) live.push(rail);
    else listed.push(rail);
  }
  return { live, listed };
}
