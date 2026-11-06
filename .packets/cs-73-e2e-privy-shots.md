# cs-73-e2e-privy-shots: no screenshot ever shows the Privy login

Lane: cs-e2e. Base: `cs/cs-71`. Branch: `cs/cs-73`. URGENT: the human suite's screenshots captured the
test account's login, which the firstmate's rule forbids ("never put it in argv, a trace, a screenshot
name or a report").

## Evidence (production runs 20261106-181120-1fc0, -181838-9add, -191537-56ca, -192916-e0f5)

In each of these runs, `01-signed-in.png`, `02-wallet.png` and `03-fund.png` show Privy's "Enter
confirmation code" modal in its "Success!" state. That state prints the test account's email and the
code that was typed. The cs-e2e lane has deleted those 12 local files. CI never uploaded them, because it
uploads only `runs/` and `artifacts/*/injected/`.

The cause is in step 01 of `tests/buy.spec.ts`:

- `await expect(page.getByRole("dialog")).toBeHidden(...)` passes at once, because Privy's dialog role is a
  zero-size wrapper (cs-68's evidence). The signed-in shot is therefore taken while the modal content is
  still on screen.
- The modal stays up for another 2 to 3 seconds, so the screenshots that `step()` takes at the start of
  steps 02 and 03 caught it too.

## Changes

### `e2e/human/lib/privy.ts`

Export `waitForModalClosed(page: Page, timeoutMs: number): Promise<void>`:

- Poll every 250 ms until neither `page.locator("#privy-modal-content")` nor
  `page.getByText(/enter confirmation code|log in or sign up/i)` has a visible match. Use the existing
  `anyVisible` helper for each.
- If either is still visible at `timeoutMs`, throw
  `Privy's modal did not close within ${timeoutMs / 1000} s`.

### `e2e/human/tests/buy.spec.ts`

1. In step 01, replace `await expect(page.getByRole("dialog")).toBeHidden({ timeout: 30_000 });` with
   `await waitForModalClosed(page, 30_000);`.
2. Right after `email` and `otp` are read from `keys`, call `rec.guardWith(keys)`.
3. The `signIn` callback that takes the `01-privy-modal` shot passes `{ showPrivy: true }`. That shot is
   the empty modal, taken before anything is typed.

### `e2e/human/lib/report.ts`, `Recorder`

1. Add `guardWith(guard: { leaks(text: string): boolean }): void`, which stores the guard.
2. `screenshot(page, nn, slug, options?: { showPrivy?: boolean })`:
   - If a guard is set, read the page's visible text with
     `await page.locator("body").innerText().catch(() => "")`.
   - If `guard.leaks(text)` is true, take no screenshot. Add the note
     `${nn}-${slug}: screenshot withheld, the page showed a secret` and return. The note must never
     include the text itself.
   - Otherwise call `page.screenshot({ path: file, mask })`. `mask` is `[]` when `options?.showPrivy` is
     true, and `[page.locator("#privy-modal-content")]` otherwise.

### `e2e/human/lib/report.ts`, `finalizeReport`

1. Also leak-scan Playwright's output folder, `e2e/human/test-results/`. Add `testResultsDir` to
   `FinalizeOptions`, defaulting to that folder, so tests can point it elsewhere.
   - Its failure files, such as `error-context.md`, hold a text snapshot of the page. A failure while the
     code screen is up would put the email in one.
   - Each leaking file there is deleted and reported exactly as leaking run artifacts are now: the
     `leak:` line, `leaks` in the result, and exit code 1.

## Tests (`bun test e2e/human/test`)

1. `waitForModalClosed` resolves once a fake `#privy-modal-content` turns hidden. It throws the message
   above when the content stays visible past a short timeout (for example 300 ms).
2. `Recorder.screenshot`:
   - With a guard that reports a leak, `page.screenshot` is never called and the note is recorded.
   - With a guard that reports none, `page.screenshot` is called once with a one-element `mask`.
   - With `{ showPrivy: true }`, it is called with an empty `mask`.
3. `finalizeReport` with a `testResultsDir` that holds a planted leaking `error-context.md`:
   - the file is deleted;
   - it is listed in `leaks`;
   - `exitCode` is 1.

## Gate (all four; paste the tails)

1. `bun install --linker hoisted && bun run typecheck` clean.
2. `bun test e2e/human/test` and `bun test e2e/test` all pass.
3. Under Node: `cd e2e && npx playwright test -c human/playwright.config.ts --list` lists the two tests.
4. `git status --short e2e/human/runs` shows nothing new.

## Constraints

- No browser of any kind on this machine: `--list` only, never a test run, no `playwright install`.
- **Never run `git stash`;** use a temporary commit or a second worktree.
- Touch only `e2e/human/**`. Never read or print a key or the Privy login, and never write either one
  into a test, a fixture or the report. Use made-up values for planted secrets.
- Never push, merge or deploy. Make small present-tense commits on `cs/cs-73`, with no emoji, no
  Co-authored-by and no trailers.
- If something cannot be done as written, stop and say exactly what and why.

## Report

`.packets/reports/cs-73-e2e-privy-shots.md`: the changes with line ranges, and the gate outputs.
