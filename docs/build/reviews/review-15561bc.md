> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review 15561bc (PR 200, cs/cs-60, the e2e/human project): where its secrets travel

Reviewer: cs-w1. Result: **blockers=0 should-fix=0**. I did not run the browser flow (no browser on this machine); I read it and ran its offline tests.

## Secrets
1. **The run's inputs.**
   - The workflow runs only on its schedule and on manual dispatch, never for a pull request, so a fork never sees the secrets.
   - It has `permissions: contents: read`.
   - `E2E_HUMAN_FUNDER_KEY`, `PRIVY_TEST_EMAIL` and `PRIVY_TEST_OTP` reach only the run step's environment.
2. **One loader.** `Keyring` reads each secret from the environment, or locally from the `~/.config/countersign` files. It registers every value with the redactor, in both its 0x and bare forms, before use.
3. **The funder key stays in Node.** It only signs the 1 USDC funding transfer to the run's wallet.
   - The injected project's wallet is a fresh `generatePrivateKey()` account behind a Playwright binding (`window.__csWallet`), so even that key never enters the page.
   - It signs only for its own address and serves only Arc.
4. **What leaves the runner.**
   - Playwright's trace, screenshots and video are all off.
   - The upload is `e2e/human/runs/` plus `artifacts/*/injected/` only. The Privy project's artifacts, where the email and OTP are typed, are never uploaded.
   - `finalizeReport` scans every text artifact for a registered secret and deletes any file that holds one before the upload. It redacts the report, rewrites repo and home paths, and exits non-zero on a leak. `report.test.ts` covers the planted leak, and the fresh-process exit as well.

## Checks
- **Offline tests.** `e2e/human/test` plus the harness give 58 pass on this head.
- **The lockfile is not regenerated yet.** The frozen install fails here ("lockfile had changes"), so `@playwright/test` is missing and the two files that import it fail to load. That is the planned order: the lockfile is regenerated on cs/int after #196.
- **The root gate stays green afterwards.** The gate's plain `bun test` collects `*.spec.ts` files. With `@playwright/test` installed, bun runs 0 tests from `buy.spec.ts`, with no error.

## Notes
1. On the build machine the funder falls back to `CS_DEPLOYER_KEY`. It stays in Node, but a dedicated funder key there too would keep the deployer key out of any automation process.
2. `leakScan` reads text files only, so screenshots are not scanned. That is safe because only the injected project's screenshots are uploaded, and its key never enters the page. Keep the Privy project out of the upload, as now.
