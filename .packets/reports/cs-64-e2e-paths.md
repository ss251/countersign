# cs-64-e2e-paths: run records never carry a local path

Status: complete on `cs/cs-64`, two commits on top of `48af6f9`. No browser was launched, no flow
was run, and no key was read or printed; the runner was only called with `--list`.

## Commits

```
38a152b e2e: rewrite local paths in every run record
```

The report itself is the second commit on the branch.

`bun.lock` was already modified when the lane started and remains uncommitted; no commit contains
it.

## The change

### `e2e/lib/paths.ts`

- **1-8:** imports `realpathSync`, `homedir`, `basename` and `dirname`; adds
  `REAL_ROOT = realpathSync(ROOT)`, the form the root takes in a captured stack trace. `ROOT` itself
  is unchanged.
- **20-39:** `redactPaths(text, root = REAL_ROOT, home = homedir())`, in the specified order:
  1. every `<root>/` becomes `$R/`;
  2. when the directory holding the root has a name ending in `-wt`, every
     `<worktree-parent>/<name>/` becomes `$R/`;
  3. every home directory followed by `/` or the end of the text becomes `~`.

  The root and worktree replacements use literal `split`/`join` and an escaped regex, so ordinary
  text is untouched. The optional `root` and `home` arguments exist only so offline tests can drive
  a worktree layout on any machine.

### `e2e/lib/secrets.ts`

- **13:** imports `redactPaths` from `paths.ts`.
- **119-139:** `redactSecrets` keeps the existing secret loop, including its case handling and the
  `0x` variants. `redact` now returns `redactPaths(this.redactSecrets(text))`, so secret values are
  replaced first and paths second. `leaks` still compares against `redactSecrets` only, preserving
  its documented meaning: key material, not machine paths, is what the leak scan deletes.

### `e2e/human/lib/report.ts`

- **16:** imports `redactPaths`.
- **106-110:** `writeProjectState` writes its `result.json` through `redactPaths`, so per-project
  state files carry no local path.
- **355-360:** the human run report and `LATEST.md` are written from
  `redactPaths(options.secrets.redact(renderReport(...)))`. Secrets still come first; the explicit
  path pass also covers a caller that supplies its own redactor.

Every log line and report already goes through `Secrets.redact`, so the e2e runner, child-process
logs, saved artifacts, `run.json` and the committed run record all inherit the same two rewrites.

## Tests

### `e2e/test/harness.test.ts` (14, 55-78)

- **55-59:** a stack-trace-shaped string containing `REAL_ROOT/e2e/lib/hedera.ts:85:26` comes out
  as `$R/e2e/lib/hedera.ts:85:26`.
- **61-64:** `<homedir>/.config/countersign/e2e.env` comes out as
  `~/.config/countersign/e2e.env`.
- **66-70:** a sibling worktree path `<parent-wt>/cs-60/e2e/x.ts` comes out as `$R/e2e/x.ts`.
  This drives `redactPaths` with a synthetic `countersign-wt/cs-64` root, the same function
  `Secrets.redact` calls, so the test is deterministic in a normal checkout too.
- **72-78:** text with no path is unchanged; a secret value that itself contains the repository
  root is replaced by `[redacted]`, proving secret redaction runs before the path rewrites.

### `e2e/human/test/report.test.ts` (3, 6, 14-15, 119-152)

- **119-141:** `finalizeReport` renders and writes both `<run-id>.md` and `LATEST.md` with `$R` and
  `~` in place of the repository root and home directory.
- **143-152:** `writeProjectState` writes a state file with the repository root rewritten.

## Gate outputs

```
$ bun install --linker hoisted && bun run typecheck
bun install v1.3.14 (0d9b296a)

Checked 873 installs across 671 packages (no changes) [490.00ms]
$ tsc -p tsconfig.json
exit=0
```

```
$ bun test e2e/test
bun test v1.3.14 (0d9b296a)

 25 pass
 0 fail
 72 expect() calls
Ran 25 tests across 1 file. [7.53s]
exit=0
```

```
$ bun test e2e/human/test
bun test v1.3.14 (0d9b296a)

 32 pass
 0 fail
 90 expect() calls
Ran 32 tests across 8 files. [750.00ms]
exit=0
```

The human suite prints two expected `leak:` lines from the planted-secret fixture; those paths are
temporary test directories and are omitted here.

```
$ bun run e2e -- --list
$ bun run --cwd e2e start --list
$ bun run.ts --list
1   arc-spine                orch-cs  arc        Arc buyer 0.01 USDC, Arc hub gas wallet 0.02 USDC gas
1b  runner-restart           orch-cs  none
2   arc-wrong-amount         orch-cs  arc        Arc stranger 0.01 USDC gas
3   arc-deadline-refund      orch-cs  arc        Arc buyer 0.01 USDC, Arc hub gas wallet 0.01 USDC gas, Arc stranger 0.01 USDC gas
4a  slip-onchain-arc         orch-cs  arc        needs arc-spine
10  arc-gateway              orch-cs  arc        Arc buyer's Gateway balance 0.01 USDC
11  refusals                 orch-cs  none
13  ratings                  orch-cs  arc        Arc buyer 0.02 USDC, Arc e2e seller 0.01 USDC, Arc hub gas wallet 0.03 USDC gas
5   whitechain               cs-wc    whitechain Whitechain buyer 0.01 USDT, Whitechain relayer 0.004 WBT, Whitechain merchant 0.01 USDT
4b  slip-onchain-whitechain  cs-wc    whitechain needs whitechain
6   hedera                   cs-hd    hedera     Hedera agent 0.01 USDC, Hedera agent 0.01 HBAR
7   merchant                 cs-wc    whitechain Whitechain buyer 0.02 USDT, Whitechain relayer 0.004 WBT, Whitechain merchant 0.005 USDT
8   discovery                orch-cs  none
12  public-spine             orch-cs  arc        Arc buyer 0.05 USDC
15  public-hedera            cs-hd    hedera     Hedera agent 0.05 USDC, Hedera agent 0.01 HBAR
16  public-gateway           orch-cs  arc        Arc buyer's Gateway balance 0.05 USDC
17  hedera-mcp               cs-hd    hedera     Hedera agent 0.05 USDC, Hedera agent 0.01 HBAR
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
