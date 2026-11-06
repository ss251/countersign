# cs-60c-e2e-human-review: the review a person reads is what gets signed and paid

Status: complete on `cs/cs-60`, two e2e commits and this report on top of `48af6f9`. No browser was
launched, no human run happened, no `playwright install` ran, no funds moved and no production
console or hub was called. Only `--list` was used.

## Commits

```
8cf3b8f e2e: test the review values' parsing
8c1dc10 e2e: take the console's review before the wallet opens
48af6f9 Merge remote-tracking branch 'origin/cs/int' into cs/cs-60
```

`bun.lock` was already modified at the start of the lane and remains uncommitted; no commit contains
it. `start-cancel` is never used.

## 1. The buy step takes the review before the wallet opens

`e2e/human/lib/review.ts`:

- **6-12: the three ids and their shapes.** `start-payee` is `^0x[0-9a-fA-F]{40}$`, `start-amount`
  is `^[0-9]+$` (atomic USDC), and `start-job` is `^0x[0-9a-fA-F]{64}$`. `REVIEW_FIELD` is the one
  source of those patterns for both the run and the pure parser.
- **14-18: `Review`.** The payee and job stay the console's strings; the amount is a `bigint` so it
  compares directly with the slip's amount.
- **20-31: `read`.** A missing or null value fails as
  `the console does not expose <id>[data-value] (cs-ui)`; a malformed value names the id and shows
  the value it refused.
- **33-39: `reviewValuesOf`.** The small pure function the offline suite tests. It reads all three
  values, converts the atomic amount and returns `{ payee, amount, job }`.

`e2e/human/tests/buy.spec.ts`:

- **31: import** of `REVIEW_FIELD` and `reviewValuesOf`.
- **364-381: the review step.** After `start-countersign` is enabled and clicked, `start-review` must
  be visible within 30 s. The three `data-value`s are read, each within 30 s, through the shared
  patterns; a missing one fails with the cs-ui message above. All three go into the run's notes.
  `05-review.png` is taken while the review is showing, before `start-sign`, so it cannot show a
  Privy field. Only then is `start-sign` clicked, followed by the same two `approveIfPrompted`
  calls, the same `start-fund-result`/`start-refusal` wait and the same slip/verify-link checks.
- **394: the review travels with the purchase.** The buy step returns `{ hash, slipHash, review }`.

## 2. The on-chain proof checks what the review showed

`e2e/human/tests/buy.spec.ts`:

- **412-421: the slip.** After the existing buyer check, `slip.jobId` must equal `start-job`
  (case-insensitive hex) and `slip.amount` must equal `start-amount`. A mismatch fails as
  `the review showed <x>, but the slip's jobId/amount was <y>`.
- **457-474: the `Funded` log.** After the existing argument and buyer checks, the log's `payee`
  must equal `start-payee` case-insensitively. A mismatch fails as
  `the review showed <x>, but the Funded payee was <y>`.
- Every existing check remains: the listed price and payee, the `Funded` buyer/amount/offer hash,
  the `Released` slip hash, the result transaction's escrow event, the post-purchase balance, the
  console verdict and the verifier's `VALID`.

## 3. Offline parsing tests

`e2e/human/test/review.test.ts`:

- **8-11: a valid set** parses to the payee, `1_000_000n` and the job.
- **13-22: missing values.** Omitting each id, or passing null, raises
  `the console does not expose <id>[data-value] (cs-ui)`.
- **24-39: malformed values.** Empty, truncated, over-long, non-hex, decimal and negative values
  are refused, each error naming its own id.

`e2e/human/README.md` **3-7 and 59-60** now name the review step and the parsing tests.

## Gate outputs

```
$ bun install --linker hoisted && bun run typecheck
bun install v1.3.14 (0d9b296a)

Checked 873 installs across 671 packages (no changes) [399.00ms]
$ tsc -p tsconfig.json
exit=0
```

```
$ bun test e2e/human/test
bun test v1.3.14 (0d9b296a)

e2e/human/test/report.test.ts:
leak: /var/folders/p4/8cqx396x7yl142gkb4sqv5800000gn/T/cs-human-report-HKn7Zg/artifacts/20260101-000000-abcd/privy/planted.json
leak: /var/folders/p4/8cqx396x7yl142gkb4sqv5800000gn/T/cs-human-report-QUFA4a/artifacts/20260101-000000-abcd/privy/planted.json

 33 pass
 0 fail
 95 expect() calls
Ran 33 tests across 9 files. [574.00ms]
exit=0
```

```
$ bun test e2e/test
bun test v1.3.14 (0d9b296a)

 21 pass
 0 fail
 66 expect() calls
Ran 21 tests across 1 file. [7.44s]
exit=0
```

```
$ cd e2e && npx playwright test -c human/playwright.config.ts --list
Listing tests:
  [privy] › buy.spec.ts:606:16 › the human acceptance run
  [injected] › buy.spec.ts:606:16 › the human acceptance run
Total: 2 tests in 1 file
exit=0
```

```
$ git status --short e2e/human/runs
exit=0
```

`--list` wrote no run report. `git status --short` otherwise shows only the pre-existing
`M bun.lock`.
