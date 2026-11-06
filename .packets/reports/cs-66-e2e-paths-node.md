# cs-66-e2e-paths-node: paths.ts loads under Node, so the human run starts

Status: complete on `cs/cs-66`, one commit on top of `7b1f6fe`. No browser was launched, no flow
was run, and no key was read or printed; Playwright and the runner were only called with `--list`.

## The change

### `e2e/lib/paths.ts`

- **4:** adds `import { fileURLToPath } from "node:url";`.
- **7:** `ROOT` now comes from
  `resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")` instead of
  `resolve(import.meta.dir, "..", "..")`. `dirname` was already imported.

Nothing else in the file changes. `import.meta.url` exists in both Bun and Node, so the suite under
Bun resolves the same repository root as before.

## Search

`e2e/lib` and `e2e/human` contain no other `import.meta.dir` or `import.meta.path`.
`e2e/human/lib/report.ts:20-21` already uses `import.meta.url` with `fileURLToPath`, so it needed no
change.

The only `Bun.` use reached by `e2e/human` is:

- **`e2e/lib/http.ts:85`:** `Bun.serve` inside `freePort()`. The path is
  `human/playwright.config.ts` / `human/tests/buy.spec.ts` -> `human/lib/report.ts`,
  `human/lib/fund.ts`, `human/lib/wallet.ts` -> `e2e/lib/chains.ts` -> `e2e/lib/http.ts`. The
  reference is inside the function body and is not evaluated when the module loads, so it does not
  break Node's load. Left unchanged as instructed.

Other `Bun.` uses in the searched directories are not in the human import graph:

- **`e2e/lib/procs.ts:48`:** `Bun.spawn`. No `e2e/human` module imports `procs.ts`.
- **`e2e/human/test/*.test.ts`:** `import { ... } from "bun:test"`. These are the Bun test files;
  Playwright's `testDir` is `./tests`, so its config load does not import them.

For completeness, outside the requested directories: `e2e/run.ts:81` and
`e2e/test/harness.test.ts:252-253` use `Bun.spawnSync`, and `e2e/flows/mpp.flow.ts:80,112` uses
`Bun.which` and `Bun.spawn`. None is imported by `e2e/human`.

## Gate outputs

```
$ bun install --linker hoisted && bun run typecheck
bun install v1.3.14 (0d9b296a)

Checked 873 installs across 671 packages (no changes) [2.95s]
$ tsc -p tsconfig.json
exit=0
```

```
$ bun test e2e/test
bun test v1.3.14 (0d9b296a)

 26 pass
 0 fail
 83 expect() calls
Ran 26 tests across 1 file. [8.15s]
exit=0
```

```
$ bun test e2e/human/test
bun test v1.3.14 (0d9b296a)

 35 pass
 0 fail
 106 expect() calls
Ran 35 tests across 9 files. [688.00ms]
exit=0
```

The human suite prints two expected `leak:` lines from the planted-secret fixture; those paths are
temporary test directories and are omitted here.

```
$ cd e2e && npx playwright test -c human/playwright.config.ts --list
Listing tests:
  [privy] › buy.spec.ts:606:16 › the human acceptance run
  [injected] › buy.spec.ts:606:16 › the human acceptance run
Total: 2 tests in 1 file
exit=0
```

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
