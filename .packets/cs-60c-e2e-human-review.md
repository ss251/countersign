# cs-60c-e2e-human-review: the purchase's review step, and what it showed is what got paid

Lane: cs-e2e. Branch: `cs/cs-60`, continuing from its head (`48af6f9` or later). cs-ui's STEER-2225 hygiene
(PR #196, which now carries #187 and #190) adds one step before the wallet opens. The e2e/human run must
take that step, and must prove that the review a person reads is exactly what they sign and pay.

## The console's new step (cs-ui, 16:46:30Z)

1. Click `start-countersign`. Nothing is signed yet.
2. `start-review` appears, showing `start-payee`, `start-amount` and `start-job`, each with its full
   value in `data-value`.
3. Click `start-sign`. Only this opens the wallet.
4. `start-cancel` drops it and shows "Nothing was signed". The run does not use it.

## Change `tests/buy.spec.ts`, the buy step

- After clicking `start-countersign`, wait up to 30 s for `start-review` to be visible. Read the three
  `data-value`s. A missing one fails as `the console does not expose <id>[data-value] (cs-ui)`.
  - `start-payee` must match `^0x[0-9a-fA-F]{40}$`.
  - `start-amount` must match `^[0-9]+$` (atomic USDC).
  - `start-job` must match `^0x[0-9a-fA-F]{64}$`.
  - Record all three in the run's notes.
- Take the step's screenshot while the review is showing. That screenshot never shows a Privy field.
- Click `start-sign`. Then call `approveIfPrompted` up to twice, as before, and wait for
  `start-fund-result` or `start-refusal`, as before.

## Change `tests/buy.spec.ts`, the on-chain proof step

Add these, after the existing checks:

- The slip's `jobId` equals `start-job`.
- The slip's `amount` equals `start-amount`.
- The `Funded` log's `payee` equals `start-payee`, case-insensitive.
- On failure, name both values: `the review showed <x>, but <what> was <y>`.

Every existing check stays: the listed price and payee, `Funded`, `Released`, the balance, the console
verdict and the verifier's `VALID`.

## Tests (`bun test e2e/human/test`)

Add a unit test for the review values' parsing: a valid set passes, and each malformed value is refused
with its id named. Keep the parsing in a small pure function so it can be tested.

## Gate (paste the tails in your report)

1. `bun install --linker hoisted && bun run typecheck` clean.
2. `bun test e2e/human/test` and `bun test e2e/test` all pass.
3. `cd e2e && npx playwright test -c human/playwright.config.ts --list` lists the two tests, and
   `git status --short e2e/human/runs` shows nothing new.

## Constraints

- **No browser of any kind on this machine:** `--list` only, never a test run, no `playwright install`.
- **Never run `git stash`;** use a temporary commit or a second worktree.
- Touch only `e2e/human/**`. Never commit `bun.lock`. Never read or print a real key or the Privy login.
  Never move funds and never call production.
- Never push, merge or deploy. Small present-tense commits on `cs/cs-60`, with no emoji, no
  Co-authored-by and no trailers.
- If something cannot be done as written, stop and say exactly what and why.

## Report

`.packets/reports/cs-60c-e2e-human-review.md`: the changes with line ranges, and the gate outputs.
