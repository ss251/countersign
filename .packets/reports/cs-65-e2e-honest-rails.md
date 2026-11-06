# cs-65-e2e-honest-rails: production keeps only rails that return money; the suite says so

Status: complete on `cs/cs-65`, one commit on top of `2a67039`; the report itself is the second.
No browser was launched, no flow was run, and no key was read or printed; the runner was only
called with `--list`.

## Commits

```
cfac63b e2e: retire the Gateway and plain x402 Hedera flows
```

The report itself is the second commit on the branch.

## The change

### Retired flows

Each flow keeps its body and assertions. Its `notRun` now returns the captain's reason, so deleting
that one line restores the flow.

- **`e2e/flows/arc-gateway.flow.ts:24`:** `notRun: () => "retired: the Gateway rail was removed
  from production by flag (captain, 23:40 IST): it debits before the seller runs and cannot be
  reversed"`.
- **`e2e/flows/public-gateway.flow.ts:25`:** the same Gateway reason replaces
  `no public hub configured`.
- **`e2e/flows/hedera.flow.ts:28`:** `notRun: () => "retired: plain x402 Hedera was removed from
  production by flag (captain, 23:40 IST): it debits before the seller runs and cannot be
  reversed"`.
- **`e2e/flows/public-hedera.flow.ts:23`:** the same plain x402 Hedera reason replaces
  `no public hub configured`.
- **`e2e/flows/hedera-mcp.flow.ts:42`:** the same plain x402 Hedera reason, with
  `. Its Agent Kit offer is paid held in flow 21` appended. Line 16 drops `agentTakes` from the
  `../lib/agent.ts` import because the replaced `notRun` was its only use in this flow; no flow
  code or assertion changed.

The held flows `hedera-schedule` (20), `hedera-held` (21) and `hedera-held-undelivered` (21b)
are untouched and remain on demand. `erc8004-identity` (18) is untouched.

### Budget note

`e2e/lib/budget.ts:110-111` already filters before a flow's spends are read:

```ts
for (const flow of flows) {
  if (flow.notRun?.(env)) continue;
```

So `planBudget` already skips any flow whose `notRun(env)` returns a reason. No change was needed
in `e2e/lib/budget.ts`: a retired flow never enters `spendsByFlow`, never contributes a wallet to
the balance reads, and reserves no funds. The new test pins this behavior.

### production-hub

- **`e2e/flows/production.flow.ts:20-21`:** `RETURN_MONEY_RAILS` names exactly `escrow`,
  `hedera-scheduled` and `whitechain`.
- **`e2e/flows/production.flow.ts:157-166`:** the step is renamed
  `production declares exactly the rails that return money`; `E2E_PUBLIC_RAILS` defaults to
  `"escrow,hedera-scheduled,whitechain"`; the existing check that every wanted rail is declared is
  kept at lines 162-163.
- **`e2e/flows/production.flow.ts:164-165`:** the new check fails on any declared rail outside the
  money-returning set with
  `production declares <ids> beyond the rails that return money (escrow, hedera-scheduled, whitechain)`.

### Docs

- **`docs/e2e.md:25, 28, 32-34`:** the flow-table rows for 6, 10, 15, 16 and 17 say `retired` with
  the reason; row 17 carries the flow-21 held note.
- **`docs/e2e.md:107`:** the Hedera paragraph above flow 6 says production declares exactly escrow,
  Whitechain and held Hedera (`hedera-scheduled`), and why the plain x402 rail was removed: it
  debits before the seller runs and cannot be reversed.
- **`docs/e2e.md:263`:** the 14b description says the same exact set, records the
  `E2E_PUBLIC_RAILS` default, and gives the same reason for removing Gateway and plain x402 Hedera.

## Tests

### `e2e/test/harness.test.ts:216-266`

One offline test, `a retired flow is reported NOT RUN and reserves nothing`:

- **219-250:** a synthetic flow whose `notRun` returns `"retired: ..."` also declares a spend. The
  plan reports no balances, no shortfall and no top-up request, and the wallet's `read` is never
  called: the retired flow reserves nothing.
- **252-264:** the runner is started with `--list` and `E2E_ENV_DIR` pointed at the temporary test
  directory, so it reads no real env files and touches no network. The test asserts that all five
  retired flows are reported as `NOT RUN (retired: ...)`, and that flow 17 carries
  `Its Agent Kit offer is paid held in flow 21`.

## Gate outputs

```
$ bun install --linker hoisted
bun install v1.3.14 (0d9b296a)

Checked 873 installs across 671 packages (no changes) [361.00ms]
```

```
$ bun run typecheck
$ tsc -p tsconfig.json
exit=0
```

```
$ bun test e2e/test
bun test v1.3.14 (0d9b296a)

 26 pass
 0 fail
 83 expect() calls
Ran 26 tests across 1 file. [7.94s]
exit=0
```

```
$ bun test e2e/human/test
bun test v1.3.14 (0d9b296a)

e2e/human/test/report.test.ts:
leak: /var/folders/p4/8cqx396x7yl142gkb4sqv5800000gn/T/cs-human-report-NTw6nV/artifacts/20260101-000000-abcd/privy/planted.json
leak: /var/folders/p4/8cqx396x7yl142gkb4sqv5800000gn/T/cs-human-report-gCiXjg/artifacts/20260101-000000-abcd/privy/planted.json

 35 pass
 0 fail
 106 expect() calls
Ran 35 tests across 9 files. [721.00ms]
exit=0
```

The two `leak:` lines are the expected planted-secret fixture in temporary test directories.

```
$ bun run e2e -- --list
$ bun run --cwd e2e start --list
$ bun run.ts --list
1   arc-spine                orch-cs  arc        Arc buyer 0.01 USDC, Arc hub gas wallet 0.02 USDC gas
1b  runner-restart           orch-cs  none
2   arc-wrong-amount         orch-cs  arc        Arc stranger 0.01 USDC gas
3   arc-deadline-refund      orch-cs  arc        Arc buyer 0.01 USDC, Arc hub gas wallet 0.01 USDC gas, Arc stranger 0.01 USDC gas
4a  slip-onchain-arc         orch-cs  arc        needs arc-spine
10  arc-gateway              orch-cs  arc        NOT RUN (retired: the Gateway rail was removed from production by flag (captain, 23:40 IST): it debits before the seller runs and cannot be reversed)  Arc buyer's Gateway balance 0.01 USDC
11  refusals                 orch-cs  none
13  ratings                  orch-cs  arc        Arc buyer 0.02 USDC, Arc e2e seller 0.01 USDC, Arc hub gas wallet 0.03 USDC gas
5   whitechain               cs-wc    whitechain Whitechain buyer 0.01 USDT, Whitechain relayer 0.004 WBT, Whitechain merchant 0.01 USDT
4b  slip-onchain-whitechain  cs-wc    whitechain needs whitechain
6   hedera                   cs-hd    hedera     NOT RUN (retired: plain x402 Hedera was removed from production by flag (captain, 23:40 IST): it debits before the seller runs and cannot be reversed)  Hedera agent 0.01 USDC, Hedera agent 0.01 HBAR
7   merchant                 cs-wc    whitechain Whitechain buyer 0.02 USDT, Whitechain relayer 0.004 WBT, Whitechain merchant 0.005 USDT
8   discovery                orch-cs  none
12  public-spine             orch-cs  arc        Arc buyer 0.05 USDC
15  public-hedera            cs-hd    hedera     NOT RUN (retired: plain x402 Hedera was removed from production by flag (captain, 23:40 IST): it debits before the seller runs and cannot be reversed)  Hedera agent 0.05 USDC, Hedera agent 0.01 HBAR
16  public-gateway           orch-cs  arc        NOT RUN (retired: the Gateway rail was removed from production by flag (captain, 23:40 IST): it debits before the seller runs and cannot be reversed)  Arc buyer's Gateway balance 0.05 USDC
17  hedera-mcp               cs-hd    hedera     NOT RUN (retired: plain x402 Hedera was removed from production by flag (captain, 23:40 IST): it debits before the seller runs and cannot be reversed. Its Agent Kit offer is paid held in flow 21)  Hedera agent 0.05 USDC, Hedera agent 0.01 HBAR
18  erc8004-identity         cs-hd    hedera
18b erc8004-arc              orch-cs  arc
19  mpp                      cs-hd    tempo      MPP payer 0.03 pathUSD
20  hedera-schedule          cs-hd    hedera     NOT RUN (on demand: about 0.18 HBAR a run; run it with --flow hedera-schedule)  Hedera agent 0.01 USDC, Hedera agent 0.2 HBAR
21  hedera-held              cs-hd    hedera     NOT RUN (on demand: about 0.16 HBAR a run; run it with --flow hedera-held)  Hedera agent 0.05 USDC, Hedera agent 0.17 HBAR
21b hedera-held-undelivered  cs-hd    hedera     NOT RUN (on demand: about 0.16 HBAR and 7 minutes a run; run it with --flow hedera-held-undelivered)  Hedera agent 0.05 USDC, Hedera agent 0.17 HBAR
14a production-console       cs-ui    none
14b production-hub           orch-cs  none
14c production-approvals     cs-ui    none
9   web                      cs-ui    none       NOT RUN (cut: screenshot rounds cover it)
exit=0
```
