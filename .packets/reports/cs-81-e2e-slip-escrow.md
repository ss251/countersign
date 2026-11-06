# cs-81-e2e-slip-escrow report

Lane: cs-e2e. Base: `cs/e2e`. Branch: `cs/cs-81`.

## Change

### `e2e/human/lib/slip.ts`

Lines 7-21: `escrowRailAddress(rails: unknown): string | null`. A non-object, a body with no
`rails` array, or a body with no rail whose `id` is `"escrow"` returns null. The escrow rail's
`escrow` field is returned only when it is a `0x` address; otherwise null.

### `e2e/human/tests/buy.spec.ts`

- line 45: imports `escrowRailAddress`.
- lines 214-220: `SlipFields` gains `escrow: Address`.
- lines 222-262: `slipFieldsOf` reads `body.escrow` (line 234) and fails with
  `the slip names no escrow` (line 248) unless it matches `/^0x[0-9a-fA-F]{40}$/`.
- lines 503-517, step 06: fetches `${hub}/rails`, reads the declared address with
  `escrowRailAddress`, fails with
  `the slip's escrow <slip> is not the escrow production declares (<declared>)` unless the two
  match case-insensitively, and notes `escrow: <slip.escrow>`.
- line 540: the Funded `getLogs` reads `address: slip.escrow`.
- line 588 and line 598: the Released read and its retry read the same address.
- line 625: `escrowEvents({ ...ARC, escrow: slip.escrow }, resultReceipt)`.

No assertion changed: one Funded log for the job with the listed payee and price, Released for
the slip, the review comparison, the balance delta, and the verifier's VALID all stay.

### `e2e/human/test/slip.test.ts`

Lines 23-49: three tests for `escrowRailAddress` — a `/rails` body with an escrow rail returns
its address; a body with no escrow rail returns null; a non-object returns null. Addresses are
made up.

## Gate

### 1. Install and typecheck

```text
$ bun install --linker hoisted
749 packages installed [10.01s]

$ bun run typecheck
$ tsc -p tsconfig.json
```

Exit code 0; no diagnostics.

### 2. Offline tests

```text
$ bun test e2e/human/test
 76 pass
 0 fail
 204 expect() calls
Ran 76 tests across 10 files. [2.00s]
```

```text
$ bun test e2e/test
 50 pass
 0 fail
 132 expect() calls
Ran 50 tests across 3 files. [8.47s]
```

The `leak:` lines printed by the report tests are the leak scan's expected output for its planted
fixtures; the suite still reports 0 fail.

### 3. Playwright list

```text
$ cd e2e && npx playwright test -c human/playwright.config.ts --list
Listing tests:
  [privy] › buy.spec.ts:788:16 › the human acceptance run
  [injected] › buy.spec.ts:788:16 › the human acceptance run
Total: 2 tests in 1 file
```

### 4. Runs directory

```text
$ git status --short e2e/human/runs
(no output)
```

## Notes

- No browser was used and no Playwright test was run; only `--list`. No `playwright install`.
- `git stash` was not used. No key, Privy login or token was read or printed.
- `bun install` flipped the file mode of `packages/cli/src/bin.ts`; the mode was restored, so the
  file is not in the diff.
