# cs-73-e2e-privy-shots: no screenshot ever shows the Privy login

Status: complete on `cs/cs-73`. No browser was launched, no acceptance run was started, and no key
or Privy login was read or printed. The offline tests use made-up values
(`buyer@example.test`). Playwright was called with `--list` only, `playwright install` was not run,
`git stash` was not used, and nothing was pushed, merged or deployed.

## The changes

### `e2e/human/lib/privy.ts`

- **50-65:** new exported `waitForModalClosed(page, timeoutMs)`. It polls every 250 ms, using the
  existing `anyVisible` helper, until neither `#privy-modal-content` nor the text matching
  `/enter confirmation code|log in or sign up/i` is visible. If either is still visible at the
  deadline it throws `Privy's modal did not close within ${timeoutMs / 1000} s`. It replaces the
  zero-size dialog-role check with a check on the content itself.

### `e2e/human/tests/buy.spec.ts`

- **32:** imports `waitForModalClosed`.
- **267-270:** `rec.guardWith(keys)` runs immediately after the email and code are read, so every
  later screenshot is leak-checked against the registered login values.
- **339-349:** the `signIn` callback takes the `01-privy-modal` shot with `{ showPrivy: true }`,
  keeping the empty modal visible. Sign-in then waits for `waitForModalClosed(page, 30_000)` before
  the `01-signed-in` shot instead of the old dialog-role assertion.

### `e2e/human/lib/report.ts`

- **24:** `TEST_RESULTS_DIR` is `e2e/human/test-results`, Playwright's configured `outputDir`.
- **150:** the `Recorder` holds an optional guard.
- **170-172:** `guardWith(guard)` stores an object with `leaks(text)`.
- **174-192:** `screenshot(page, nn, slug, options?)` reads the body's visible text when a guard is
  set. A leaking page takes no screenshot; the recorder adds
  `${nn}-${slug}: screenshot withheld, the page showed a secret` (the text itself is never stored)
  and returns. Otherwise it screenshots with `mask` empty for `{ showPrivy: true }` and
  `[page.locator("#privy-modal-content")]` by default.
- **341-348:** `FinalizeOptions` gains `testResultsDir`.
- **358-390:** `finalizeReport` scans `e2e/human/test-results` by default (overridable through
  `testResultsDir`), deletes every leaking file there, prints the same `leak:` line, includes it in
  `leaks`, and exits 1. Run artifacts keep their existing deletion and artifact-list cleanup.

### `e2e/human/test/privy.test.ts`

- **104-122:** `waitForModalClosed` resolves once a fake `#privy-modal-content` turns hidden.
- **124-134:** a content that stays visible past a 300 ms timeout rejects with
  `Privy's modal did not close within 0.3 s`.

### `e2e/human/test/report.test.ts`

- **121-143:** a planted leaking `error-context.md` under a temporary `testResultsDir` is deleted,
  listed in `leaks`, and makes `exitCode` 1.
- **249-305:** the fake shot page and three `Recorder.screenshot` cases: a leak calls no
  `page.screenshot` and records the exact note; no leak calls it once with a one-element mask; and
  `{ showPrivy: true }` calls it with an empty mask.

## Gate outputs

```
$ bun install --linker hoisted && bun run typecheck
bun install v1.3.14 (0d9b296a)

+ @countersign/relay@workspace:packages/relay

3 packages installed [447.00ms]
$ tsc -p tsconfig.json
exit=0
```

```
$ bun test e2e/human/test
bun test v1.3.14 (0d9b296a)

e2e/human/test/report.test.ts:
leak: /var/folders/p4/8cqx396x7yl142gkb4sqv5800000gn/T/cs-human-report-Jzmg2m/artifacts/20260101-000000-abcd/privy/planted.json
leak: /var/folders/p4/8cqx396x7yl142gkb4sqv5800000gn/T/cs-human-report-I6JnMh/test-results/buy-retry/error-context.md
leak: /var/folders/p4/8cqx396x7yl142gkb4sqv5800000gn/T/cs-human-report-nDVJ0E/artifacts/20260101-000000-abcd/privy/planted.json

 52 pass
 0 fail
 164 expect() calls
Ran 52 tests across 9 files. [1.99s]
exit=0
```

The three `leak:` lines are the expected planted-secret fixtures; every path is a temporary test
directory.

```
$ bun test e2e/test
bun test v1.3.14 (0d9b296a)

 26 pass
 0 fail
 83 expect() calls
Ran 26 tests across 1 file. [7.84s]
exit=0
```

```
$ cd e2e && npx playwright test -c human/playwright.config.ts --list
Listing tests:
  [privy] › buy.spec.ts:641:16 › the human acceptance run
  [injected] › buy.spec.ts:641:16 › the human acceptance run
Total: 2 tests in 1 file
exit=0
```

```
$ git status --short e2e/human/runs
exit=0
```

No output: the run directory has nothing new.
