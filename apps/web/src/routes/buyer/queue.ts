import type { Approval } from "../../lib/types.ts";

/**
 * The hub's pending requests in its order (newest first), behind the request on screen and any
 * this phone has countersigned and is still following, so nothing moves under the thumb. A request
 * closed on this phone never comes back from a poll that raced the decision.
 */
export function mergeApprovals(prev: Approval[], next: Approval[], following: Set<string>, closed: Set<string>): Approval[] {
  const fresh = new Set(next.map((a) => a.id));
  const head = prev[0];
  const pinned = prev.filter((a) => following.has(a.id) || (a === head && fresh.has(a.id) && !closed.has(a.id)));
  const ids = new Set(pinned.map((a) => a.id));
  return [...pinned, ...next.filter((a) => !closed.has(a.id) && !ids.has(a.id))];
}
