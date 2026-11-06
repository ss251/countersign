# cs-60-e2e-human: the human acceptance run, Playwright against the deployed console

Lane: cs-e2e. Base: `cs/e2e`. Branch: `cs/cs-60`. Steers: STEER-2108, STEER-2115 (captain).

## Goal

A Playwright project in `e2e/human/` that does what a person does on the deployed console and hub, and
proves each money step on chain:

1. sign in (Privy with the test account, or an injected wallet),
2. assert the wallet exists and is on Arc testnet,
3. fund it with 1 USDC on Arc from a funder key,
4. assert the balance moved by exactly 1 USDC,
5. buy a live Arc escrow offer: countersign, then fund the escrow, a real `fund` transaction,
6. the seller delivers, a real `release` transaction,
7. the slip verifies, in the console and with the standalone verifier.

It writes its own report, `e2e/human/runs/<run-id>.md` and `e2e/human/runs/LATEST.md`, never
`e2e/runs/`. A CI workflow runs it nightly and on demand, never on pull requests.

You write code and offline tests only. The browser runs are done later by the lane, never by you.

## Decided design (do not change a mechanism; if something cannot work as written, stop and report)

### Layout and tooling

- Add `"@playwright/test": "1.64.1"` (exact) to `devDependencies` of `e2e/package.json`, and a script
  `"human": "playwright test -c human/playwright.config.ts"`. Run `bun install` in your worktree so it
  resolves, but **never commit `bun.lock`**: restore it with `git checkout -- bun.lock` before each commit.
  orch-cs updates the lockfile on cs/int; say so in your report.
- The tests run under **Node** through Playwright's own runner (`npx playwright test`), not under Bun. So
  `e2e/human/**` uses only Node APIs (`node:fs`, `node:path`, `node:child_process`, `node:crypto`), viem,
  and `@playwright/test`. It may import `../lib/chains.ts` (ARC, `escrowEvents`, `explorerTx`) and
  `../lib/secrets.ts` (`Secrets`, `parseEnv`), which use no Bun APIs. Nothing in `e2e/human` imports
  `bun:*` or uses `Bun.*`.
- Files:
  - `e2e/human/playwright.config.ts`
  - `e2e/human/lib/keys.ts`: secrets loader
  - `e2e/human/lib/wallet.ts`: the injected test wallet (EIP-1193 bridge)
  - `e2e/human/lib/fund.ts`: funding and balances on Arc
  - `e2e/human/lib/privy.ts`: Privy sign-in driver
  - `e2e/human/lib/report.ts`: run id, report, LATEST.md, leak scan
  - `e2e/human/tests/buy.spec.ts`: the flow
  - `e2e/human/test/*.test.ts`: offline unit tests run with `bun test e2e/human/test`
  - `e2e/human/README.md`: how to run, env vars, what each project does (short)
  - `.gitignore` additions: `e2e/human/artifacts/`, `e2e/human/test-results/`, `e2e/human/playwright-report/`
  - Separate **first** commit: `.github/workflows/human-e2e.yml` (see below); the lane lands it alone at once

### Configuration (env, all optional with these defaults)

| var | default | use |
|---|---|---|
| `E2E_HUMAN_CONSOLE` | `https://web-production-a58de.up.railway.app` | console base URL; hash routes (`/#/slip/<hash>`) |
| `E2E_HUMAN_HUB` | `https://hub-production-e85e.up.railway.app` | hub base URL |
| `E2E_HUMAN_MAX_PRICE` | `50000` | most a run pays for the offer (atomic USDC, 6 decimals) |
| `E2E_ARC_RPC` | as `ARC.rpc` in `e2e/lib/chains.ts` | Arc RPC |

Secrets, through `keys.ts` only: `secret(name)` returns `process.env[name]` if set, else the value from
`new Secrets()` (the files under `~/.config/countersign/`; add `"privy.env"` to the file list it reads
by passing an explicit list: `[...ENV_FILES, "privy.env"]`), else `undefined`. A missing directory or
file is not an error. Names: `E2E_HUMAN_FUNDER_KEY`, `CS_DEPLOYER_KEY`, `PRIVY_TEST_EMAIL`,
`PRIVY_TEST_OTP`. Every value read is registered with a redactor (`Secrets.hide` or your own list) so
the leak scan knows it. **No secret is ever printed, logged, put in argv, a screenshot name, a report, or
a trace.**

Funder: `E2E_HUMAN_FUNDER_KEY` if present (CI), else `CS_DEPLOYER_KEY` (devcube, tonight's on-demand
runs). If neither, the funding step fails with "no funder key".

### Playwright config

- `testDir: "./tests"`, `outputDir: "./test-results"`, `workers: 1`, `retries: 0`, `fullyParallel: false`,
  `timeout: 10 * 60_000`, `expect.timeout: 30_000`.
- `use`: `baseURL` = console, `trace: "off"`, `screenshot: "off"`, `video: "off"`,
  `viewport: { width: 1440, height: 900 }`. Tracing and screenshots are managed by the test (below).
- Two projects, both Chromium (`devices["Desktop Chrome"]`): `privy` and `injected`.
- Reporter: `[["list"], ["./lib/report.ts"]]`. The custom reporter writes the run report (below) in
  `onEnd`.

### The flow (`tests/buy.spec.ts`), one test per project, each step a `test.step`

Every step: on entry take a screenshot `artifacts/<run-id>/<project>/<nn>-<slug>.png` (nn two digits),
and record the step's name, status, duration and any tx hash for the report. Drive the console only by
`data-testid` (the list is below). Read states from `data-state` and full values from `data-value`.

0. **Open.** `page.goto("/")` and wait for `wallet-connect` to be visible.
1. **Sign in.**
   - `injected`: before `goto`, install the test wallet (`wallet.ts`) on the context. Click
     `wallet-connect`, then `wallet-option-injected`.
   - `privy`: if `PRIVY_TEST_EMAIL` or `PRIVY_TEST_OTP` is missing, `test.skip(true, "no Privy test login")`.
     Click `wallet-connect`. If `wallet-option-privy` does not appear within 30 s, fail with the text of
     `wallet-fallback-reason` if present ("Privy not offered: <reason>"). Click it, then drive the modal
     with `privy.ts` (below).
   - Tracing: for `injected`, `context.tracing.start({ screenshots: true, snapshots: true })` before
     step 0. For `privy`, start tracing only **after** sign-in has completed, so the email and code
     are never in the trace. Stop tracing at the end into `artifacts/<run-id>/<project>/trace.zip`.
2. **The wallet exists on Arc.** `wallet-address` has a `data-value` matching `^0x[0-9a-fA-F]{40}$`;
   `wallet-chain` has `data-value` `5042002` (if not, click `wallet-switch-chain` once and re-check);
   `wallet-kind` `data-state` is `privy-embedded` for `privy` and `injected` for `injected`. For the
   injected project the address must equal the test wallet's.
3. **Fund 1 USDC.** `fund.ts`: read the wallet's ERC-20 USDC balance at `ARC.token` (6 decimals), send
   `1_000_000` from the funder with a viem wallet client on Arc, wait for the receipt (status success),
   record the tx as "funding".
4. **Balance.** Read again: it must equal the earlier balance plus `1_000_000` exactly. Then
   `wallet-usdc`'s `data-value` must show at least that value within 60 s (poll; the console refreshes).
5. **Buy.**
   - Go to the buyer path: if `start-role-buy` exists on `/#/start`, use it; else go to `/` and use
     `offer-list`. Pick the first `offer-item` whose `data-rail` is `escrow` and `data-price` is at most
     `E2E_HUMAN_MAX_PRICE`; none found fails "no live Arc escrow offer". Click its `offer-open`. Assert
     `offer-hash` `data-value` equals the item's `data-offer-hash`.
   - Click `buy-start`; its `data-state` must be `ready` first (else fail with the state).
   - Click `buy-countersign`; if a Privy dialog asks for a signature, `privy.ts` approves it. Wait for
     `buy-countersigned` `data-state` `signed`; its `data-value` is the job id (`^0x[0-9a-f]{64}$`, case
     insensitive).
   - Click `buy-fund`; approve a Privy prompt the same way. Wait (up to 120 s) for `buy-funded`
     `data-state` `funded`; `data-value` is the fund tx hash. Then on chain: the receipt succeeded, and
     `escrowEvents(ARC, receipt)` has a `Funded` with that job id, `buyer` equal to the wallet (case
     insensitive), and `amount` equal to the offer's price. The wallet's USDC balance is now the step-4
     balance minus the price. Record the tx as "escrow fund".
   - `buy-refusal` appearing at any point fails the step with its text.
6. **Delivery.** Wait (up to 180 s) for `buy-delivery` `data-state` `delivered` and a non-empty
   `buy-output`. `buy-released` `data-value` is the release tx: its receipt has a `Released` for the job
   id. Record "release".
7. **The slip verifies.** Take the slip hash from `buy-slip-link`'s `data-value` and click it. On the slip
   page, `slip-hash` `data-value` equals it; click `slip-verify`; `slip-verdict` `data-state` becomes
   `valid` within 60 s. Then independently: `GET <hub>/slips/<hash>` must answer 200; save the body to
   `artifacts/<run-id>/<project>/slip.json`; run
   `bun packages/verify/src/cli.ts <that file> --rpc <ARC rpc>` from the repo root with
   `child_process.spawnSync` (no shell), timeout 90 s. Its last non-empty stdout line must be exactly
   `VALID`; record it in the report as "verifier: VALID".
8. **Return the change (injected only, best effort, never fails the run).** Send the injected wallet's
   remaining USDC minus `20_000` back to the funder.

### Privy outage

A Privy outage must never turn a green build red. In the `privy` project, listen to `page.on("response")`
and `page.on("requestfailed")` for hosts ending in `privy.io`. If sign-in fails **and** any such request
failed or answered 5xx, call `test.skip(true, "Privy unavailable: <host> <status or error>")` instead of
failing. Any other sign-in failure fails.

### `privy.ts` (the modal is third-party DOM: drive it by role and input type, never by class)

- `signIn(page, email, otp)`: the dialog is `page.getByRole("dialog")` (first visible). Fill the first
  of: `getByRole("textbox", { name: /email/i })`, `locator('input[type="email"]')`. Click the first
  visible of `getByRole("button", { name: /submit|continue|log ?in|sign ?in/i })`. Then the code: focus
  the first of `locator('input[autocomplete="one-time-code"]')`, `locator('input[inputmode="numeric"]')`
  and type the code with `page.keyboard.type(otp, { delay: 50 })`. Done when `wallet-address` has a
  `data-value` (120 s).
- `approveIfPrompted(page)`: within 10 s, if a dialog shows a button named
  `/^(sign|approve|confirm)/i`, click it; otherwise return.
- Never take a screenshot while the email or the code is typed; take one before typing (the empty
  modal) and one after sign-in.

### `wallet.ts` (the injected test wallet; the key never enters the browser)

- `installTestWallet(context, account, rpcUrl)`: `context.exposeBinding("__csWallet", handler)` and
  `context.addInitScript(script)`.
- The init script defines `window.ethereum = provider` and announces it per EIP-6963
  (`eip6963:announceProvider` with `info = { uuid, name: "Countersign test wallet", icon: <an svg data URI>,
  rdns: "app.countersign.test" }`, re-announced on `eip6963:requestProvider`). `provider.request({method,
  params})` calls `window.__csWallet({ method, params })`; a result of the form `{ __error: { code,
  message } }` is thrown as `Object.assign(new Error(message), { code })`. `on` and `removeListener`
  keep listeners; the provider emits `connect` with `{ chainId: "0x4cef52" }` once.
- The Node handler (`handleWalletRequest(account, rpc, req)`, exported for the unit tests):
  - `eth_requestAccounts`, `eth_accounts`: `[account.address]`
  - `eth_chainId`: `"0x4cef52"` (5042002); `net_version`: `"5042002"`
  - `wallet_switchEthereumChain`, `wallet_addEthereumChain`: `null` when the chain id is `0x4cef52`
    (case insensitive), else `{ __error: { code: 4902, message: "only Arc testnet" } }`
  - `personal_sign` `[data, address]`: `account.signMessage({ message: { raw: data } })`
  - `eth_signTypedData_v4` `[address, json]`: parse; drop `EIP712Domain` from `types`;
    `account.signTypedData({ domain, types, primaryType, message })`
  - `eth_sendTransaction` `[tx]`: a viem wallet client on Arc sends it (`to`, `data`, `value`, `gas`
    when given) and returns the hash
  - `eth_call`, `eth_estimateGas`, `eth_getBalance`, `eth_blockNumber`, `eth_getTransactionReceipt`,
    `eth_getTransactionByHash`, `eth_getBlockByNumber`, `eth_gasPrice`, `eth_maxPriorityFeePerGas`,
    `eth_feeHistory`, `eth_getCode`, `eth_getTransactionCount`: forwarded to the Arc RPC
    (`publicClient.request`)
  - anything else: `{ __error: { code: 4200, message: "unsupported: <method>" } }`
  - a request naming an address other than the account: `{ __error: { code: 4100, message: "unauthorized" } }`
- The injected project's account is `privateKeyToAccount(generatePrivateKey())`, made in Node per run.

### Report (`lib/report.ts`)

- Run id: `YYYYMMDD-HHMMSS-xxxx` (UTC, 4 hex), like `e2e/run.ts`.
- `e2e/human/runs/<run-id>.md`, and `e2e/human/runs/LATEST.md` (a copy with a first-line comment
  naming the run file). A header table: run id, commit (`git rev-parse --short HEAD`, plus "with local
  changes" when dirty, excluding `e2e/human/runs`), console URL, hub URL, started, duration. Then one
  section per project: its status (`PASS`, `FAIL` with the failed step and message, or `NOT RUN (<skip
  reason>)`), the wallet address, a steps table (step, status, duration), the transactions (funding,
  escrow fund, release) as explorer links via `explorerTx("arc", hash)`, the slip hash, the verifier
  line, and the artifact paths (screenshots, trace, slip.json).
- Leak scan before writing: every registered secret value must not occur in the report or in any text
  file under `artifacts/<run-id>/`; a hit deletes the offending file, writes the report without it, and
  makes the process exit 1 with "leak: <file>" (never the value).

### CI workflow (your FIRST commit, on its own; the lane lands it in its own PR while you build the rest)

`.github/workflows/human-e2e.yml`:

- `on`: `schedule` with cron `30 21 * * *` (03:00 IST) and `workflow_dispatch` with input `project`
  (choice `privy`, `injected`, `both`; default `both`). **No `pull_request`, no `push`.**
- `permissions: contents: read`; `concurrency: { group: human-e2e, cancel-in-progress: false }`; one job
  on `ubuntu-latest`, `timeout-minutes: 30`.
- Steps: `actions/checkout@v4`; `oven-sh/setup-bun@v2` with `bun-version: 1.3.14`;
  `bun install --frozen-lockfile`; `actions/setup-node@v4` with `node-version: 22`;
  `npx playwright install --with-deps chromium` in `e2e`; then in `e2e`:
  `npx playwright test -c human/playwright.config.ts` plus `--project=privy` or `--project=injected`
  when the input says so (schedule runs both).
- Env for the test step: `E2E_HUMAN_FUNDER_KEY: ${{ secrets.E2E_HUMAN_FUNDER_KEY }}`,
  `PRIVY_TEST_EMAIL: ${{ secrets.PRIVY_TEST_EMAIL }}`, `PRIVY_TEST_OTP: ${{ secrets.PRIVY_TEST_OTP }}`,
  and `E2E_HUMAN_CONSOLE` / `E2E_HUMAN_HUB` from `vars` when set.
- Always: upload `e2e/human/artifacts/` and `e2e/human/runs/` with `actions/upload-artifact@v4`
  (retention 14 days), and append `e2e/human/runs/LATEST.md` to `$GITHUB_STEP_SUMMARY` if it exists.

## data-testid contract (cs-ui adds these; copy exactly)

The full list with states is in the lane's `HUMAN-TESTIDS.md`; the ones this flow uses: `wallet-connect`,
`wallet-option-privy`, `wallet-option-injected`, `wallet-fallback-reason`, `wallet-address`,
`wallet-chain`, `wallet-switch-chain`, `wallet-kind`, `wallet-usdc`, `start-role-buy`, `offer-list`,
`offer-item` (`data-offer-hash`, `data-rail`, `data-price`), `offer-open`, `offer-hash`, `buy-start`,
`buy-countersign`, `buy-countersigned`, `buy-fund`, `buy-funded`, `buy-refusal`, `buy-delivery`,
`buy-output`, `buy-released`, `buy-slip-link`, `slip-hash`, `slip-verify`, `slip-verdict`.

## Offline tests you write and run (`bun test e2e/human/test`)

- `wallet`: `handleWalletRequest` with a fixed test key (a constant in the test file is fine, e.g.
  `0x` + `"11".repeat(32)`): accounts; chain id; switch to Arc ok and to 1 → 4902; `personal_sign`
  recovers to the address (`recoverMessageAddress`); `eth_signTypedData_v4` of a sample EIP-712 payload
  (with `EIP712Domain` in `types`) verifies with `verifyTypedData`; an unknown method → 4200; another
  address → 4100. RPC forwarding is not called in tests (inject a fake request function).
- `keys`: `process.env` wins over the file; a missing directory gives `undefined`; values are
  registered for redaction.
- `report`: renders PASS, FAIL and NOT RUN sections with explorer links; the leak scan deletes a planted
  artifact containing a registered value, exits non-zero, and the report never contains the value.
- `fund`: the expected balance arithmetic (before + 1_000_000; then minus the price) as pure functions.

## Gate (all must pass; paste the output tails in your report)

1. `bun run typecheck` clean (the root config includes `e2e`).
2. `bun test e2e/human/test` all pass.
3. `bun test e2e/test` still passes (the existing harness).
4. `cd e2e && npx playwright test -c human/playwright.config.ts --list` lists the two tests
   (`privy`, `injected`). `--list` loads the files without launching a browser.

## Constraints

- **No browser of any kind on this machine:** no headless Chrome, no Playwright test run other than
  `--list`, no `playwright install`, no Puppeteer, no screenshot tools. The lane runs the browser later.
- No keys: never read, print or log a real key; tests use fixed fake keys. Never move funds: no
  transaction is sent while you work. Never call the production console or hub.
- Touch only `e2e/human/**`, `e2e/package.json`, `.gitignore`, and the workflow file. Do not edit
  `e2e/lib/**`, `e2e/flows/**`, `apps/**` or `packages/**`. Never commit `bun.lock`.
- Never push, merge or deploy. Commit on `cs/cs-60` in small present-tense commits, no emoji, no
  Co-authored-by and no other trailers. The workflow file is the first commit, on its own, and no
  later commit touches it.
- If a mechanism above cannot work as written (an API that does not exist, a type that cannot be met),
  stop and write in your report exactly what and why; do not substitute another mechanism.

## Report

`.packets/reports/cs-60-e2e-human.md`: what you built, file by file; the gate outputs; anything you
could not do as written, and why; the note that `bun.lock` needs orch-cs.
