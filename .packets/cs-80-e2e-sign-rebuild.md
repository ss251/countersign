# cs-80-e2e-sign-rebuild: the console rebuilds the terms at every Sign, so the review's job id is not the signed one

Lane: cs-e2e. Base: `cs/e2e`. Branch: `cs/cs-80`. URGENT: STEER-0300 C1 is live, and without this change
every e2e/human run, the nightly included, is red at 06-prove.

## Evidence

- **What #293 does.** STEER-0300 C1's fix (cs-ui #293, live in console index-Bng4_Cpy.js) rebuilds the
  authorization at every Sign: a fresh salt, so a fresh job id, and a fresh deadline (cs-w1 21:31:52Z).
  The job id the review shows is never the one the person signs.
- **Run 20261106-213938-a8b6 (privy, no delay).** The purchase settled: release `0x86c5…a945` status 1,
  slip `0x7c46…1dbc` VALID with `--rpc`. The record is still red at 06-prove with
  "the review showed 0x3597…5d9c, but the slip's jobId was 0x8f78…cbc7". The payee and amount matched.

The old assertion (job id equality) was a stand-in for "the console signed what it showed". After C1,
what the person consents to is the material terms (offer, payee and amount), and a material change goes
back to review unsigned. This change was posted as one line before merging (RUN-STATE 21:41Z).

## Change `e2e/human/lib/review.ts`, `compareSettlement`

- The payee and the amount must still equal the review's; those throws do not change.
- A different job id is allowed in every case, whatever the delay. It returns the note
  `the console rebuilt the terms at Sign: job ${short(review.job)} -> ${short(settlement.job)}`.
- Keep the `signDelayS` parameter so the callers do not change.
- When `signDelayS > 0`, keep the existing wait note in the spec as it is.

Change nothing else. Every on-chain check in step 06 stays against the slip's job id: Funded and
Released by that job, the listed price and payee, and the verifier's VALID.

## Tests (`e2e/human/test/review.test.ts`)

- Replace "with no delay, a different job id fails" with "with no delay, a different job id passes and
  returns the rebuilt note".
- Keep: a different payee fails, and a different amount fails, with and without a delay.
- Keep: the same job id returns no note.

## Gate (all four; paste the tails)

1. `bun install --linker hoisted && bun run typecheck` clean.
2. `bun test e2e/human/test` and `bun test e2e/test` all pass.
3. Under Node: `cd e2e && npx playwright test -c human/playwright.config.ts --list` lists the two tests.
4. `git status --short e2e/human/runs` shows nothing new.

## Constraints

- No browser of any kind: `--list` only, never a test run, no `playwright install`.
- **Never run `git stash`;** use a temporary commit or a second worktree.
- Touch only `e2e/human/lib/review.ts` and `e2e/human/test/review.test.ts`. Never read or print a key, the
  Privy login or a token.
- Never push, merge or deploy. Make one small present-tense commit on `cs/cs-80`, with no emoji, no
  Co-authored-by and no trailers.
- If something cannot be done as written, stop and say exactly what and why.

## Report

`.packets/reports/cs-80-e2e-sign-rebuild.md`: the change with line ranges, and the gate outputs.
