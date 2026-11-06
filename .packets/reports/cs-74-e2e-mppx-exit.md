# cs-74-e2e-mppx-exit: mpp finds its pinned binary under either install, and a dead process says how it died

Status: complete on `cs/cs-74`. No browser was launched, no flow was run (`--list` only), no key was
read or printed, and `git stash` was not used. Nothing was pushed, merged or deployed.

## The changes

### `e2e/lib/paths.ts`

- **1, 3:** imports `existsSync` and `join`.
- **42-51:** new exported `mppxBin(root = ROOT): string`. It returns the first existing candidate:
  `packages/rail/node_modules/.bin/mppx` (the isolated layout, the rail's pinned version) and then
  `node_modules/.bin/mppx` (the hoisted layout). When neither exists it throws
  `the pinned mppx binary is not installed under ${redactPaths(root)}: run bun install`. No check
  runs at import time.

### `e2e/flows/mpp.flow.ts`

- **23:** imports `mppxBin`.
- **`const MPPX = join(ROOT, "packages/rail/node_modules/.bin/mppx")` removed** from the module
  top level, so importing the flow (and `--list`) no longer touches the filesystem for the binary.
- **95:** the `mppx` run command is `[mppxBin(), ...args, ...]`.
- **111:** the `Bun.spawn` for `sign` starts with `mppxBin()`.

Nothing else in the flow changed; `ROOT` is still used as the child's cwd.

### `e2e/lib/procs.ts`

- **92-96:** `exitCode` and `exitSignal` are stored as soon as `child.exited` settles: the code from
  `child.exited` and `child.signalCode` (null when no signal killed it). The pumps still drain
  before `done` is set.
- **122-129:** the exited-first rejection keeps the exact `exited before printing` text and now
  appends `(exit code ${exitCode}, signal ${exitSignal ?? "none"})` before `last output`. The
  timeout message is unchanged.

### `e2e/test/harness.test.ts`

- **3, 8, 14:** imports `mkdirSync`, `writeFileSync` and `dirname`, plus `mppxBin`.
- **113-117:** a child that exits 3 before printing rejects with `(exit code 3, signal none)`.
- **119-123:** a child that runs `kill -9 $$` before printing rejects with `signal SIGKILL`.
- **126-150:** `mppxBin(tmp)` finds the hoisted binary when it is the only one; prefers the
  `packages/rail` binary when both exist; and throws the install message when neither exists. The
  fake binaries are empty files in a fresh temp directory.

## Gate outputs

```
$ bun install --linker hoisted && bun run typecheck
bun install v1.3.14 (0d9b296a)

+ @countersign/relay@workspace:packages/relay

3 packages installed [409.00ms]
$ tsc -p tsconfig.json
exit=0
```

```
$ bun test e2e/test
bun test v1.3.14 (0d9b296a)

 31 pass
 0 fail
 88 expect() calls
Ran 31 tests across 1 file. [8.53s]
exit=0
```

```
$ bun test e2e/human/test
bun test v1.3.14 (0d9b296a)

leak: /var/folders/p4/8cqx396x7yl142gkb4sqv5800000gn/T/cs-human-report-UpLen8/artifacts/20260101-000000-abcd/privy/planted.json
leak: /var/folders/p4/8cqx396x7yl142gkb4sqv5800000gn/T/cs-human-report-8cu1sc/test-results/buy-retry/error-context.md
leak: /var/folders/p4/8cqx396x7yl142gkb4sqv5800000gn/T/cs-human-report-yAsJcK/artifacts/20260101-000000-abcd/privy/planted.json

 52 pass
 0 fail
 164 expect() calls
Ran 52 tests across 9 files. [2.72s]
exit=0
```

The three `leak:` lines are the expected planted-secret fixtures, all under temporary test
directories.

```
$ bun run e2e -- --list
$ bun run --cwd e2e start --list
$ bun run.ts --list
1   arc-spine                orch-cs  arc        Arc buyer 0.01 USDC, Arc hub gas wallet 0.02 USDC gas
1b  runner-restart           orch-cs  none
2   arc-wrong-amount         orch-cs  arc        Arc stranger 0.01 USDC gas
3   arc-deadline-refund      orch-cs  arc        Arc buyer 0.01 USDC, Arc hub gas wallet 0.01 USDC gas, Arc stranger 0.01 USDC gas
4a  slip-onchain-arc         orch-cs  arc        needs arc-spine
10  arc-gateway              orch-cs  arc        NOT RUN (retired: the Gateway rail was removed from production by flag (project lead, 23:40 IST): it debits before the seller runs and cannot be reversed)  Arc buyer's Gateway balance 0.01 USDC
11  refusals                 orch-cs  none
13  ratings                  orch-cs  arc        Arc buyer 0.02 USDC, Arc e2e seller 0.01 USDC, Arc hub gas wallet 0.03 USDC gas
5   whitechain               cs-wc    whitechain Whitechain buyer 0.01 USDT, Whitechain relayer 0.004 WBT, Whitechain merchant 0.01 USDT
4b  slip-onchain-whitechain  cs-wc    whitechain needs whitechain
6   hedera                   cs-hd    hedera     NOT RUN (retired: plain x402 Hedera was removed from production by flag (project lead, 23:40 IST): it debits before the seller runs and cannot be reversed)  Hedera agent 0.01 USDC, Hedera agent 0.01 HBAR
7   merchant                 cs-wc    whitechain Whitechain buyer 0.02 USDT, Whitechain relayer 0.004 WBT, Whitechain merchant 0.005 USDT
8   discovery                orch-cs  none
12  public-spine             orch-cs  arc        Arc buyer 0.05 USDC
15  public-hedera            cs-hd    hedera     NOT RUN (retired: plain x402 Hedera was removed from production by flag (project lead, 23:40 IST): it debits before the seller runs and cannot be reversed)  Hedera agent 0.05 USDC, Hedera agent 0.01 HBAR
16  public-gateway           orch-cs  arc        NOT RUN (retired: the Gateway rail was removed from production by flag (project lead, 23:40 IST): it debits before the seller runs and cannot be reversed)  Arc buyer's Gateway balance 0.05 USDC
17  hedera-mcp               cs-hd    hedera     NOT RUN (retired: plain x402 Hedera was removed from production by flag (project lead, 23:40 IST): it debits before the seller runs and cannot be reversed. Its Agent Kit offer is paid held in flow 21)  Hedera agent 0.05 USDC, Hedera agent 0.01 HBAR
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

This checkout is installed hoisted (`node_modules/.bin/mppx` exists, the `packages/rail` copy does
not), which is the layout that failed in run 20261106-192434-ef79. `--list` still works because
importing the mpp flow now resolves nothing, and a real mpp run would take the hoisted fallback.
