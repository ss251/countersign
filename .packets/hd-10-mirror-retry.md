# hd-10-mirror-retry: Hedera mirror reads ride out a blip, the expiry demo waits out the release margin, and one expiry parser

## Goal

Three small fixes on the hedera code, exactly as decided in `/Users/thescoho/Developer/countersign-mumbai/hd/DESIGN-mirror-retry.md` (read it first). Tracked by issue #41.

1. **Retry.** A Hedera mirror node 502 ended cs-e2e's hourly hedera run, because `readEntries` throws on any non-2xx. Every mirror read now retries a transient failure a few times before giving up.
2. **The expiry demo.** `scripts/hedera/schedule.ts --expiry-demo` calls `releaseExpired` the moment the expiration passes, but a release now waits `RELEASE_MARGIN_SECONDS` (60 s) after the expiration, so the demo always fails. The demo now waits out the margin.
3. **One parser.** `releaseExpired` parses the expiration itself. It now uses `secondsOf` from `schedule.ts`, which also reads ISO date-times.

## Lease

- `packages/rail/src/hedera/mirror.ts`
- `packages/rail/src/hedera/schedule.ts`: only `getSchedule`'s fetch, and the `export` keyword on `secondsOf`
- `packages/buyer/src/hedera/spendlog.ts`: only the two mirror fetches (`readEntries`, `reconcile`) and the import
- `packages/buyer/src/hedera/agent.ts`: only `releaseExpired`'s expiration line and the import
- `scripts/hedera/schedule.ts`: only the `--expiry-demo` release step and the import
- New test files:
  - `packages/rail/src/hedera/test/mirror-retry.test.ts`
  - `packages/buyer/src/hedera/test/mirror-retry.test.ts`
- Report: `/Users/thescoho/Developer/countersign-mumbai/reports/hd-10-mirror-retry.md`

## The decided design

1. **`mirrorFetch` in `mirror.ts`.**

   ```ts
   export const MIRROR_RETRY_DELAYS_MS: readonly number[] = [500, 1_000, 2_000];
   export async function mirrorFetch(url: string, opts: MirrorOptions = {}): Promise<Response>;
   ```

   - `MirrorOptions` gains `retryDelaysMs?: readonly number[]`, defaulting to `MIRROR_RETRY_DELAYS_MS`. Its length is the number of retries, and `[]` means one attempt.
   - **An attempt** is `(opts.fetch ?? fetch)(url)`, with exactly one argument.
   - **A transient attempt** is one where the fetch throws, or the status is 429, or the status is 500 or higher.
   - **On a transient attempt with a retry left:**
     1. `await response.body?.cancel()` when there is a response, ignoring any error from the cancel;
     2. `await` a `setTimeout` promise of the next delay;
     3. try again.
   - **Any other response** (2xx, 404, any other 4xx) is returned at once, unchanged.
   - **When the retries run out:** return the last response if the last attempt produced one; otherwise rethrow the last error.

2. **Every mirror read uses it.** `f(url)` becomes `mirrorFetch(url, opts)` in exactly four places:
   1. `get()` in `mirror.ts`;
   2. `getSchedule()` in `schedule.ts`;
   3. `readEntries()` in `spendlog.ts`, for every page;
   4. `reconcile()`'s `/api/v1/transactions` pages in `spendlog.ts`.

   - Status handling after the call is unchanged, and so is every error message.
   - `spendlog.ts` imports `mirrorFetch` from `@countersign/rail/hedera`.
   - Remove a local `const f = opts.fetch ?? fetch;` only where nothing else uses it.

3. **`secondsOf`.**
   - `schedule.ts` exports it, unchanged. `index.ts` already re-exports the module.
   - In `releaseExpired`, `const expirationSeconds = record.expirationTime === null ? null : Number(record.expirationTime.split(".")[0]);` becomes `const expirationSeconds = secondsOf(record.expirationTime);`, imported from `@countersign/rail/hedera`.

4. **The expiry demo.** In `scripts/hedera/schedule.ts`, on the `--expiry-demo` path only, replace `const release = await agent.releaseExpired(outcome.hold);` with:
   1. `say(\`release  waiting ${RELEASE_MARGIN_SECONDS} s past the expiration\`)`, once. `RELEASE_MARGIN_SECONDS` is imported from `../../packages/buyer/src/hedera/agent.ts`, the module the script already imports `createHederaAgent` from.
   2. A loop that calls `agent.releaseExpired(outcome.hold)`, stops at the first value other than `"pending"`, and otherwise waits 3 s and calls again. It stops after `(RELEASE_MARGIN_SECONDS + 60) * 1000` ms since the loop started.
   3. `release` (now `let`) holds the last value.

   Everything after it is unchanged: the `release  ${release}` line, the `waitForEntry`, the audit and `ok`.

Nothing else changes. Writes (HCS submits, transactions) are never retried.

## Tests (offline; inject `fetch` and `retryDelaysMs`; no network)

`packages/rail/src/hedera/test/mirror-retry.test.ts`:

- **`mirrorFetch`.** Each case counts the calls to a fake fetch. The cases use `retryDelaysMs: [0, 0, 0]` unless a case says otherwise.

  | Fake fetch answers | Result | Calls |
  |---|---|---|
  | 502, 502, 200 | the 200 | 3 |
  | throws, then 200 | the 200 | 2 |
  | 429, then 200 | the 200 | 2 |
  | 404 | the 404 | 1 |
  | 400 | the 400 | 1 |
  | 503 every time | a 503 response | 4 |
  | 503 every time, with `retryDelaysMs: []` | a 503 response | 1 |
  | throws `boom 1`, `boom 2`, `boom 3`, with `retryDelaysMs: [0, 0]` | rejects with `boom 3` | 3 |

- **The delays.**
  - `MIRROR_RETRY_DELAYS_MS` equals `[500, 1000, 2000]`.
  - With `retryDelaysMs: [50]`, 502 then 200 takes at least 45 ms. Assert a lower bound only.
- **`getTransaction`.** It returns the normalized transaction when the fake mirror answers 503 once and then the record (`retryDelaysMs: [0]`).
- **`getSchedule`.**
  - It returns the schedule when the fake mirror answers 502 once and then the record.
  - With 502 every time and `retryDelaysMs: [0]`, it rejects with a `MirrorError` whose `status` is 502.

`packages/buyer/src/hedera/test/mirror-retry.test.ts`:

- **`readEntries`.**
  - Two pages, joined by `links.next`, where each page's first attempt answers 502, return every entry of both pages (`retryDelaysMs: [0]`).
  - With 502 every time and `retryDelaysMs: [0, 0, 0]`, it rejects with `mirror topic 0.0.11337070 -> 502` after 4 calls.
- **`reconcile`.** The `/api/v1/transactions?account.id=` page answers 503 on its first attempt. The result equals the result from the same fake without the blip. Build the fixture the way `spendlog.test.ts` does.
- **`releaseExpired`.** Build the agent the way `release.test.ts` does.
  - A record whose `expiration_time` is the ISO date-time `new Date((NOW - RELEASE_MARGIN_SECONDS - 1) * 1000).toISOString()` gives `"released"`.
  - The same with `NOW - 30` gives `"pending"`.

Every existing test passes unedited.

## Constraints

- **No browser** of any kind on this machine: no headless Chrome, Playwright, Puppeteer or screenshot tools. UI checks go back to the lane, which raises NEEDS-BROWSER.
- **Never run a script under `scripts/hedera/`.** They spend real testnet funds. cs-hd runs the expiry demo live after review.
- **No network** in tests. **No keys:** never read an env file, a config directory or the keychain.
- **Scope.** Change nothing outside the lease. Never stage `bun.lock`. No new dependencies. TypeScript strict, no `any`.

## Acceptance

```
set -o pipefail; bun install && bun run typecheck && bun test packages/rail/src/hedera packages/buyer && bun test && forge test
```

Every command passes, with no new skips. Commit on `cs/hd-10` with short present-tense messages ending `refs #41`, and no trailers. Write the report, naming each changed call site. Do not push, merge or deploy.
