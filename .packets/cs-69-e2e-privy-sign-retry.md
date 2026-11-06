# cs-69-e2e-privy-sign-retry: retry Privy's signature as its error asks, and keep the browser console

Lane: cs-e2e. Base: `cs/cs-68`. Branch: `cs/cs-69`. URGENT: the captain's production acceptance run.

## Evidence (production run 20261106-181120-1fc0)

These all passed:

- Privy sign-in with the test account;
- the embedded wallet `0x90Df…72fE`;
- the 1 USDC funding (tx `0xf79c…b06b`) and the balance check;
- the review step, showing payee, amount and job id.

After `start-sign`, Playwright's snapshot at failure shows Privy's "Sign message" dialog for the second
signature, the USDC payment authorization (domain USDC v2, chainId 5042002, to the escrow, value
10000, nonce = the job id). It reads "An error has occurred, please try again.", and its
`button "Sign and continue"` is still active. The console's button reads "Waiting for your wallet".
The first signature, the countersignature, went through. No result ever appeared, so the run failed
two minutes later.

## Changes

### `e2e/human/lib/privy.ts`, `approveIfPrompted(page)`

After clicking a dialog button named `/^(sign|approve|confirm)/i` (scoped to `page.getByRole("dialog")`):

- Wait up to 15 s for one of two things: the button is no longer visible (the prompt closed), or the
  dialog shows text matching `/an error has occurred|please try again/i`.
- If the error shows and the button is still visible, wait 2 s and click it again. That is at most 3
  clicks for one prompt.
- Return how many clicks the prompt took. If 3 clicks still end in the error, throw
  `Privy could not sign: "An error has occurred, please try again" after 3 tries`.

### `e2e/human/tests/buy.spec.ts`

- Wherever `approveIfPrompted` is called, a prompt that took more than one click adds a run note:
  `Privy's signature needed <n> clicks: "An error has occurred, please try again" (UX gap, cs-ui)`.
- Privy project only: record every page console message (type and text, text cut to 500 characters)
  and every `pageerror` into `artifacts/<run>/privy/console.log`.
  - It is a local artifact. The privy project's artifacts are never uploaded, and the leak scan
    already covers text artifacts.
  - Never write a request or response body into it, only console messages.

## Tests (`bun test e2e/human/test`)

- With a fake dialog that shows the error once and then closes, `approveIfPrompted` clicks twice and
  returns 2.
- With one that errors three times, it throws the message above.
- With one that closes after the first click, it clicks once.

## Gate (all four; paste the tails)

1. `bun install --linker hoisted && bun run typecheck` clean.
2. `bun test e2e/human/test` and `bun test e2e/test` all pass.
3. Under Node: `cd e2e && npx playwright test -c human/playwright.config.ts --list` lists the two tests.
4. `git status --short e2e/human/runs` shows nothing new.

## Constraints

- No browser of any kind on this machine: `--list` only, never a test run, no `playwright install`.
- **Never run `git stash`;** use a temporary commit or a second worktree.
- Touch only `e2e/human/**`. Never read or print a key or the Privy login.
- Never push, merge or deploy. Small present-tense commits on `cs/cs-69`, with no emoji, no
  Co-authored-by and no trailers.
- If something cannot be done as written, stop and say exactly what and why.

## Report

`.packets/reports/cs-69-e2e-privy-sign-retry.md`: the changes with line ranges, and the gate outputs.
