# cs-60b-e2e-human-fix: corrective for cs-60

Status: code and offline tests complete at `4fbb923` on `cs/cs-60`. No browser was launched and no
test run happened; only `--list` was used. The gate is green.

## Commits on cs/cs-60

```
704a534 ci: keep the human run input out of the shell and upload only the injected project
7650895 e2e: keep the privy login out of every artifact
bb4e0f0 e2e: fail and skip the human run honestly
35c71e9 e2e: drive the console by its real ids and prove the purchase on chain
4fbb923 e2e: cover the human helpers offline
```

`704a534` is the workflow commit, alone. No later commit touches
`.github/workflows/human-e2e.yml`. `bun.lock` is not in any commit; it was restored with
`git checkout -- bun.lock` after the install and after the `--list` gate.

## A. The privy project leaves no secret in any artifact

- **A1, no trace for `privy`.** `e2e/human/tests/buy.spec.ts` 239-243 starts tracing only for the
  injected wallet; 271-281 has no `context.tracing.start` after Privy sign-in. A `privy` run writes
  no `trace.zip`.
- **A2, no screenshot while the dialog is open after typing.** `e2e/human/tests/buy.spec.ts` 280
  waits for `page.getByRole("dialog")` to be hidden (30 s) before the signed-in screenshot at 281.
  The empty-modal screenshot at 273 remains before typing.
- **A3, the verifier's minimal env.** `e2e/human/tests/buy.spec.ts` 462-467 passes exactly
  `env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", NO_COLOR: "1" }` to
  `spawnSync`; the child inherits no keys.
- **A4, the leak scan always runs.** `e2e/human/lib/report.ts` 385-409 finalizes a run even when it
  has no per-project state, and 422-427 calls it unconditionally; the early
  `if (projects.length === 0) return;` is gone. `finalizeReport` scans `artifacts/<run-id>/` before
  rendering the report, then redacts the report text (337-365).

## B. Fail and skip honestly

- **B1, outage detection.** `e2e/human/lib/privy.ts` 31-52 records only `privy.io` responses with
  status >= 500 and failed requests whose error text does not contain `ERR_ABORTED`.
  `e2e/human/tests/buy.spec.ts` 167-174 routes both page events through those helpers, and 271
  clears the list immediately before the click on the Privy option.
- **B2, "Privy not offered".** `e2e/human/tests/buy.spec.ts` 264-269 skips with
  `Privy unavailable: ...` when the outage list is non-empty at that moment, and otherwise keeps the
  `Privy not offered` failure.
- **B3, no falsy throw.** `e2e/human/lib/failure.ts` 1-4 holds the boolean-flag throw:
  `if (failed) throw failure instanceof Error ? failure : new Error(String(failure));`.
  `e2e/human/tests/buy.spec.ts` 228 declares `failed`, 490-498 sets it in the catch, 509-512 uses it
  for the report error, and 516 raises through the helper.
- **B4, step 08 never fails.** `e2e/human/tests/buy.spec.ts` 85-103 adds `softStep`, which puts the
  entry screenshot and the body in one try/catch and records a note instead of a step failure.
  478-487 runs the change return through it. `e2e/human/lib/report.ts` 182-184 and 266-270 store and
  render notes.

## C. Drive the console by its actual ids

`e2e/human/tests/buy.spec.ts`:

- 105-133: `testId`, and `waitAttr` with the exact missing-attribute failure
  `the console does not expose <id>[<attribute>] (cs-ui)`.
- 246-304: `wallet-menu` opens the menu; `wallet-signin` or `wallet-connect-injected` is chosen;
  `wallet-fallback-reason` explains an absent Privy; `wallet-address` reads `data-value` and
  `data-kind` (`privy`/`injected`); `wallet-chain` reads `data-value` and must be `5042002`, with one
  click on the `switch to arc` button and a re-read.
- 324-350: `/#/start`, `start-buy` visible, `start-offer` visible and its text recorded,
  `start-countersign` enabled and clicked, `approveIfPrompted` twice, `start-refusal` fails with its
  text, `start-fund-result` reads a tx hash, `start-slip` visible and the slip hash parsed from
  `start-verify`'s `href`.
- 457-460: `start-verify` is clicked, the URL is `#/verify/<hash>`, and `verify-verdict` reaches
  `data-state="valid"` within 60 s.

Every old id is gone: no `wallet-connect` (apart from the new `wallet-connect-injected`),
`wallet-option-*`, `wallet-kind`, `wallet-usdc`, `wallet-switch-chain`, `offer-*`, `buy-*` or
`slip-*`. The `wallet-usdc` check is dropped; balances are read on chain.

## D. Prove the purchase on chain from the slip

`e2e/human/tests/buy.spec.ts`:

- **D1.** 352-359: `GET <hub>/slips/<hash>` must answer 200; the body is written to
  `artifacts/<run>/<project>/slip.json`.
- **D2.** 367-370: the slip buyer equals the wallet address, case-insensitive.
- **D3.** 372-401: `getLogs` on `ARC.escrow` for the v1 `Funded(bytes32,bytes32,address,address,uint256,uint64)`
  event with `args: { jobId }`, from the funding receipt's block to latest. Exactly one log is
  required; its `transactionHash` is recorded as "escrow fund"; buyer, amount and offer hash are
  checked against the slip.
- **D4.** 403-435: the same restricted query for `Released` must return exactly one log, whose
  `slipHash` is the console's slip hash; its tx is recorded as "release".
- **D5.** 437-447: the `start-fund-result` tx receipt succeeds and contains a `Funded` or `Released`
  escrow event for the job id.
- **D6.** 449-453: the wallet's USDC after the purchase equals the step-4 balance minus
  `body.amount` exactly.
- **D7.** 462-475: the standalone verifier runs with the minimal env from A3 and its last non-empty
  stdout line is exactly `VALID`.

The event signatures are the `parseAbiItem` forms at 45-50, matching `escrowAbi` in
`packages/rail/src/escrow/abi.ts` and the verifier's own `Released` signature.

## E. Offline tests

- `e2e/human/test/report.test.ts` 115-135: with no `result.json`, the run is still finalized, a
  planted artifact is deleted, the exit code is 1, and the report says `No project ran.`
- `e2e/human/test/failure.test.ts` 14-21: empty string and zero thrown values still fail.
- `e2e/human/test/privy.test.ts` 5-18: `ERR_ABORTED` is ignored; a 503 and a real connection failure
  count; a non-Privy 503 does not.
- `e2e/human/test/slip.test.ts` 7-20: `#/verify/0x` plus 64 hex is accepted, short/long/trailing and
  other paths are rejected.

## Gate outputs

```
$ bun install --linker hoisted && bun run typecheck
bun install v1.3.14 (0d9b296a)

Checked 266 installs across 280 packages (no changes) [92.00ms]
$ tsc -p tsconfig.json
exit=0
```

```
$ bun test e2e/human/test

 29 pass
 0 fail
 78 expect() calls
Ran 29 tests across 8 files. [583.00ms]
exit=0
```

```
$ bun test e2e/test

 21 pass
 0 fail
 66 expect() calls
Ran 21 tests across 1 file. [7.48s]
exit=0
```

```
$ cd e2e && npx playwright test -c human/playwright.config.ts --list
Listing tests:
  [privy] › buy.spec.ts:521:16 › the human acceptance run
  [injected] › buy.spec.ts:521:16 › the human acceptance run
Total: 2 tests in 1 file
exit=0
```

The gate commands ran with `E2E_ENV_DIR=/nonexistent` and the secret names unset, so the reporter
read no key file. The `--list` run now finalizes an empty run (A4), which wrote
`e2e/human/runs/<id>.md`; that generated run and `artifacts/<id>/` were removed before the final
commit check.

## Notes and deviations

- **The hub wraps the slip.** `GET /slips/:hash` returns `{ body: { jobId, offerHash, amount,
  buyer }, hash, ... }`, not top-level fields. `slipFieldsOf` (`buy.spec.ts` 183-208) reads the
  nested `body` and accepts a bare body too, so `body.jobId`, `body.offerHash`, `body.amount` and
  `body.buyer` are the slip's own fields.
- **The console branches as fetched do not yet carry every attribute.** `origin/cs/ui-A2` exposes
  `wallet-address` and `wallet-chain` as text, without `data-value`/`data-kind`;
  `origin/cs/ui-B` exposes `start-fund-result` without `data-value`, and the verify route has no
  `verify-verdict`. The flow therefore fails at run time with the prescribed
  `the console does not expose <id>[<attribute>] (cs-ui)` message until cs-ui lands the attribute
  contract from this packet. Nothing was guessed from visible text.
- **`--list` now reads secret names.** Removing the early return means the reporter builds the
  keyring even for an empty run. Values are only registered with the redactor and never printed;
  the gate used a missing env directory so no real key file was read. In CI this is the intended
  always-on leak scan.
- **`bun.lock` needs orch-cs.** `bun install --linker hoisted` made no changes, and the lockfile was
  restored before every commit. It still does not contain `@playwright/test@1.64.1` on this branch,
  so orch-cs must update it on `cs/int` before the workflow can use `--frozen-lockfile`.
- No transaction was sent, no production console or hub was called, and no browser or
  `playwright install` ran.
