/**
 * The rail router: a pure, deterministic policy that picks the cheapest acceptable rail.
 *
 * It knows nothing about chains or payments. It reads declarations, the buyer's caps and
 * the hub's health record, and returns every rail it considered with the reason each one
 * won or lost, so the hub can show the same trace on a 402 and on the slip.
 */

import type { Offer, RailId } from "@countersign/core";
import type { RailDeclaration } from "./rail.ts";

export interface BuyerCaps {
  /** Rails the buyer says it can pay. Absent means any rail this hub runs. */
  rails?: RailId[];
  /** The slowest finality the buyer accepts, in seconds. Absent means no limit. */
  maxFinalitySeconds?: number;
}

export interface RailHealth {
  failures: number;
  /** Unix seconds. */
  lastFailureAt: number;
}

export interface RailTraceEntry {
  rail: RailId;
  eligible: boolean;
  cost: string | null;
  finalitySeconds: number | null;
  why: string;
}

export interface RouteChoice {
  candidates: RailId[];
  chosen: RailId | null;
  reason: string;
  trace: RailTraceEntry[];
}

const DEGRADED_FAILURES = 2;
const DEGRADED_WINDOW_SECONDS = 600;

interface Candidate {
  id: RailId;
  cost: bigint;
  costText: string;
  finalitySeconds: number | null;
  degraded: boolean;
}

/**
 * Pick the cheapest eligible rail. Healthy rails come before degraded ones, then cost,
 * then finality (undeclared last), then rail id. One trace entry is produced per rail id
 * in offer.rails, in offer order.
 */
export function chooseRail(
  offer: Offer,
  caps: BuyerCaps,
  rails: RailDeclaration[],
  health: Record<string, RailHealth>,
  now: number,
): RouteChoice {
  const declarations = new Map<RailId, RailDeclaration>();
  for (const declaration of rails) declarations.set(declaration.id, declaration);
  const allowed = caps.rails === undefined ? null : new Set<RailId>(caps.rails);

  const trace: RailTraceEntry[] = [];
  const candidates: Candidate[] = [];

  for (const id of offer.rails) {
    const declaration = declarations.get(id);
    if (!declaration) {
      trace.push({
        rail: id,
        eligible: false,
        cost: null,
        finalitySeconds: null,
        why: "this hub does not run it",
      });
      continue;
    }

    const costText = costOf(offer.price, declaration.cost);
    const finalitySeconds = declaration.finalitySeconds ?? null;

    if (allowed && !allowed.has(id)) {
      trace.push({
        rail: id,
        eligible: false,
        cost: costText,
        finalitySeconds,
        why: "the buyer cannot pay it",
      });
      continue;
    }

    if (caps.maxFinalitySeconds !== undefined) {
      if (finalitySeconds === null) {
        trace.push({ rail: id, eligible: false, cost: costText, finalitySeconds, why: "finality is not declared" });
        continue;
      }
      if (finalitySeconds > caps.maxFinalitySeconds) {
        trace.push({
          rail: id,
          eligible: false,
          cost: costText,
          finalitySeconds,
          why: `finality ${finalitySeconds} s is slower than the buyer's ${caps.maxFinalitySeconds} s`,
        });
        continue;
      }
    }

    const state = health[id];
    const degraded =
      state !== undefined && state.failures >= DEGRADED_FAILURES && now - state.lastFailureAt <= DEGRADED_WINDOW_SECONDS;
    trace.push({ rail: id, eligible: true, cost: costText, finalitySeconds, why: "" });
    candidates.push({ id, cost: BigInt(costText), costText, finalitySeconds, degraded });
  }

  candidates.sort(compareCandidates);
  const order = candidates.map((candidate) => candidate.id);
  const ranks = new Map<RailId, number>();
  for (let index = 0; index < order.length; index += 1) {
    const id = order[index];
    if (id !== undefined && !ranks.has(id)) ranks.set(id, index);
  }
  for (const entry of trace) {
    if (!entry.eligible) continue;
    const rank = ranks.get(entry.rail);
    if (rank === undefined) continue;
    entry.why = rank === 0 ? "chosen" : `fallback ${rank}`;
  }

  const chosen = order[0] ?? null;
  return {
    candidates: order,
    chosen,
    reason: chosen === null ? "no acceptable rail" : reasonFor(chosen, candidates),
    trace,
  };
}

function costOf(price: string, cost: RailDeclaration["cost"]): string {
  const tollBps = cost?.tollBps ?? 0;
  const fixed = cost?.fixed ?? "0";
  const toll = (BigInt(price) * BigInt(tollBps)) / 10_000n;
  return (toll + BigInt(fixed)).toString(10);
}

function compareCandidates(a: Candidate, b: Candidate): number {
  if (a.degraded !== b.degraded) return a.degraded ? 1 : -1;
  if (a.cost !== b.cost) return a.cost < b.cost ? -1 : 1;
  const aFinality = a.finalitySeconds ?? Number.POSITIVE_INFINITY;
  const bFinality = b.finalitySeconds ?? Number.POSITIVE_INFINITY;
  if (aFinality !== bFinality) return aFinality < bFinality ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function reasonFor(chosen: RailId, candidates: Candidate[]): string {
  const winner = candidates.find((candidate) => candidate.id === chosen);
  if (!winner) return `${chosen}: cheapest acceptable rail`;
  if (!winner.degraded) {
    const better = candidates.find(
      (candidate) => candidate.degraded && comparePreference(candidate, winner) < 0,
    );
    if (better) return `${chosen}: ${better.id} failed twice in the last 10 minutes`;
  }
  const finality =
    winner.finalitySeconds === null ? "finality not declared" : `finality ${winner.finalitySeconds} s`;
  return `${chosen}: cheapest acceptable rail (cost ${winner.costText}, ${finality})`;
}

function comparePreference(a: Candidate, b: Candidate): number {
  if (a.cost !== b.cost) return a.cost < b.cost ? -1 : 1;
  const aFinality = a.finalitySeconds ?? Number.POSITIVE_INFINITY;
  const bFinality = b.finalitySeconds ?? Number.POSITIVE_INFINITY;
  if (aFinality !== bFinality) return aFinality < bFinality ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
