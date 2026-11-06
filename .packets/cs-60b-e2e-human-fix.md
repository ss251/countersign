# cs-60b-e2e-human-fix: corrective for cs-60 (review, public-artifact rules, the console's real ids)

Lane: cs-e2e. Branch: `cs/cs-60`, continuing from its head (`4ac1d39` or later). Read
`.packets/cs-60-e2e-human.md` first: everything there still holds unless this packet changes it.

The repo is public, and CI uploads artifacts anyone can download. The Privy test login (a short email and a
6-digit code) cannot be redacted by substring scan, so it must never reach an artifact at all.

## Commit 1, alone: the workflow (`.github/workflows/human-e2e.yml`)

1. Pass the input through env, never inline in `run`:
   `env: PROJECT: ${{ github.event.inputs.project }}`, and the script reads `case "$PROJECT" in`.
2. Upload only reports and the injected project's artifacts. The `path:` block of the upload step becomes
   exactly:
   ```
   e2e/human/runs/
   e2e/human/artifacts/*/injected/
   ```
   Nothing from `artifacts/*/privy/` and nothing from `test-results/` is ever uploaded.
Change nothing else in the file.

## Commit 2+: the code

### A. The privy project leaves no secret in any artifact

1. **No trace at all for `privy`.** Delete the `context.tracing.start(...)` and `tracing = true` that run after
   sign-in (`tests/buy.spec.ts`, about lines 257-258). Only the `injected` project records a trace.
2. **No screenshot while Privy's dialog is open after typing.** Before the signed-in screenshot (about line
   256), `await expect(page.getByRole("dialog")).toBeHidden({ timeout: 30_000 })`. The empty-modal
   screenshot before typing stays.
3. **The verifier child gets a minimal env:** `spawnSync(..., { env: { PATH: process.env.PATH ?? "",
   HOME: process.env.HOME ?? "", NO_COLOR: "1" } })`. It never inherits keys.
4. **The leak scan always runs.** In `lib/report.ts`, remove the early `if (projects.length === 0) return;`
   before the scan (about line 381). With no `result.json`, the scan still covers the report and every
   text file under `artifacts/<run-id>/`.

### B. Fail and skip honestly

1. **Privy outage detection** (`buy.spec.ts`, about line 155): ignore failed requests whose error text
   contains `ERR_ABORTED`; clear the recorded failures immediately before the click on the Privy option;
   count only `privy.io` responses with status >= 500 and other `requestfailed` errors after that point.
2. The **"Privy not offered"** failure (about line 245) also becomes `test.skip(true, "Privy unavailable:
   ...")` when the outage list is non-empty at that moment; otherwise it fails as now.
3. **No falsy throw:** replace `if (failure) throw failure;` (about line 438) with a boolean `failed` set
   in the catch, and `if (failed) throw failure instanceof Error ? failure : new Error(String(failure))`.
4. **Step 08 never fails the run:** its entry screenshot and everything else in it go inside its own
   try/catch; a failure there is recorded as a note in the report, not a step failure.

### C. Drive the console by the ids it actually has (cs-ui's ui-A2 and ui-B)

Replace the testid contract of cs-60 with this one. Where an id below carries an attribute that is
missing at run time, fail with `the console does not expose <id>[<attribute>] (cs-ui)`. Never guess
from visible text.

| step | element | read |
|---|---|---|
| open the connect menu | `wallet-menu` (button) | click |
| choose Privy | `wallet-signin` | click |
| choose injected | `wallet-connect-injected` | click |
| why Privy is not offered | `wallet-fallback-reason` | text |
| the wallet | `wallet-address` | `data-value` = full address; `data-kind` = `privy` or `injected` |
| the chain | `wallet-chain` | `data-value` = chain id; must be `5042002` |
| wrong chain | `getByRole("button", { name: /switch to arc/i })` | click once, then re-read `wallet-chain` |
| the buyer path | `page.goto("/#/start")`, then `start-buy` visible | |
| the offer shown | `start-offer` | visible; the run records its text |
| buy | `start-countersign` | must be enabled; click; then `approveIfPrompted` up to twice (countersign, then payment) |
| refused | `start-refusal` | if visible, fail with its text |
| the result | `start-fund-result` | `data-value` = a tx hash (`^0x[0-9a-fA-F]{64}$`) |
| the slip | `start-slip` visible; slip hash = the `0x` 64-hex in `start-verify`'s `href` (`#/verify/<hash>`) | |
| verify in the console | click `start-verify`; on `#/verify/<hash>`, `verify-verdict` | `data-state` becomes `valid` (60 s) |

Remove every use of the old ids (`wallet-connect`, `wallet-option-*`, `wallet-kind`, `wallet-usdc`,
`wallet-switch-chain`, `offer-*`, `buy-*`, `slip-*`). The `wallet-usdc` check is dropped; the balance is
checked on chain, as before.

### D. Prove the purchase on chain, from the slip

After the slip hash is known:

1. `GET <hub>/slips/<hash>` must answer 200; save the body as `artifacts/<run>/<project>/slip.json`. Take
   `body.jobId`, `body.offerHash`, `body.amount` and `body.buyer`.
2. `body.buyer` equals the wallet address, case-insensitive.
3. **The escrow fund tx:** query `getLogs` on `ARC.escrow` for the v1 `Funded` event with
   `args: { jobId }`, from the funding step's receipt block to latest. Exactly one log is expected. Its
   `transactionHash` is the fund tx; record it as "escrow fund". Decode it: `buyer` equals the wallet,
   `amount` equals `body.amount`, `offerHash` equals `body.offerHash`.
4. **Delivery:** the same query for `Released` with `args: { jobId }` returns exactly one log, whose
   `slipHash` equals the slip hash. Record its tx as "release".
5. `start-fund-result`'s tx receipt succeeded, and its logs contain an escrow event (`Funded` or
   `Released`) for this `jobId`.
6. The wallet's USDC after the purchase equals the step-4 balance minus `body.amount` exactly.
7. The standalone verifier, with the minimal env from A3, prints exactly `VALID` as its last line.

Use the event definitions from `e2e/lib/chains.ts` (`escrowAbi` through `escrowEvents`), or a
`parseAbiItem` of the same signatures.

### E. Tests (`bun test e2e/human/test`)

Add:

- the leak scan runs when no `result.json` exists and still deletes a planted file;
- the failure flag: a falsy thrown value still fails;
- the outage filter: `ERR_ABORTED` is ignored and a 503 counts;
- the slip-hash parser: it accepts `#/verify/0x` plus 64 hex and rejects anything else.

## Gate (paste the tails in your report)

1. `bun install --linker hoisted && bun run typecheck` clean.
2. `bun test e2e/human/test` and `bun test e2e/test` all pass.
3. `cd e2e && npx playwright test -c human/playwright.config.ts --list` lists the two tests.

## Constraints

- **No browser of any kind on this machine:** only `--list`, never a test run; no `playwright install`.
- **Never run `git stash`;** use a temporary commit or a second worktree.
- Touch only `e2e/human/**` and `.github/workflows/human-e2e.yml` (commit 1, alone). Never commit
  `bun.lock`.
- Never read, print or log a real key or the Privy login; tests use fakes. Never move funds and never
  call production.
- Never push, merge or deploy. Small present-tense commits on `cs/cs-60`, with no emoji, no
  Co-authored-by and no trailers.
- If a mechanism cannot work as written, stop and report exactly what and why.

## Report

Write `.packets/reports/cs-60b-e2e-human-fix.md` with each item A1 to E and its line range, and the gate
outputs.
