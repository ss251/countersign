# cs-71-e2e-privy-ready-button: only an enabled sign button is a prompt, and a click never waits out the timeout

Lane: cs-e2e. Base: `cs/e2e`. Branch: `cs/cs-71`. URGENT: this blocks the project lead's production
acceptance run.

## Evidence (production run 20261106-191537-56ca, main 25e8104)

The purchase went through on production:

- Privy sign-in and the embedded wallet `0x90Df…72fE`;
- the 1 USDC funding;
- one Privy typed-data signature (the browser console log holds exactly one `eth_signTypedData_v4`);
- the escrow release (tx `0x9479…d779`, status 1);
- the slip `0xc35d…b533`, whose buyer is the embedded wallet.

The test still failed at step 05. In `buy.spec.ts`, `start-sign` is followed by two calls to
`approveAndNote`:

1. The first approved the one real prompt.
2. The second found the closing dialog's "Sign and continue" button, which was visible but `disabled`,
   and called `button.click()`. Playwright waited for it to be enabled, then reported "element was
   detached from the DOM, retrying". No sign button came back, so the click waited out the 30 s
   `actionTimeout` and threw `TimeoutError: locator.click: Timeout 30000ms exceeded`.

A disabled sign button is Privy working on a prompt or closing one. It is not a prompt waiting for the
person, and a person would not click it.

## Change `e2e/human/lib/privy.ts`

1. Add `enabled(locator)`: `locator.isEnabled().catch(() => false)`, beside `visible`.
2. Rename `visibleSignButton` to `readySignButton`. It returns the first sign button that is visible
   **and** enabled, or `undefined`. Give it a one-line comment citing run 20261106-191537-56ca.
3. Add `const SIGN_CLICK_MS = 5_000;` beside the other constants.
4. Add `clickIfReady(button): Promise<boolean>`:
   - If the button is not both visible and enabled, return `false` without clicking.
   - Otherwise call `button.click({ timeout: SIGN_CLICK_MS })` and return `true`.
   - If that click throws, check again. If the button is no longer both visible and enabled, return
     `false`: the prompt went away before the click landed. If it is still visible and enabled,
     rethrow the error.
5. In `approveIfPrompted`, replace `await button.click()` with `clickIfReady(button)`:
   - When it returns `false` and no click has been made yet for this prompt, go back to the outer
     polling loop and keep looking for a ready button until the deadline. That loop returns 0 if none
     appears.
   - When it returns `false` after one or more clicks (the retry path), return the clicks so far.
   - When it returns `true`, count the click and continue exactly as now: `waitForPromptOutcome`, the
     error retry after 2 s, and the throw at 3 clicks.

Nothing else changes, in particular the button regex, the error regex, the 3-click limit and the
`PRIVY_SIGN_FAILURE` message. `tests/buy.spec.ts` does not change, and both `approveAndNote` calls stay.

## Tests (`e2e/human/test/privy.test.ts`)

Add `isEnabled: async () => true` to `fakeLocator`'s defaults so the three existing signature tests
keep passing unchanged. Then add four tests to "the Privy signature retry". Pass a small `timeoutMs`
(for example `300`) wherever no prompt is expected: the fake `waitForTimeout` returns at once, so the
deadline is what ends the loop.

1. **A disabled button that goes away is not a prompt.** The button is visible and disabled for a few
   checks, then gone (`count` 0, `isVisible` false). `approveIfPrompted` returns 0, and the fake's
   `click` is never called.
2. **A button disabled at first is clicked once it is enabled.** `isEnabled` is false for the first
   two checks and true after that, and the click closes the prompt. The call returns 1 with one click.
3. **A click that fails because the button went away goes back to waiting.** `click` throws
   `new Error("Timeout 5000ms exceeded")` and, in the same call, makes the button gone.
   `approveIfPrompted(page, 300)` resolves to 0 and does not throw. The fake recorded exactly one click
   attempt.
4. **A click that fails while the button is still ready rethrows.** `click` throws and the button stays
   visible and enabled. `approveIfPrompted` rejects with that same error.

## Gate (all four; paste the tails)

1. `bun install --linker hoisted && bun run typecheck` clean.
2. `bun test e2e/human/test` and `bun test e2e/test` all pass.
3. Under Node: `cd e2e && npx playwright test -c human/playwright.config.ts --list` lists the two tests.
4. `git status --short e2e/human/runs` shows nothing new.

## Constraints

- No browser of any kind on this machine: `--list` only, never a test run, no `playwright install`.
- **Never run `git stash`;** use a temporary commit or a second worktree.
- Touch only `e2e/human/lib/privy.ts` and `e2e/human/test/privy.test.ts`. Never read or print a key or
  the Privy login.
- Never push, merge or deploy. Make one or two small present-tense commits on `cs/cs-71`, with no emoji, no
  Co-authored-by and no trailers.
- If something cannot be done as written, stop and say exactly what and why.

## Report

`.packets/reports/cs-71-e2e-privy-ready-button.md`: the changes with line ranges, and the gate outputs.
