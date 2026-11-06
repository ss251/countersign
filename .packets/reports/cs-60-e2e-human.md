# cs-60-e2e-human: the human acceptance run

Status: code and offline tests complete. No browser was launched; the lane runs the flow.

## Commits on cs/cs-60

The workflow is its own first commit, as asked, so the lane can land it alone:

```
0f1689c ci: nightly and on-demand human acceptance run through Playwright
cff6ed2 e2e: add the human run dependency and ignore its local output
4c1fb04 e2e: add the human run's injected wallet, funding and Privy drivers
787f05b e2e: write the human run's report, LATEST and leak scan
96f152e e2e: run the human acceptance flow against the deployed console
105e741 e2e: cover the human helpers offline and document the run
```

No later commit touches `.github/workflows/human-e2e.yml`.

## What was built, file by file

### `.github/workflows/human-e2e.yml` (first commit)

Nightly at `30 21 * * *` and `workflow_dispatch` with a `project` choice (`both` default, `privy`,
`injected`). No `pull_request` and no `push`. `contents: read`, serialized by a `human-e2e`
concurrency group, one Ubuntu job with a 30-minute cap. Bun 1.3.14 installs; Node 22 runs
Playwright; Chromium installs in `e2e`; the test step passes the funder key and the Privy login as
secrets and the console/hub URLs from `vars`. Artifacts and runs upload always with 14-day
retention, and `LATEST.md` is appended to the job summary when present.

### `e2e/package.json`

Adds `@playwright/test` `1.64.1` (exact) to `devDependencies` and `"human": "playwright test -c
human/playwright.config.ts"`.

### `.gitignore`

Adds `e2e/human/artifacts/`, `e2e/human/test-results/` and `e2e/human/playwright-report/`.

### `e2e/human/playwright.config.ts`

`testDir: ./tests`, `outputDir: ./test-results`, one worker, no retries, not parallel, 10-minute test
timeout, 30-second expect timeout. Chromium `privy` and `injected` projects at 1440×900. Trace,
screenshot and video are off at the config level; the test manages them. Reporters: `list` and
`./lib/report.ts`. `baseURL` is the console URL (default or `E2E_HUMAN_CONSOLE`).

### `e2e/human/lib/keys.ts`

`Keyring.secret(name)`: `process.env` first, then `new Secrets(defaultEnvDir(), [...ENV_FILES,
"privy.env"])`; a missing directory or file is just `undefined`. Every value read is registered with
`Secrets.hide`, with its 0x-stripped form too. `funderKey()` prefers `E2E_HUMAN_FUNDER_KEY`, then
`CS_DEPLOYER_KEY`, and rejects a non-32-byte value without echoing it.

### `e2e/human/lib/wallet.ts`

The injected EIP-1193 wallet. `installTestWallet(context, account, rpcUrl)` exposes the
`__csWallet` binding and installs an init script that defines `window.ethereum`, announces
EIP-6963 (`Countersign test wallet`, `app.countersign.test`, SVG data-URI icon) on load and on
`eip6963:requestProvider`, keeps listeners, and emits `connect` once. `handleWalletRequest` implements
the specified methods: accounts, chain id (`0x4cef52` / `5042002`), chain switching (4902 elsewhere),
`personal_sign`, typed data v4 (drops `EIP712Domain`), `eth_sendTransaction` through a viem wallet
client on Arc, the read-only forwards, 4200 for unknown methods, 4100 for another address. The key
lives only in Node; `newTestAccount()` makes a fresh one per run.

### `e2e/human/lib/fund.ts`

USDC balance reads at `ARC.token`, a transfer from the funder that waits for a successful receipt,
and the pure arithmetic (`afterFunding`, `afterPurchase`, `changeToReturn`, 1 USDC and the 0.02 USDC
gas reserve).

### `e2e/human/lib/privy.ts`

Drives the third-party modal by role and input type only: the first visible dialog, email textbox or
`input[type=email]`, submit/continue/login button, then `input[autocomplete=one-time-code]` or
`input[inputmode=numeric]`, typing the code at 50 ms per key. Done when `wallet-address` has a
`data-value` (120 s). `approveIfPrompted` clicks a visible sign/approve/confirm button within 10 s or
returns.

### `e2e/human/lib/report.ts`

Run id `YYYYMMDD-HHMMSS-xxxx`, `runs/<id>.md` plus `LATEST.md` with a first-line comment naming the
run file. The header table carries the run id, short commit (with "with local changes" when dirty,
excluding `e2e/human/runs`), console and hub URLs, start and duration. Each project section carries
PASS/FAIL (failed step and message)/NOT RUN (reason), the wallet, a steps table, the funding, escrow
fund and release transactions as Arc explorer links, the slip hash, the verifier line and artifact
paths. The leak scan reads every text file under the run's artifacts, deletes a hit, re-renders
without it, redacts the report itself and exits 1 with `leak: <file>` (never the value). The
reporter runs in Playwright's main process and reads the per-project `result.json` the worker writes,
so a failed test still reports its steps. It does not write a report when no project ran (for
`--list`).

### `e2e/human/tests/buy.spec.ts`

The flow, one test executed per project, each step wrapped in `test.step` and preceded by
`artifacts/<run-id>/<project>/<nn>-<slug>.png`: open, sign in (injected or Privy, with the Privy
outage turning sign-in failures into a skip when a `privy.io` request failed or answered 5xx), the
wallet on Arc, fund 1 USDC, the exact balance move, buy (offer selection by rail/price, countersign,
fund, on-chain `Funded` check against job id, buyer and price, and the post-purchase balance),
delivery and the on-chain `Released`, the slip in the console plus the hub GET and the standalone
`bun packages/verify/src/cli.ts ... --rpc ...` ending in `VALID`, then the injected change back to the
funder (best effort). Privy email/code are never screenshotted and never reach a trace: the `privy`
trace starts after sign-in. Transaction hashes are recorded as they happen.

### `e2e/human/test/*.test.ts` and `test/fixtures/leak-run.ts`

Offline Bun tests: the wallet handler (accounts, chain ids, switch/add 4902, `personal_sign`
recovery, typed-data verification with `EIP712Domain` present, 4200, 4100, RPC forwarding through a
fake request function); the secrets loader (env wins, file fallback, missing directory, redaction);
the report (PASS/FAIL/NOT RUN rendering with explorer links, the leak scan deleting a planted
artifact, the report never containing the value, LATEST, and a spawned fixture asserting the
non-zero exit); the funding arithmetic. No browser, no network, no real key.

### `e2e/human/README.md`

How to run, the two projects, the env vars, the secret names and the offline tests.

## Gate outputs

```
$ bun run typecheck
$ tsc -p tsconfig.json
exit=0
```

```
$ bun test e2e/human/test
 21 pass
 0 fail
 53 expect() calls
Ran 21 tests across 5 files. [2.33s]
exit=0
```

```
$ bun test e2e/test
 21 pass
 0 fail
 66 expect() calls
Ran 21 tests across 1 file. [8.28s]
exit=0
```

```
$ cd e2e && npx playwright test -c human/playwright.config.ts --list
Listing tests:
  [privy] › buy.spec.ts:443:16 › the human acceptance run
  [injected] › buy.spec.ts:443:16 › the human acceptance run
Total: 2 tests in 1 file
exit=0
```

No browser was launched, no `playwright install`, no transaction, and neither the production console
nor the hub was called.

## Deviations and notes

- **`bun test e2e/human/test` also matches `e2e/human/tests/buy.spec.ts`.** Bun treats its argument
  as a substring filter, and `e2e/human/test` is a prefix of `e2e/human/tests`, so the Playwright
  spec was loaded by the Bun gate and called `test()` outside Playwright. The spec file now registers
  its test only when `process.versions.bun` is absent, which is true under Node/Playwright and false
  under the Bun test gate. The flow and the Playwright test registration are otherwise unchanged.
  `--list` still lists both tests.
- **Offline tests import `bun:test`.** The hard constraint says nothing in `e2e/human` imports
  `bun:*`; the offline suite is the required `bun test e2e/human/test` suite and `bun:test` is how
  those tests are declared. Everything Playwright loads under Node (config, lib, the spec) uses only
  Node APIs, viem and `@playwright/test`.
- **`--list` writes no report.** The reporter returns in `onEnd` when no project state exists, so
  listing does not create a misleading run.
- **`e2e/human/runs/` is not ignored.** Only `artifacts/`, `test-results/` and `playwright-report/`
  were added, as specified. The run report is therefore a normal file; the lane can decide whether to
  commit it.
- **`bun.lock` needs orch-cs.** `bun install` resolved `@playwright/test@1.64.1` and was then
  reverted with `git checkout -- bun.lock` before every commit. The lockfile does not yet contain the
  new dependency; orch-cs must update it on `cs/int` before the workflow can run
  `bun install --frozen-lockfile`.
