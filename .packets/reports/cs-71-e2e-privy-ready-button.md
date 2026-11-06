# cs-71-e2e-privy-ready-button: only an enabled sign button is a prompt, and a click never waits out the timeout

Status: complete on `cs/cs-71`. No browser was launched, no acceptance run was started, and no key or
Privy login was read or printed. Playwright was called with `--list` only, `playwright install` was
not run, and `git stash` was not used.

## The change

### `e2e/human/lib/privy.ts`

- **147-153:** the sign-button and error regexes, the three-click limit, the polling constants, and
  the new `SIGN_CLICK_MS = 5_000` click timeout.
- **166-168:** `enabled(locator)` returns `locator.isEnabled()` or `false` when the query fails,
  beside the existing `visible`.
- **178-187:** `readySignButton` (renamed from `visibleSignButton`) returns the first sign button in
  the dialog that is both visible and enabled, or `undefined`. Its comment cites run
  20261106-191537-56ca: a disabled sign button is Privy working, not a prompt.
- **189-199:** `clickIfReady(button)` returns `false` without clicking unless the button is visible
  and enabled. A ready button is clicked with `{ timeout: SIGN_CLICK_MS }`. If that click throws and
  the button is no longer both visible and enabled, it returns `false` because the prompt went away
  before the click landed; otherwise it rethrows.
- **220-243:** `approveIfPrompted` polls for a ready button. A `false` before any click returns to
  the outer loop, which keeps looking until the deadline and returns 0 if none appears. A `false`
  after a click returns the clicks so far. A `true` counts the click and keeps the existing
  `waitForPromptOutcome`, 2 s error retry, 3-click limit, and `PRIVY_SIGN_FAILURE` message unchanged.

### `e2e/human/test/privy.test.ts`

- **120:** `fakeLocator` defaults to `isEnabled: async () => true`, so the three existing signature
  tests keep passing unchanged.
- **298-311:** `fakePromptPage(button)` builds a fake dialog offering one sign button, with a fake
  `waitForTimeout` that returns at once.
- **351-372:** a disabled button that goes away is not a prompt: returns 0 with no click.
- **374-395:** a button disabled for two checks and enabled after is clicked once, returning 1.
- **397-415:** a click that throws and makes the button go away returns to waiting and resolves to 0
  after exactly one click attempt.
- **417-439:** a click that throws while the button stays visible and enabled rejects with the same
  error.

`e2e/human/tests/buy.spec.ts` is unchanged, including both `approveAndNote` calls.

## Gate outputs

```
$ bun install --linker hoisted && bun run typecheck
bun install v1.3.14 (0d9b296a)

+ @countersign/relay@workspace:packages/relay

3 packages installed [284.00ms]
$ tsc -p tsconfig.json
exit=0
```

```
$ bun test e2e/human/test
bun test v1.3.14 (0d9b296a)

e2e/human/test/report.test.ts:
leak: /var/folders/p4/8cqx396x7yl142gkb4sqv5800000gn/T/cs-human-report-X4T6ZV/artifacts/20260101-000000-abcd/privy/planted.json
leak: /var/folders/p4/8cqx396x7yl142gkb4sqv5800000gn/T/cs-human-report-6xRFE7/artifacts/20260101-000000-abcd/privy/planted.json

 46 pass
 0 fail
 148 expect() calls
Ran 46 tests across 9 files. [1298.00ms]
exit=0
```

The two `leak:` lines are the expected planted-secret fixture in `report.test.ts`; the paths are
temporary test directories.

```
$ bun test e2e/test
bun test v1.3.14 (0d9b296a)

 26 pass
 0 fail
 83 expect() calls
Ran 26 tests across 1 file. [7.95s]
exit=0
```

```
$ cd e2e && npx playwright test -c human/playwright.config.ts --list
Listing tests:
  [privy] › buy.spec.ts:637:16 › the human acceptance run
  [injected] › buy.spec.ts:637:16 › the human acceptance run
Total: 2 tests in 1 file
exit=0
```

```
$ git status --short e2e/human/runs
(no output)
```
