# cs-67-e2e-human-pace: sign in at a person's pace

Status: complete on `cs/cs-67`, on top of `cs/cs-66` (`f80e670`). No browser was launched, no
acceptance run was started, and no key or Privy login was read or printed. Playwright was called
with `--list` only.

## The change

### `e2e/human/lib/privy.ts`

- **31-37:** `dialogVisible(page, timeoutMs)` waits for the visible dialog and returns `false` on
  timeout instead of throwing. It uses the same `getByRole("dialog")` locator as `signIn`.
- **39-40:** `PRIVY_SECOND_CLICK_NOTE` holds the exact note the run records when the retry is
  needed.
- **42-59:** `openPrivy(attempt)` is the testable retry decision: click sign-in, ask
  `dialogVisible`, and when the dialog did not appear, click the wallet menu and the sign-in option
  once more, then record the note. It never waits for the dialog itself, so the caller keeps the
  10 s first-attempt window and `signIn` keeps its own 30 s wait.
- **84-92:** `signIn` takes an optional `beforeTyping` callback, invoked after its unchanged 30 s
  dialog wait and before the email is typed. This is where the empty-modal screenshot now lands.

`signIn`'s existing assertions, waits and typing are unchanged.

### `e2e/human/tests/buy.spec.ts`

- **290-293:** step 01 now waits for `networkidle` with a 30 s timeout before clicking
  `wallet-menu`. The timeout is caught and ignored, so a busy page still proceeds.
- **312-320:** the `wallet-signin` click goes through `openPrivy`, with a 10 s dialog window and
  `rec.note` for the retry note. `signIn` receives the screenshot callback, so
  `01-privy-modal.png` is taken only after the dialog is visible and before any typing. The
  `signed-in` screenshot and every later assertion are unchanged.

### `e2e/human/test/privy.test.ts`

- **1-2, 29-69:** two offline tests for `openPrivy`. The first proves a visible dialog causes no
  retry and no note. The second proves a dropped first click produces exactly
  `sign-in`, `menu`, `sign-in` and records the exact UX-gap note.

The retry logic is factored into `openPrivy`, so it is covered offline without a browser.

## Gate outputs

```
$ bun install --linker hoisted && bun run typecheck
bun install v1.3.14 (0d9b296a)

Checked 873 installs across 671 packages (no changes) [249.00ms]
$ tsc -p tsconfig.json
exit=0
```

```
$ bun test e2e/human/test
bun test v1.3.14 (0d9b296a)

e2e/human/test/report.test.ts:
leak: /var/folders/p4/8cqx396x7yl142gkb4sqv5800000gn/T/cs-human-report-obWFCR/artifacts/20260101-000000-abcd/privy/planted.json
leak: /var/folders/p4/8cqx396x7yl142gkb4sqv5800000gn/T/cs-human-report-gxOURA/artifacts/20260101-000000-abcd/privy/planted.json

 37 pass
 0 fail
 110 expect() calls
Ran 37 tests across 9 files. [538.00ms]
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
Ran 26 tests across 1 file. [7.76s]
exit=0
```

```
$ cd e2e && npx playwright test -c human/playwright.config.ts --list
Listing tests:
  [privy] › buy.spec.ts:619:16 › the human acceptance run
  [injected] › buy.spec.ts:619:16 › the human acceptance run
Total: 2 tests in 1 file
exit=0
```

```
$ git status --short e2e/human/runs
(no output)
```
