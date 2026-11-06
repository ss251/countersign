# cs-68-e2e-privy-driver: drive Privy's real modal, and never hang on a click

Lane: cs-e2e. Base: `cs/cs-67`. Branch: `cs/cs-68`. URGENT: this blocks the captain's production
acceptance run.

## Evidence (production run 20261106-175535-9e97, Playwright's page snapshot at failure)

The first click on `wallet-signin` opened Privy's modal. The snapshot shows, inside
`dialog "log in or sign up" [active]`:

- `heading "Log in or sign up"`
- `textbox "Submit"` with `placeholder: your@email.com`. Its accessible name is "Submit", not "email".
- a `button [disabled]` with no name, beside the email field. This is the submit button.
- `button "Continue with a wallet"` and `button "I have a passkey"`.

What went wrong in the test:

1. `dialog(page)` is `page.getByRole("dialog").filter({ visible: true }).first()`. Privy's dialog element
   is a zero-size wrapper, and only its content is visible, so the filter finds nothing. The test
   concluded no modal had opened.
2. The retry then clicked `wallet-menu`, which sat under Privy's backdrop. With no action timeout set,
   that click waited out the 10-minute test timeout.
3. Had it gone on, `signIn` would not have found the email field by `name: /email/i`. Its submit regex,
   `/submit|continue|log ?in|sign ?in/i`, would have matched "Continue with a wallet", which is the
   wrong path.

## Changes (exactly these)

### `e2e/human/lib/privy.ts`

- `dialog(page)` returns `page.getByRole("dialog")`, without the visible filter. It is used only for
  scoping.
- `dialogVisible(page, timeoutMs)` waits for
  `page.locator("#privy-modal-content").or(page.getByRole("heading", { name: /log in or sign up/i }))`
  to be visible, taking `.first()` of the union. It returns `true` when that happens and `false` on
  timeout.
- `signIn(page, email, otp, beforeTyping?)`:
  - Wait (30 s) for the same modal content as `dialogVisible`. A timeout fails with
    "Privy's modal did not open".
  - Call `beforeTyping`, as now.
  - The email field is the first visible of these, all scoped to `page.getByRole("dialog")`:
    `getByPlaceholder(/email/i)`, `locator('input[type="email"]')`, `getByRole("textbox")`.
  - Fill it, then **press Enter in it**. Never click a button to submit, so "Continue with a wallet" can
    never be chosen.
  - The code entry is unchanged: focus the first of
    `locator('input[autocomplete="one-time-code"]')` or `locator('input[inputmode="numeric"]')`, scoped
    to the dialog, and `page.keyboard.type(otp, { delay: 50 })`.
  - Done when `wallet-address` has a `data-value`, within 120 s, as now.
- `approveIfPrompted` keeps scoping to `page.getByRole("dialog")`, which is now unfiltered, and its button
  regex `/^(sign|approve|confirm)/i`.

### `e2e/human/tests/buy.spec.ts`

- `openPrivy`'s `clickMenu` is called only when `dialogVisible` is false *and* `wallet-menu` is not covered:
  before clicking it, wait 2 s for `#privy-dialog-backdrop` to be hidden. If the backdrop is visible,
  skip the retry, because the modal is open.

### `e2e/human/playwright.config.ts`

Add `actionTimeout: 30_000` and `navigationTimeout: 60_000` to `use`. A stuck click then fails in
30 s with its own message instead of waiting out the whole test.

## Tests (`bun test e2e/human/test`)

- `openPrivy` does not call `clickMenu` when the modal turns out to be open, with the backdrop visible.
- A fake `signIn` flow: the email field is matched by placeholder, the field gets Enter, and no button
  whose name matches `/wallet/i` is ever clicked. Use fakes for the locators; no browser.

## Gate (all four; paste the tails)

1. `bun install --linker hoisted && bun run typecheck` clean.
2. `bun test e2e/human/test` and `bun test e2e/test` all pass.
3. Under Node: `cd e2e && npx playwright test -c human/playwright.config.ts --list` lists the two tests.
4. `git status --short e2e/human/runs` shows nothing new.

## Constraints

- No browser of any kind on this machine: `--list` only, never a test run, no `playwright install`.
- **Never run `git stash`;** use a temporary commit or a second worktree.
- Touch only `e2e/human/**`. Never read or print a key or the Privy login.
- Never push, merge or deploy. Small present-tense commits on `cs/cs-68`, with no emoji, no
  Co-authored-by and no trailers.
- If something cannot be done as written, stop and say exactly what and why.

## Report

`.packets/reports/cs-68-e2e-privy-driver.md`: the changes with line ranges, and the gate outputs.
