# cs-82 · e2e accepts facilitator-paid only "hedera", hedera-scheduled first

## Change

`e2e/lib/rails.ts` (new, 1-25)
- `RETURN_MONEY_RAILS` (lines 2-7): record of the four rails that return money, each with what it
  returns. `hedera` is labelled "facilitator-paid only: x402 exact settles after delivery; a
  wallet-paid claim settles first".
- `undeclaredRails` (lines 10-12): own-property guard, so inherited names such as `toString` are
  declared-rail candidates, not rails.
- `railOrderProblem` (lines 19-25): when `hedera` is declared, `hedera-scheduled` must come before it;
  returns the problem or null.

`e2e/flows/production.flow.ts` (modified)
- Lines 15-18: import `railOrderProblem`, `RETURN_MONEY_RAILS`, `undeclaredRails` from
  `../lib/rails.ts`; the local `RETURN_MONEY_RAILS` array (old line 21) is deleted.
- Lines 155-169: step renamed to "production declares only the rails that return money,
  hedera-scheduled before hedera". `extra` now comes from `undeclaredRails(ids)`; the failure text
  still lists `Object.keys(RETURN_MONEY_RAILS).join(", ")`. After the two checks the ordering check
  runs (`railOrderProblem`, `check(order === null, order ?? "")`), then when `hedera` is declared a
  note carries the label and the evidence (`#321` on main `c6f3a21`).
- Default of `want` is unchanged: `escrow,hedera-scheduled,whitechain`. `hedera` is allowed, not
  required. Nothing else changed.

`e2e/test/rails.test.ts` (new, 1-52)
- `undeclaredRails`: accepts the pre-#321 list; accepts `["escrow","hedera"]`; names
  `["gateway","x402-direct"]`; rejects inherited names `["toString","constructor"]`.
- `RETURN_MONEY_RAILS.hedera` contains "facilitator-paid only"; keys sort to exactly
  `["escrow","hedera","hedera-scheduled","whitechain"]`.
- `railOrderProblem`: null for production's order and for a list without `hedera`; a string
  containing "before" when `hedera` precedes `hedera-scheduled`; a string containing "without
  hedera-scheduled" when `hedera` is declared alone.

## Gate

1. `bun install --linker hoisted && bun run typecheck`

```
749 packages installed [7.17s]
$ tsc -p tsconfig.json
```

(clean; `bun install` mode-changed `packages/cli/src/bin.ts` to 100755, reverted with
`git checkout -- packages/cli/src/bin.ts`.)

2. `bun test e2e/test`

```
 60 pass
 0 fail
 142 expect() calls
Ran 60 tests across 4 files. [8.47s]
```

3. `git status --short e2e/runs e2e/human/runs`

```
(no output)
```
