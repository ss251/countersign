# tr-08: the canary skips a runner that has stopped answering pings, instead of delisting it (refs #26)

**Design: decided.** cs-truth wrote this on Opus from cs-phone's finding on the live canary and `docs/decisions.md` "D18, amended again", which is already committed on this branch. Implement exactly what follows. Nothing here is left for you to choose.

## Goal

A runner whose socket is open but whose page is asleep (iOS in the background) stops answering pings. Until now the canary timed out on it three times and delisted its offers for good. After this packet, such a runner counts as offline and its offer is skipped for that round. A runner that keeps answering pings but not the canary is still delisted.

## Decisions

### 1. `apps/hub/src/runners.ts`: one new public method

Add this method to `class RunnerLink`, directly after `isOnline`:

```ts
  /** Milliseconds since the runner holding this offer last answered a ping or said hello, or null when no runner holds it. */
  pongAgeMs(offerHash: string): number | null {
    const conn = this.find(offerHash);
    return conn === null ? null : Date.now() - conn.lastPongAt;
  }
```

Nothing else in `runners.ts` changes.

### 2. `apps/hub/src/canary.ts`

- Replace the `CanaryOptions` interface and `CANARY_DEFAULTS` with exactly:

  ```ts
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
  ```

- In `runCanary`, replace the block from `let lastReason = "timeout";` through `if (offline) continue;` with exactly:

  ```ts
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
  ```

Nothing else in `canary.ts` changes: the `ok`, `would delist` and `delisted` lines, `failed`, `report` and the return value stay as they are.

## Lease

- `apps/hub/src/runners.ts` (decision 1);
- `apps/hub/src/canary.ts` (decision 2);
- `apps/hub/test/canary-stale.test.ts`: new.

Read only: everything else, including `apps/hub/test/canary.test.ts` and `apps/hub/test/canary-report.test.ts`. Never commit `bun.lock`.

## Tests (`apps/hub/test/canary-stale.test.ts`, no network)

Copy the setup of `apps/hub/test/canary-report.test.ts` exactly: its imports, the `beforeEach`/`afterEach`, the `lines` array, and its `deps`, `connect` and `listed` helpers.

1. **A runner that stops answering pings is skipped, not delisted.** One offer, runner `"ignore"`, options `{ attempts: 3, gapMs: 10, timeoutMs: 200, stalePongMs: 50 }`, delist mode (no `report`). `result.delisted` and `result.failed` both equal `[]`, `listed(hub)` still contains the hash, and exactly one line starts with `` `[canary] skipped ${hash}: ` ``.
2. **A runner that closes during an attempt is skipped, not delisted.** One offer, runner `"ignore"`, options `{ attempts: 3, gapMs: 10, timeoutMs: 1_000 }`. Start `runCanary` without awaiting it, call `runner.close()` 50 ms later (`await Bun.sleep(50)`), then await the result. `result.delisted` and `result.failed` both equal `[]`, the hash is not delisted (`hub.store.getOffer(hash)?.delistedAt` is `null`), and exactly one line starts with `` `[canary] skipped ${hash}: ` ``.
3. **A runner that answers pings but ignores the canary is still delisted.** One offer, runner `"ignore"`, options `{ attempts: 3, gapMs: 10, timeoutMs: 200, stalePongMs: 60_000 }`, delist mode. `result.delisted` equals `[hash]`, and `listed(hub)` no longer contains it.
4. **`pongAgeMs`.** `hub.runners.pongAgeMs` is `null` for a hash no runner holds. For a connected runner's offer it is a number from 0 to 5,000.

Every existing test still passes, unedited, including all of `canary.test.ts` and `canary-report.test.ts`.

## Constraints

- **No browser** of any kind. That means no headless Chrome, no Playwright, no Puppeteer and no screenshot tools.
- **No network** in tests.
- **Never run `git stash`.** Every worktree of a clone shares one stash stack. Use a temporary commit or a second worktree.
- **Existing tests:** never edit, weaken, skip or delete one to make it pass. If one fails, fix the code, or stop and report the root cause.
- **Commits:** small, present tense, ending `refs #26`, with no emoji and no `Co-authored-by`.

## Acceptance

```
bun install --linker hoisted && bun run typecheck && bun test && forge test
```

All green.

## Stop conditions

Stop if any of these happens:
- a change is needed outside the lease;
- `isOnline`, `find`, `lastPongAt` or the quoted `runCanary` block differ from what this packet names;
- a failure survives three different fixes;
- 25 minutes have passed.

## Report

Write `~/Developer/countersign-mac/reports/tr-08-canary-stale-runner.md` (on the second machine): the diff summary, the test names, and the gate output counts.
