import type { Hex } from "viem";
import type { RunnerLink } from "./runners.ts";
import type { Store } from "./store.ts";

export interface CanaryOptions {
  attempts: number;
  gapMs: number;
  timeoutMs: number;
}

export const CANARY_DEFAULTS: CanaryOptions = { attempts: 3, gapMs: 5_000, timeoutMs: 10_000 };

export interface CanaryDeps {
  store: Store;
  runners: RunnerLink;
  now: () => number;
  log?: (line: string) => void;
}

export async function runCanary(
  deps: CanaryDeps,
  options: CanaryOptions = CANARY_DEFAULTS,
): Promise<{ checked: Hex[]; delisted: Hex[] }> {
  const checked: Hex[] = [];
  const delisted: Hex[] = [];

  for (const stored of deps.store.listOffers()) {
    const offerHash = stored.offerHash;
    if (!deps.runners.isOnline(offerHash)) continue;
    checked.push(offerHash);

    let lastReason = "timeout";
    let passed = false;
    let offline = false;
    for (let attempt = 0; attempt < options.attempts; attempt += 1) {
      const result = await deps.runners.canary(offerHash, options.timeoutMs);
      if (result.ok) {
        passed = true;
        break;
      }
      lastReason = result.reason;
      if (result.reason === "offline") {
        offline = true;
        break;
      }
      if (attempt + 1 < options.attempts) await wait(options.gapMs);
    }

    if (passed || offline) continue;

    deps.store.delistOffer(offerHash, deps.now());
    delisted.push(offerHash);
    deps.log?.(`[canary] delisted ${offerHash}: ${lastReason}`);
  }

  return { checked, delisted };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}
