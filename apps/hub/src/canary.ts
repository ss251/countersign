import type { Hex } from "viem";
import type { RunnerLink } from "./runners.ts";
import type { Store } from "./store.ts";

export interface CanaryOptions {
  attempts: number;
  gapMs: number;
  timeoutMs: number;
  /** A runner whose last pong is older than this is gone, not lying: its offer is skipped this round. */
  stalePongMs?: number;
}

export const STALE_PONG_MS = 25_000;

export const CANARY_DEFAULTS: CanaryOptions = { attempts: 3, gapMs: 5_000, timeoutMs: 10_000, stalePongMs: STALE_PONG_MS };

/** Results that mean the runner went away during the attempt, not that it refused. */
const GONE = new Set(["offline", "pong-timeout", "closed"]);

export interface CanaryDeps {
  store: Store;
  runners: RunnerLink;
  now: () => number;
  log?: (line: string) => void;
  report?: boolean;
}

export async function runCanary(
  deps: CanaryDeps,
  options: CanaryOptions = CANARY_DEFAULTS,
): Promise<{ checked: Hex[]; delisted: Hex[]; failed: Hex[] }> {
  const checked: Hex[] = [];
  const delisted: Hex[] = [];
  const failed: Hex[] = [];

  for (const stored of deps.store.listOffers()) {
    const offerHash = stored.offerHash;
    if (!deps.runners.isOnline(offerHash)) continue;
    checked.push(offerHash);

    let lastReason = "timeout";
    let passed = false;
    let offline = false;
    const staleAfter = options.stalePongMs ?? STALE_PONG_MS;
    const stale = (): boolean => {
      const age = deps.runners.pongAgeMs(offerHash);
      return age === null || age > staleAfter;
    };
    for (let attempt = 0; attempt < options.attempts; attempt += 1) {
      if (stale()) {
        lastReason = "no recent pong";
        offline = true;
        break;
      }
      const result = await deps.runners.canary(offerHash, options.timeoutMs);
      if (result.ok) {
        passed = true;
        break;
      }
      lastReason = result.reason;
      if (GONE.has(result.reason)) {
        offline = true;
        break;
      }
      if (stale()) {
        lastReason = "no recent pong";
        offline = true;
        break;
      }
      if (attempt + 1 < options.attempts) await wait(options.gapMs);
    }

    if (offline) {
      deps.log?.(`[canary] skipped ${offerHash}: ${lastReason}`);
      continue;
    }
    if (passed) {
      deps.log?.(`[canary] ok ${offerHash}`);
      continue;
    }
    failed.push(offerHash);
    if (deps.report === true) {
      deps.log?.(`[canary] would delist ${offerHash}: ${lastReason}`);
      continue;
    }
    deps.store.delistOffer(offerHash, deps.now());
    delisted.push(offerHash);
    deps.log?.(`[canary] delisted ${offerHash}: ${lastReason}`);
  }

  return { checked, delisted, failed };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}
