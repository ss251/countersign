# cs-79-e2e-stale-sign report

Lane: cs-e2e. Base: `cs/e2e`. Branch: `cs/cs-79`.

## Changes

### `e2e/human/lib/review.ts`

Lines 20-58:

- lines 20-24: `Settlement`, the payee, atomic amount and job id that actually settled.
- lines 26-28: `ReviewComparison`, the optional note that names the re-prepared job.
- lines 30-32: `short(job)` truncates a job id to its `0x` prefix and eight hex digits plus an
  ellipsis for the note.
- lines 34-58: `compareSettlement(review, settlement, signDelayS)`. The payee must always match
  case-insensitively and the amount must always match. A different job id fails when `signDelayS`
  is 0; with a delay it passes and returns
  `the console re-prepared the terms at Sign: job <review> -> <slip>`. The failure messages are the
  ones step 06 threw before, so `signDelayS === 0` behaves as it did.

### `e2e/human/test/review.test.ts`

Lines 41-75, five offline tests against the pure helper:

- with no delay, a different job id fails;
- with a delay, a different job id passes and returns the note;
- with a delay, a different payee still fails;
- with a delay, a different amount still fails;
- the same job id passes without a note, with or without a delay.

### `e2e/human/tests/buy.spec.ts`

- line 44: imports `compareSettlement`.
- lines 75-82: `signDelaySeconds()` reads
  `Number(process.env.E2E_HUMAN_SIGN_DELAY_S ?? "0")` and throws
  `E2E_HUMAN_SIGN_DELAY_S must be 0..600` unless it is an integer from 0 to 600.
- line 286: calls `signDelaySeconds()` at the start of the run, so a bad value fails at once.
- lines 448-452, step 05: when `signDelayS > 0`, after the review values are read and the
  `05-review` screenshot is taken and before `start-sign` is clicked, notes
  `waited <n> s between the review and Sign (STEER-0300 C1 stale case)`, raises the test's timeout
  by the delay with `test.setTimeout(...)`, then waits `signDelayS * 1000` ms.
- lines 541-546, step 06: the review-versus-slip comparison now runs once through
  `compareSettlement`, after the Funded log supplies the payee. It notes the re-prepared job when
  that happened. The amount, buyer, offer, Funded and Released checks are unchanged and stay
  against the slip's job id.

## Gate

### 1. Install and typecheck

```text
$ bun install --linker hoisted && bun run typecheck
bun install v1.3.14 (0d9b296a)

Checked 1031 installs across 774 packages (no changes) [340.00ms]
$ tsc -p tsconfig.json
```

Exit code 0; no diagnostics.

### 2. Offline tests

```text
$ bun test e2e/human/test
 71 pass
 0 fail
 193 expect() calls
Ran 71 tests across 10 files. [2.09s]
```

```text
$ bun test e2e/test
 40 pass
 0 fail
 114 expect() calls
Ran 40 tests across 2 files. [8.74s]
```

The `leak:` lines printed by the report tests are the leak scan's expected output for its planted
fixtures; the suite still reports 0 fail.

### 3. Playwright list

```text
$ cd e2e && npx playwright test -c human/playwright.config.ts --list
Listing tests:
  [privy] › buy.spec.ts:761:16 › the human acceptance run
  [injected] › buy.spec.ts:761:16 › the human acceptance run
Total: 2 tests in 1 file
```

### 4. Runs directory

```text
$ git status --short e2e/human/runs
(no output)
```

## Notes

- No browser was used and no Playwright test was run; only `--list`. No `playwright install`.
- `git stash` was not used. No key, Privy login or token was read or printed.
- The pre-existing file-mode change on `packages/cli/src/bin.ts` was left untouched.
