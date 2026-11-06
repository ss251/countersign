# cs-81-e2e-slip-escrow: e2e/human proves the purchase on the escrow production declares, not a hard-coded v1

Lane: cs-e2e. Base: `cs/e2e`. Branch: `cs/cs-81`. URGENT: STEER-0300 C2 moved production Arc to escrow v2
(`0x10A3c07cc6A519C0106e315D2C42010eCbEFF3CE`, live 21:49:38Z). Without this change, every CI run of the
human suite (the nightly, and any dispatch) is red at 06-prove although the purchase succeeds.

## Evidence

In `e2e/human/tests/buy.spec.ts`, step 06 reads Funded and Released with `address: ARC.escrow` in three
places (the Funded logs, the Released logs, and the Released retry loop). It also decodes the result
receipt with `escrowEvents(ARC, ...)`.

`ARC.escrow` is v1 unless `E2E_ESCROW_VERSION=2` is set, and CI never sets it. Run
20261106-215011-2e07 passed only because the lane set that switch by hand.

The slip itself names the escrow (`body.escrow`), and so does production's `/rails`: the rail with id
`escrow` has an `escrow` field. Reading at the slip's escrow is right on v1 and on v2, including a revert.

## Change `e2e/human/tests/buy.spec.ts`, step 06 only

1. Read the slip's escrow. Extend `SlipFields` and `slipFieldsOf` with `escrow: Address`, from
   `body.escrow`. It must match `/^0x[0-9a-fA-F]{40}$/`; otherwise fail with "the slip names no escrow".
2. Fetch `${hub}/rails`, find the rail whose `id` is `"escrow"`, and read its `escrow` address with a new
   pure helper `escrowRailAddress(rails: unknown): string | null` in `e2e/human/lib/slip.ts`.
   - The slip's escrow must equal it, case-insensitively. Otherwise fail with
     `the slip's escrow ${slip.escrow} is not the escrow production declares (${declared})`.
   - Add the note `escrow: ${slip.escrow}`.
3. In the three `client.getLogs` calls, replace `address: ARC.escrow` with `address: slip.escrow`.
4. Where step 06 calls `escrowEvents(ARC, resultReceipt)`, pass `{ ...ARC, escrow: slip.escrow }` instead
   of `ARC`.
5. Nothing else changes. Every assertion stays: one Funded log for the job with the listed payee and
   price, Released for the slip, the review comparison, and the verifier's VALID.

## Tests (`bun test e2e/human/test`)

`escrowRailAddress`:

- a `/rails` body with an escrow rail returns its address;
- a body with no escrow rail returns null;
- a non-object returns null.

Use made-up addresses.

## Gate (all four; paste the tails)

1. `bun install --linker hoisted && bun run typecheck` clean.
2. `bun test e2e/human/test` and `bun test e2e/test` all pass.
3. Under Node: `cd e2e && npx playwright test -c human/playwright.config.ts --list` lists the two tests.
4. `git status --short e2e/human/runs` shows nothing new.

## Constraints

- No browser of any kind: `--list` only, never a test run, no `playwright install`.
- **Never run `git stash`;** use a temporary commit or a second worktree.
- Touch only `e2e/human/tests/buy.spec.ts`, `e2e/human/lib/slip.ts` and `e2e/human/test/**`. Never read or
  print a key, the Privy login or a token.
- Never push, merge or deploy. Make one small present-tense commit on `cs/cs-81`, with no emoji, no
  Co-authored-by and no trailers.
- If something cannot be done as written, stop and say exactly what and why.

## Report

`.packets/reports/cs-81-e2e-slip-escrow.md`: the change with line ranges, and the gate outputs.
