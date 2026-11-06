# cs-79-e2e-stale-sign: the STEER-0300 C1 stale case, a wait between the review and Sign that must still settle

Lane: cs-e2e. Base: `cs/e2e`. Branch: `cs/cs-79`. URGENT: QA round 2's C1 is the project lead's critical
path, and the purchase beat of the 03:30 recording waits for it.

## Evidence

STEER-0300 C1 asks for proof. On production, a Privy purchase that settles. Plus the stale case: wait
3 minutes after the pre-sign, then Sign, and it must still settle.

cs-truth (21:23:33Z) found the cause. The console signs `deadline = prepare time + offer deadline`. At
verify, the hub requires `terms.deadline >= now + offer.deadline - 15 s`. So any gap over about 15 s
between the review (prepare) and Sign is refused today. Our test passes only because it signs within
seconds of the review.

cs-ui's fix re-prepares the terms at Sign: a fresh 402, so a fresh job id. After a correct fix, the job
id that settles in the stale case is a fresh one, not the one the review showed before the wait.

## Change `e2e/human/tests/buy.spec.ts`, step 05, both projects

1. Read `const signDelayS = Number(process.env.E2E_HUMAN_SIGN_DELAY_S ?? "0")`. It must be an integer from
   0 to 600; anything else fails at once with "E2E_HUMAN_SIGN_DELAY_S must be 0..600".
2. If `signDelayS > 0`: after the review values are read and the `05-review` screenshot is taken, and
   before clicking `start-sign`:
   - Add the note `waited ${signDelayS} s between the review and Sign (STEER-0300 C1 stale case)`.
   - Wait with `await page.waitForTimeout(signDelayS * 1000)`.
   - Raise this test's timeout by the delay with `test.setTimeout(...)`, so the 10-minute test timeout
     still covers the rest.
3. Everything after `start-sign` stays as it is.

## Change step 06, "prove", and the review-against-slip comparison

- With `signDelayS === 0`, nothing changes: the slip's job id must equal the review's.
- With `signDelayS > 0`:
  - The payee and the amount must still equal the review's.
  - The job id may differ. If it does, add the note
    `the console re-prepared the terms at Sign: job ${short(reviewJob)} -> ${short(slipJob)}`.
  - Every on-chain check stays exactly as it is, against the slip's job id: Funded and Released by that
    job id, the listed price and payee, and the verifier's VALID.

## Tests (`bun test e2e/human/test`)

- If the comparison is a pure helper (for example in `lib/review.ts`), add these tests:
  - with no delay, a different job id fails;
  - with a delay, a different job id passes and returns the note;
  - with a delay, a different payee or amount still fails.
- If it is not a pure helper, factor it into one. Do not change its behaviour for `signDelayS === 0`.

## Gate (all four; paste the tails)

1. `bun install --linker hoisted && bun run typecheck` clean.
2. `bun test e2e/human/test` and `bun test e2e/test` all pass.
3. Under Node: `cd e2e && npx playwright test -c human/playwright.config.ts --list` lists the two tests.
4. `git status --short e2e/human/runs` shows nothing new.

## Constraints

- No browser of any kind: `--list` only, never a test run, no `playwright install`.
- **Never run `git stash`;** use a temporary commit or a second worktree.
- Touch only `e2e/human/**`. Never read or print a key, the Privy login or any token.
- Never push, merge or deploy. Make small present-tense commits on `cs/cs-79`, with no emoji, no
  Co-authored-by and no trailers.
- If something cannot be done as written, stop and say exactly what and why.

## Report

`.packets/reports/cs-79-e2e-stale-sign.md`: the changes with line ranges, and the gate outputs.
