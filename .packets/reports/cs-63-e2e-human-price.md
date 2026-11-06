# cs-63-e2e-human-price: the buyer paid exactly the listed price; --list writes no report

Status: complete on `cs/cs-60`, two commits on top of `d93b9ac`. No browser launched, no test run,
no `playwright install`, no transaction, and no call to production. Only `--list` was used.

## Commits

```
1ae9b71 e2e: write no report when no test begins
d7c1930 e2e: prove the buyer paid the listed price and payee
d93b9ac packets: report cs-60b-e2e-human-fix
```

`bun.lock` was already modified at the start of the lane and remains uncommitted; no commit contains
it.

## 1. The price paid is the price listed

`e2e/human/tests/buy.spec.ts`:

- **210-238: `ListedOffer` and `listedOfferOf`.** Reads the hub listing shape
  `{ offer: { price, seller, payTo }, ... }` (a bare offer is accepted too), requires an atomic
  digit price and an address seller, and computes the payee as the rail does:
  `offer.payTo?.escrow ?? offer.seller`. `payTo: null`, a missing `escrow` key and an absent
  `payTo` all resolve to the seller.
- **403-421: the listed offer is fetched and saved.** After `body.offerHash` and `body.amount` are
  read from the slip, `GET <hub>/offers/<body.offerHash>` must answer 200; the body is written to
  `artifacts/<run>/<project>/offer.json` and registered as an artifact. `body.amount` must equal the
  listed `price` exactly.
- **438-459: the Funded log matches the listing.** The log's `payee` is now read with its
  `amount`, and the run fails with
  `the buyer paid <amount> to <payee>, but the offer lists <price> to <listed payee>`
  when either the amount or the payee differs. The payee comparison is case-insensitive; the
  existing slip-amount and offer-hash checks remain.

## 2. `--list` writes no report

`e2e/human/lib/report.ts`:

- **83-86: `writeRunId`** accepts the artifacts directory used by the reporter, so the reporter can
  be exercised against a temporary directory.
- **411-456: `HumanReporter`.** Tracks `began`, set by `onTestBegin` (439-441) and reset by
  `onBegin` (431-437). `onEnd` returns before building the keyring or finalizing a report when no
  test began (443-444). Every report that is written still goes through `finalizeRun`, so the leak
  scan still runs.

`e2e/human/test/report.test.ts`:

- **167-181: offline test.** A reporter receives `onBegin` and `onEnd` with no `onTestBegin`; the
  runs directory is never created, so no `<run-id>.md` and no `LATEST.md` are written. The test uses
  temporary directories and an in-memory `Secrets`, so it reads no key file and touches no real
  run directory.

## Gate outputs

```
$ bun install --linker hoisted && bun run typecheck
bun install v1.3.14 (0d9b296a)

Checked 266 installs across 280 packages (no changes) [129.00ms]
$ tsc -p tsconfig.json
exit=0
```

```
$ bun test e2e/human/test
bun test v1.3.14 (0d9b296a)

e2e/human/test/report.test.ts:
leak: /var/folders/p4/8cqx396x7yl142gkb4sqv5800000gn/T/cs-human-report-Xq3phR/artifacts/20260101-000000-abcd/privy/planted.json
leak: /var/folders/p4/8cqx396x7yl142gkb4sqv5800000gn/T/cs-human-report-IRTsAW/artifacts/20260101-000000-abcd/privy/planted.json

 30 pass
 0 fail
 79 expect() calls
Ran 30 tests across 8 files. [581.00ms]
exit=0
```

```
$ bun test e2e/test
bun test v1.3.14 (0d9b296a)

 21 pass
 0 fail
 66 expect() calls
Ran 21 tests across 1 file. [7.47s]
exit=0
```

```
$ cd e2e && npx playwright test -c human/playwright.config.ts --list
Listing tests:
  [privy] › buy.spec.ts:583:16 › the human acceptance run
  [injected] › buy.spec.ts:583:16 › the human acceptance run
Total: 2 tests in 1 file
exit=0
```

```
$ git status --short e2e/human/runs
exit=0
```

No run report appeared after `--list`. `git status --short` otherwise shows only the pre-existing
`bun.lock` modification.
