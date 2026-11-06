/**
 * The hub's routing glue: buyer caps from headers, the in-memory health record, the
 * recent-decision log, and the challenge pass that turns the pure policy into the
 * options a 402 can offer. The policy itself lives in @countersign/rail.
 */

import {
  chooseRail,
  offerHash,
  RAIL_IDS,
  type BuyerCaps,
  type Offer,
  type PaymentRequirements,
  type Rail,
  type RailHealth,
  type RailId,
  type RouteChoice,
  type RouteTrace,
  type RailTraceEntry,
} from "./deps.ts";

export const ROUTER_POLICY =
  "eligible by buyer rails and finality; healthy first, then lowest cost, then fastest finality, then rail id";

const ATTEMPT_WINDOW_SECONDS = 600;
const RECENT_LIMIT = 20;

export type RouteAttempt = RouteTrace["attempts"][number];

export interface Decision {
  at: number;
  offerHash: string;
  chosen: RailId | null;
  candidates: RailId[];
}

export interface ChallengeOption {
  entry: PaymentRequirements;
  rail: Rail;
}

export interface ChallengePlan {
  options: ChallengeOption[];
  route: RouteChoice;
}

export interface ChallengeHooks {
  caps?: BuyerCaps;
  health?: Record<string, RailHealth>;
  /** Rails to place after the others, e.g. one whose settle just failed for this offer. */
  demoted?: (railId: RailId) => boolean;
  onChallengeFailure?: (railId: RailId, error: unknown) => void;
  onDecision?: (decision: Decision) => void;
}

/**
 * Derive the challenge options and the route trace. Rails are challenged in policy order;
 * a rail whose challenge throws is removed and its trace entry says why. Demoted rails keep
 * their eligibility but move behind the rest.
 */
export function planChallenges(
  rails: Rail[],
  offer: Offer,
  resource: string,
  now: number,
  hooks: ChallengeHooks = {},
): ChallengePlan {
  const choice = chooseRail(
    offer,
    hooks.caps ?? {},
    rails.map((rail) => rail.declaration),
    hooks.health ?? {},
    now,
  );
  const configured = new Map<RailId, Rail>();
  for (const rail of rails) configured.set(rail.declaration.id, rail);
  const traceById = new Map<RailId, RailTraceEntry>();
  for (const entry of choice.trace) {
    if (!traceById.has(entry.rail)) traceById.set(entry.rail, entry);
  }

  const challenged = new Map<RailId, PaymentRequirements>();
  const surviving: RailId[] = [];
  const seen = new Set<RailId>();
  for (const id of choice.candidates) {
    if (seen.has(id)) continue;
    seen.add(id);
    const rail = configured.get(id);
    if (!rail) continue;
    try {
      challenged.set(id, rail.challenge(offer, { resource, now }));
      surviving.push(id);
    } catch (error) {
      const why = `challenge failed: ${firstLine(error)}`;
      const entry = traceById.get(id);
      if (entry) {
        entry.eligible = false;
        entry.why = why;
      }
      hooks.onChallengeFailure?.(id, error);
    }
  }

  const demoted = new Set<RailId>();
  if (hooks.demoted) {
    for (const id of surviving) {
      if (hooks.demoted(id)) demoted.add(id);
    }
  }
  const ordered = [
    ...surviving.filter((id) => !demoted.has(id)),
    ...surviving.filter((id) => demoted.has(id)),
  ];

  for (const entry of choice.trace) {
    if (!entry.eligible) continue;
    const rank = ordered.indexOf(entry.rail);
    if (rank === -1) continue;
    entry.why = rank === 0 ? "chosen" : `fallback ${rank}`;
  }

  const route: RouteChoice = {
    candidates: ordered,
    chosen: ordered[0] ?? null,
    reason: describeRoute(ordered, choice.trace, hooks.health ?? {}, now, demoted),
    trace: choice.trace,
  };

  const options: ChallengeOption[] = [];
  for (const id of ordered) {
    const rail = configured.get(id);
    const entry = challenged.get(id);
    if (rail && entry) options.push({ entry, rail });
  }

  hooks.onDecision?.({
    at: now,
    offerHash: offerHash(offer),
    chosen: route.chosen,
    candidates: [...route.candidates],
  });
  return { options, route };
}

/** The in-memory router state of one hub process. */
export class HubRouter {
  private readonly rails: Rail[];
  private readonly health = new Map<RailId, RailHealth>();
  private readonly attempts = new Map<string, RouteAttempt[]>();
  private readonly settleFailures = new Map<string, Map<RailId, number>>();
  private readonly recent: Decision[] = [];

  constructor(rails: Rail[]) {
    this.rails = rails;
  }

  /** The buyer's caps, read only from the two optional request headers. Malformed values are absent. */
  buyerCaps(headers: Headers): BuyerCaps {
    const caps: BuyerCaps = {};
    const rails = headers.get("X-Countersign-Rails");
    if (rails !== null) {
      const parsed = parseRails(rails);
      if (parsed !== null) caps.rails = parsed;
    }
    const max = headers.get("X-Countersign-Max-Finality");
    if (max !== null) {
      const parsed = parsePositiveInteger(max);
      if (parsed !== null) caps.maxFinalitySeconds = parsed;
    }
    return caps;
  }

  recordFailure(railId: RailId, now: number): void {
    const current = this.health.get(railId);
    this.health.set(railId, {
      failures: (current?.failures ?? 0) + 1,
      lastFailureAt: now,
    });
  }

  recordSuccess(railId: RailId): void {
    const current = this.health.get(railId);
    if (current) {
      current.failures = 0;
      return;
    }
    this.health.set(railId, { failures: 0, lastFailureAt: 0 });
  }

  recordAttempt(
    offerHash: string,
    payer: string,
    rail: RailId,
    outcome: RouteAttempt["outcome"],
    at: number,
  ): void {
    const key = attemptKey(offerHash, payer);
    const list = this.attempts.get(key) ?? [];
    list.push({ rail, outcome, at });
    this.attempts.set(key, list);

    if (outcome === "settle-failed") {
      const byRail = this.settleFailures.get(offerHash) ?? new Map<RailId, number>();
      byRail.set(rail, at);
      this.settleFailures.set(offerHash, byRail);
    } else if (outcome === "settled") {
      this.settleFailures.get(offerHash)?.delete(rail);
    }
    this.prune(at);
  }

  /** Recent attempts for one buyer on one offer, oldest first, including offer-level challenge failures. */
  attemptsFor(offerHash: string, payer: string, now: number): RouteAttempt[] {
    this.prune(now);
    const offerWide = this.attempts.get(attemptKey(offerHash, "")) ?? [];
    const buyer = this.attempts.get(attemptKey(offerHash, payer)) ?? [];
    return [...offerWide, ...buyer]
      .filter((attempt) => now - attempt.at <= ATTEMPT_WINDOW_SECONDS)
      .sort((a, b) => a.at - b.at);
  }

  challengeOptions(offer: Offer, resource: string, now: number, caps: BuyerCaps = {}): ChallengePlan {
    const hash = offerHash(offer);
    return planChallenges(this.rails, offer, resource, now, {
      caps,
      health: this.healthRecord(),
      demoted: (railId) => this.recentSettleFailure(hash, railId, now),
      onChallengeFailure: (railId, error) => {
        console.warn(`[hub] rail ${railId} challenge failed: ${firstLine(error)}`);
        this.recordFailure(railId, now);
        this.recordAttempt(hash, "", railId, "challenge-failed", now);
      },
      onDecision: (decision) => this.recordDecision(decision),
    });
  }

  healthz(): { policy: string; health: Record<string, RailHealth>; recent: Decision[] } {
    return {
      policy: ROUTER_POLICY,
      health: this.healthRecord(),
      recent: this.recent.map((decision) => ({ ...decision, candidates: [...decision.candidates] })),
    };
  }

  private healthRecord(): Record<string, RailHealth> {
    const record: Record<string, RailHealth> = {};
    for (const [id, state] of this.health) record[id] = { ...state };
    return record;
  }

  private recentSettleFailure(offerHash: string, railId: RailId, now: number): boolean {
    const at = this.settleFailures.get(offerHash)?.get(railId);
    return at !== undefined && now - at <= ATTEMPT_WINDOW_SECONDS;
  }

  private recordDecision(decision: Decision): void {
    this.recent.push(decision);
    if (this.recent.length > RECENT_LIMIT) this.recent.splice(0, this.recent.length - RECENT_LIMIT);
  }

  private prune(now: number): void {
    for (const [key, list] of this.attempts) {
      const kept = list.filter((attempt) => now - attempt.at <= ATTEMPT_WINDOW_SECONDS);
      if (kept.length === 0) this.attempts.delete(key);
      else this.attempts.set(key, kept);
    }
    for (const [offer, byRail] of this.settleFailures) {
      for (const [rail, at] of byRail) {
        if (now - at > ATTEMPT_WINDOW_SECONDS) byRail.delete(rail);
      }
      if (byRail.size === 0) this.settleFailures.delete(offer);
    }
  }
}

function attemptKey(offerHash: string, payer: string): string {
  return `${offerHash}:${payer.toLowerCase()}`;
}

function parseRails(raw: string): RailId[] | null {
  const parts = raw.split(",").map((part) => part.trim());
  if (parts.length === 0 || parts.some((part) => part === "")) return null;
  const rails: RailId[] = [];
  for (const part of parts) {
    if (!(RAIL_IDS as readonly string[]).includes(part)) return null;
    rails.push(part as RailId);
  }
  return rails;
}

function parsePositiveInteger(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function describeRoute(
  candidates: RailId[],
  trace: RailTraceEntry[],
  health: Record<string, RailHealth>,
  now: number,
  demoted: Set<RailId>,
): string {
  const chosen = candidates[0];
  if (chosen === undefined) return "no acceptable rail";
  const winner = trace.find((entry) => entry.rail === chosen);
  if (!winner) return `${chosen}: cheapest acceptable rail`;

  const blocked = candidates
    .slice(1)
    .map((id) => trace.find((entry) => entry.rail === id))
    .find((entry): entry is RailTraceEntry => entry !== undefined && preference(entry, winner) < 0);

  if (blocked) {
    if (isDegraded(blocked.rail, health, now)) {
      return `${chosen}: ${blocked.rail} failed twice in the last 10 minutes`;
    }
    if (demoted.has(blocked.rail)) {
      return `${chosen}: ${blocked.rail}'s settle failed recently`;
    }
  }

  const finality =
    winner.finalitySeconds === null ? "finality not declared" : `finality ${winner.finalitySeconds} s`;
  return `${chosen}: cheapest acceptable rail (cost ${winner.cost ?? "0"}, ${finality})`;
}

function preference(a: RailTraceEntry, b: RailTraceEntry): number {
  const aCost = BigInt(a.cost ?? "0");
  const bCost = BigInt(b.cost ?? "0");
  if (aCost !== bCost) return aCost < bCost ? -1 : 1;
  const aFinality = a.finalitySeconds ?? Number.POSITIVE_INFINITY;
  const bFinality = b.finalitySeconds ?? Number.POSITIVE_INFINITY;
  if (aFinality !== bFinality) return aFinality < bFinality ? -1 : 1;
  return a.rail < b.rail ? -1 : a.rail > b.rail ? 1 : 0;
}

function isDegraded(railId: RailId, health: Record<string, RailHealth>, now: number): boolean {
  const state = health[railId];
  return state !== undefined && state.failures >= 2 && now - state.lastFailureAt <= ATTEMPT_WINDOW_SECONDS;
}

function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n")[0]?.slice(0, 300) || "unknown error";
}
