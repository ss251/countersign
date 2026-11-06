# cs-72 e2e: the suite says "project lead", not "captain"

Replaced every case-insensitive `captain` with `project lead` in the nine files named by the
task. The run records under `e2e/runs/` and `e2e/human/runs/` are untouched.

Commit on `cs/cs-72`: `89efad5 use the project lead in e2e reasons and docs` (9 files, 17 insertions,
17 deletions).

## Files changed

- `e2e/flows/arc-gateway.flow.ts` — `notRun` reason
- `e2e/flows/public-gateway.flow.ts` — `notRun` reason
- `e2e/flows/hedera.flow.ts` — `notRun` reason
- `e2e/flows/public-hedera.flow.ts` — `notRun` reason
- `e2e/flows/hedera-mcp.flow.ts` — `notRun` reason
- `e2e/flows/hedera-held.flow.ts` — check message about plain x402 Hedera
- `e2e/flows/web.flow.ts` — three comments
- `e2e/test/harness.test.ts` — `RETIRED`, still equal to the flows' reason
- `docs/e2e.md` — flow table rows and the paragraphs that cite the flag

## Gate

### 1. Install and typecheck

```text
$ bun install --linker hoisted && bun run typecheck
bun install v1.3.14 (0d9b296a)

+ @countersign/relay@workspace:packages/relay

3 packages installed [1.86s]
$ tsc -p tsconfig.json
```

### 2. Tests

```text
$ bun test e2e/test
bun test v1.3.14 (0d9b296a)

 26 pass
 0 fail
 83 expect() calls
Ran 26 tests across 1 file. [8.13s]
```

```text
$ bun test e2e/human/test
bun test v1.3.14 (0d9b296a)

e2e/human/test/report.test.ts:
leak: /var/folders/p4/8cqx396x7yl142gkb4sqv5800000gn/T/cs-human-report-3OyIVn/artifacts/20260101-000000-abcd/privy/planted.json
leak: /var/folders/p4/8cqx396x7yl142gkb4sqv5800000gn/T/cs-human-report-cVOVeN/artifacts/20260101-000000-abcd/privy/planted.json

 42 pass
 0 fail
 140 expect() calls
Ran 42 tests across 9 files. [1050.00ms]
```

### 3. Retired flows

```text
$ bun run e2e -- --list | grep 'NOT RUN (retired'
10  arc-gateway              orch-cs  arc        NOT RUN (retired: the Gateway rail was removed from production by flag (project lead, 23:40 IST): it debits before the seller runs and cannot be reversed)  Arc buyer's Gateway balance 0.01 USDC
6   hedera                   cs-hd    hedera     NOT RUN (retired: plain x402 Hedera was removed from production by flag (project lead, 23:40 IST): it debits before the seller runs and cannot be reversed)  Hedera agent 0.01 USDC, Hedera agent 0.01 HBAR
15  public-hedera            cs-hd    hedera     NOT RUN (retired: plain x402 Hedera was removed from production by flag (project lead, 23:40 IST): it debits before the seller runs and cannot be reversed)  Hedera agent 0.05 USDC, Hedera agent 0.01 HBAR
16  public-gateway           orch-cs  arc        NOT RUN (retired: the Gateway rail was removed from production by flag (project lead, 23:40 IST): it debits before the seller runs and cannot be reversed)  Arc buyer's Gateway balance 0.05 USDC
17  hedera-mcp               cs-hd    hedera     NOT RUN (retired: plain x402 Hedera was removed from production by flag (project lead, 23:40 IST): it debits before the seller runs and cannot be reversed. Its Agent Kit offer is paid held in flow 21)  Hedera agent 0.05 USDC, Hedera agent 0.01 HBAR
```

### 4. No remaining mentions

```text
$ grep -rni captain e2e/flows e2e/lib e2e/test e2e/run.ts e2e/human/lib e2e/human/tests e2e/human/test docs/e2e.md
grep exit: 1
```

### 5. Diff against the base

```text
$ git diff --stat origin/cs/e2e
 docs/e2e.md                      | 14 +++++++-------
 e2e/flows/arc-gateway.flow.ts    |  2 +-
 e2e/flows/hedera-held.flow.ts    |  2 +-
 e2e/flows/hedera-mcp.flow.ts     |  2 +-
 e2e/flows/hedera.flow.ts         |  2 +-
 e2e/flows/public-gateway.flow.ts |  2 +-
 e2e/flows/public-hedera.flow.ts  |  2 +-
 e2e/flows/web.flow.ts            |  6 +++---
 e2e/test/harness.test.ts         |  2 +-
 9 files changed, 17 insertions(+), 17 deletions(-)
```
