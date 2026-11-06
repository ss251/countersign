# cs-67-e2e-human-pace: sign in at a person's pace, and record it if Privy needs a second click

Lane: cs-e2e. Base: `cs/cs-66` (which carries the Node fix for `e2e/lib/paths.ts`). Branch: `cs/cs-67`.
URGENT: this blocks the captain's production acceptance run.

## The finding

Run 20261106-174813-90b8, on production console 34cfa5f0, clicked `wallet-signin` the moment it appeared,
and no Privy modal came within 30 s. A diagnostic run that first waited for the network to settle got
`#privy-dialog` and `#privy-modal-content` at once. Privy's `login()` does nothing before the SDK is
ready, so the early click was silently dropped. That is a real UX gap, reported to cs-ui. The test
should still sign in the way a person does: after the page has loaded.

## Change `e2e/human/tests/buy.spec.ts`, the privy sign-in

1. After step 00 opens the console, and before the click on `wallet-menu`, run
   `await page.waitForLoadState("networkidle", { timeout: 30_000 })`. A timeout here is not a failure:
   catch it and continue.
2. After clicking `wallet-signin`, wait up to 10 s for Privy's dialog to be visible. If it is not
   visible, click `wallet-menu` and `wallet-signin` once more, and record a run note:
   "Privy needed a second click: the first came before it was ready (UX gap, cs-ui)". Then continue to
   `signIn`, whose own 30 s wait for the dialog is unchanged.
3. The empty-modal screenshot (before typing) is taken after the dialog is visible, not right after the
   click.

Nothing else changes. All the assertions stay.

## Tests

Add or extend one offline test, if the logic is factored into a testable helper. If it is not, explain why
in the report. The gate below is the real check.

## Gate (all four; paste the tails)

1. `bun install --linker hoisted && bun run typecheck` clean.
2. `bun test e2e/human/test` and `bun test e2e/test` all pass.
3. Under Node: `cd e2e && npx playwright test -c human/playwright.config.ts --list` lists the two tests.
4. `git status --short e2e/human/runs` shows nothing new.

## Constraints

- No browser of any kind on this machine: `--list` only, never a test run, no `playwright install`.
- **Never run `git stash`;** use a temporary commit or a second worktree.
- Touch only `e2e/human/**`. Never read or print a key or the Privy login.
- Never push, merge or deploy. Small present-tense commits on `cs/cs-67`, with no emoji, no
  Co-authored-by and no trailers.

## Report

`.packets/reports/cs-67-e2e-human-pace.md`: the change with line ranges, and the gate outputs.
