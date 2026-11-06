# tr-07: the canary gets a report mode, so production watches a round before anything is delisted (refs #26)

**Design: decided.** cs-truth wrote this on Opus for the project lead's STEER-2235 item 3 (the automatic delist on production) and `docs/decisions.md` "D18, amended", which is already committed on this branch. This branch is cs/tr-02 (PR #186) plus that amendment, so `apps/hub/src/canary.ts` exists. Implement exactly what follows. Nothing here is left for you to choose.

## Goal

`CANARY=report` runs the canary's rounds and delists nothing, logging what it would do. Every passing offer logs `[canary] ok <offerHash>` in both modes, and the hub logs its canary mode once at start. `CANARY=1` behaves exactly as today apart from the extra `ok` lines.

## Decisions

### 1. `apps/hub/src/canary.ts`

- `CanaryDeps` gains one optional field: `report?: boolean`. Absent or `false` keeps today's behaviour.
- `runCanary` returns `{ checked, delisted, failed }`. Declare `const failed: Hex[] = [];` beside `delisted`, and update the return type to `Promise<{ checked: Hex[]; delisted: Hex[]; failed: Hex[] }>`.
- Replace the single line `if (passed || offline) continue;` and the three delist lines after it with exactly this, in this order:

  ```ts
  if (offline) continue;
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
  ```

- Return `{ checked, delisted, failed }`. Nothing else in the file changes: the attempts loop, `CANARY_DEFAULTS`, `CanaryOptions` and `wait` stay as they are.

### 2. `apps/hub/src/index.ts`

Replace the whole `if (process.env.CANARY === "1") { ... }` block with:

```ts
const canaryMode = process.env.CANARY === "1" ? "delist" : process.env.CANARY === "report" ? "report" : "off";
console.log(`[hub] canary: ${canaryMode}`);
if (canaryMode !== "off") {
  const everyMs = Number(process.env.CANARY_INTERVAL_S ?? 300) * 1000;
  let running = false;
  setInterval(() => {
    if (running) return;
    running = true;
    void runCanary({ store, runners, now, report: canaryMode === "report", log: (line) => console.log(line) }).finally(() => {
      running = false;
    });
  }, everyMs);
}
```

Nothing else in `index.ts` changes.

## Lease

- `apps/hub/src/canary.ts` (section 1);
- `apps/hub/src/index.ts` (section 2);
- `apps/hub/test/canary-report.test.ts`: new.

Read only: everything else, including `apps/hub/test/canary.test.ts`. Never commit `bun.lock`.

## Tests (`apps/hub/test/canary-report.test.ts`, no network)

Copy the setup of `apps/hub/test/canary.test.ts` exactly: its imports, `OPTIONS = { attempts: 3, gapMs: 10, timeoutMs: 200 }`, the `beforeEach`/`afterEach` with `startHub` and the runner list, and its `deps`, `connect` and `listed` helpers. Collect log lines with `const lines: string[] = []` and pass `log: (line: string) => lines.push(line)` in the deps, plus `report: true` where a case says report mode.

1. **Report mode keeps a silent runner's offer.** One offer, runner `"ignore"`, report mode. `result.failed` equals `[hash]`, `result.delisted` equals `[]`, `listed(hub)` still contains the hash, and exactly one line starts with `` `[canary] would delist ${hash}: ` ``.
2. **Report mode logs a healthy runner.** One offer, runner `"answer"`, report mode. `lines` contains `` `[canary] ok ${hash}` ``, and `result.failed` and `result.delisted` both equal `[]`.
3. **Delist mode is unchanged and reports its failures.** One offer, runner `"ignore"`, no `report`. `result.delisted` and `result.failed` both equal `[hash]`, `listed(hub)` no longer contains the hash, and one line starts with `` `[canary] delisted ${hash}: ` ``.
4. **Report mode with one healthy and one silent offer.** Build the two offers exactly as the "only the offer whose runner fails the canary is delisted" test does. `result.failed` equals `[silentHash]`, `result.delisted` equals `[]`, both hashes are still listed, `lines` contains `` `[canary] ok ${healthyHash}` ``, and one line starts with `` `[canary] would delist ${silentHash}: ` ``.

Every existing test still passes, unedited, including all of `canary.test.ts`.

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
- `runCanary`, `CanaryDeps` or the `CANARY` block in `index.ts` differ from what this packet names;
- a failure survives three different fixes;
- 25 minutes have passed.

## Report

Write `~/Developer/countersign-mac/reports/tr-07-canary-report.md` (on the second machine): the diff summary, the test names, and the gate output counts.
