import type { RailId } from "@countersign/core";
import { RAIL_LABEL } from "../../lib/format.ts";

/** live: every rail in the hub's /rails. listed: named in offers but not live. Null hub rails mean unknown: no grouping. */
export function railGroups(
  offerRails: RailId[],
  hubRailIds: readonly string[] | undefined,
): { live: RailId[]; listed: RailId[] } | null {
  if (hubRailIds === undefined) return null;
  const live = [...new Set(hubRailIds)].filter((id): id is RailId => Object.hasOwn(RAIL_LABEL, id));
  const inHub = new Set<RailId>(live);
  const listed = [...new Set(offerRails)].filter((rail) => !inHub.has(rail));
  return { live, listed };
}
