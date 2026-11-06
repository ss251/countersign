# cs-65-e2e-honest-rails: production keeps only rails that return money; the suite says so

Lane: cs-e2e. Base: `cs/e2e`. Branch: `cs/cs-65`. Captain, about 23:40 IST: production drops the
Gateway and plain x402 Hedera rails by flag, because both debit before the seller runs and cannot be
reversed. Production's `/rails` must list exactly `escrow`, `whitechain` and `hedera-scheduled`. The
suite retires the flows that test the removed rails, with that reason, and keeps the held flows.

## 1. Retire five flows

Each of these gets
`notRun: () => "retired: <rail> was removed from production by flag (captain, 23:40 IST): it debits before the seller runs and cannot be reversed"`,
replacing its existing `notRun`, if any. `<rail>` is `the Gateway rail` or `plain x402 Hedera`, as listed.
Nothing else in these flows changes, so their code and assertions stay in the file, to restore by
deleting one line.

| flow | file | rail |
|---|---|---|
| 10 `arc-gateway` | `e2e/flows/arc-gateway.flow.ts` | the Gateway rail |
| 16 `public-gateway` | `e2e/flows/public-gateway.flow.ts` | the Gateway rail |
| 6 `hedera` | `e2e/flows/hedera.flow.ts` | plain x402 Hedera |
| 15 `public-hedera` | `e2e/flows/public-hedera.flow.ts` | plain x402 Hedera |
| 17 `hedera-mcp` | `e2e/flows/hedera-mcp.flow.ts` | plain x402 Hedera; append ". Its Agent Kit offer is paid held in flow 21" |

Because a flow that reports NOT RUN reserves no funds, also make the budget planner skip any flow whose
`notRun(env)` returns a reason. If `planBudget` already filters on `notRun`, change nothing there. Say
which applies.

The held flows `hedera-schedule` (20), `hedera-held` (21) and `hedera-held-undelivered` (21b) do not
change: they stay on demand. `erc8004-identity` (18) does not change.

## 2. production-hub requires exactly the honest set

In `e2e/flows/production.flow.ts`, the step "production declares every rail it claims":

- The default for `E2E_PUBLIC_RAILS` becomes `"escrow,hedera-scheduled,whitechain"`.
- Keep the existing check that every wanted rail is declared.
- Add: production declares **no other** rail. If it does, fail with
  `production declares <ids> beyond the rails that return money (escrow, hedera-scheduled, whitechain)`.
- Rename the step "production declares exactly the rails that return money".

## 3. Docs

In `docs/e2e.md`:

- The flow table rows for 6, 10, 15, 16 and 17 say "retired" with the reason.
- The Hedera paragraph above flow 6, and the 14b description, say production declares exactly escrow,
  Whitechain and held Hedera, and why.

## Tests (`bun test e2e/test`)

Add one offline test: a flow whose `notRun` returns `"retired: ..."` is reported as
`NOT RUN (retired: ...)`, and the budget plan reserves nothing for it.

## Gate

1. `bun install --linker hoisted && bun run typecheck` clean.
2. `bun test e2e/test` and `bun test e2e/human/test` all pass.
3. `bun run e2e -- --list` shows the five flows as `NOT RUN (retired: ...)`.

## Constraints

- No browser of any kind on this machine. Do not run any flow (`--list` only); flows move real funds.
- **Never run `git stash`;** use a temporary commit or a second worktree.
- Touch only `e2e/flows/*.ts`, `e2e/lib/budget.ts` if step 1's budget note needs it, `e2e/test/**` and
  `docs/e2e.md`. Never read or print a key.
- Never push, merge or deploy. Small present-tense commits on `cs/cs-65`, with no emoji, no
  Co-authored-by and no trailers.
- If something cannot be done as written, stop and say exactly what and why.

## Report

`.packets/reports/cs-65-e2e-honest-rails.md`: each change with line ranges, the budget note, and the gate
outputs.
