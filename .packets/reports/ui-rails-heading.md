# ui-rails-heading — report

Date: 2026-11-07
Branch: `cs/ui-rails-heading`
Commits: `ba65c6a`, `982679a`

## Landed

- `apps/web/src/routes/home/field.ts` keeps `railOrder` unchanged, so a rail named only by a past settlement still gets its group in the field. It adds:
  - `WORDS`, the number words moved from `Evidence.tsx`, unchanged.
  - `isRetired(rail, rails)`: false when `rails` is undefined, otherwise true when the hub does not declare the rail.
  - `retiredLabel(name)`: `Retired: ${name}`.
  - `railsLine(rails, order)`: with declarations, the hub's declared count and `live`; with no declarations, the old `order.length` line and no claim of live.
- `otherRailsLines` now says `Held Hedera moves only when the seller and the hub both sign.` instead of the seller's-key sentence.
- `Evidence.tsx` renders beat 2 through `railsLine(rails, order)`, and names a retired rail through `retiredLabel` in both the field groups and the screen-reader ledger. Positions, counts, marks and CSS are unchanged. The top comment now reads `2 "On three live rails."`.
- The only existing assertion changed is `apps/web/test/landing.test.ts` lines 178–181: the old Hedera sentence became the new one, with the captain's A4 evidence comment on the line above. No other existing test asserted `On five rails.` or the old sentence. `apps/web/test/terms.test.ts` asserts a different `lib/terms.ts` sentence and was left alone, as were `lib/terms.ts` and `terms.test.ts`.

## Tests

`apps/web/test/rails-heading.test.ts`, with no browser and no network:

- Three declared rails (escrow, whitechain, hedera-scheduled) plus gateway and hedera in `order` give exactly `On three live rails.`; one declaration gives `On one live rail.`
- `railsLine(undefined, ["escrow", "gateway"])` is `On two rails.`
- Gateway is retired against the three declarations, escrow is not, and undefined rails retire nothing; `retiredLabel("Arc · Gateway")` is `Retired: Arc · Gateway`.
- A held Hedera declaration (kind escrow, `hedera:testnet`, no contract) makes `otherRailsLines` contain the new sentence.
- Every file under `apps/web/src/routes/home` is scanned for `release it without delivering`; none contains it.

## Acceptance

From the worktree root:

```
bun install --linker hoisted
bun run typecheck
bun test apps/web/test
(cd apps/web && bunx --bun vite build)
bun apps/web/scripts/wallet-grep.ts apps/web/dist
```

Results: install clean; typecheck clean; `355 pass, 4 skip, 0 fail` across 40 files (the skips are the pre-existing `CS_LIVE=1` suite); vite build succeeded; wallet-grep read 84 bundle files and found no approval or permit selector and no approve, permit, eth_sign, personal_sign or eth_requestAccounts from our code.

## Notes

- No browser of any kind was launched. No dependencies added, no `any`, and `git stash` was not run.
- `packages/cli/src/bin.ts` already had a mode-only change in the worktree before this packet; it was not touched or committed.
- Nothing was pushed, merged or deployed.
