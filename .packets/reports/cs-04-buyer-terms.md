# cs-04-buyer-terms report

## Built
- `src/known-rails.ts`: pins the Arc and Whitechain rails and matches a 402 entry on network, chainId, escrow, token, token name and token version, with checksummed addresses.
- `src/terms.ts`: `checkTerms` compares scheme, rail, offer hash, payee, amount, delivery window and timeout with the offer the buyer fetched. Mismatches are refused before any signature or envelope reservation.
- `buy()`: appends `refused` with reason `terms` on a mismatch. Otherwise it reserves under the journal lock and passes the matched rail to the payer. `countersignPayer` now signs the pinned escrow, token, token name, token version and chainId, never the hub's `extra`.
- `Journal.reserve`: takes `<path>.lock` with `openSync(..., "wx")`, retries for up to 5 s, re-reads spend under the lock and appends the `countersigned` reservation before signing. A follow-up `signed` entry adds the jobId; a signing failure appends `failed` and `spend()` releases that reservation. `open()` resumes from the `signed` jobId.
- `resume`: a hub `refunded` report is checked with `jobOf` on the matched rail's `rpcUrl`; only status 3 appends `refunded`. Anything else appends nothing and reports "hub says refunded; chain does not". The chain reader is injectable.
- CLI appends an optional `<state>/rails.json` list to the pinned rails so a local anvil can be used.

## Tests
- `w1-attacks.test.ts`: all 5 adversarial tests pass unchanged; its fake 402 now names a known test rail.
- `buy.test.ts`: 8 pass, updated for the `signed` journal entry.
- `terms.test.ts`: 6 new tests cover an unknown escrow, an unknown token, a rails.json rail, two concurrent buys under a one-call cap, and both resume refund outcomes.

## Acceptance
From the worktree root, `bun install && bun run typecheck && bun test packages/buyer && bun test && forge test`:
- typecheck: clean
- buyer tests: 19 pass, 0 fail
- all JS tests: 67 pass, 0 fail
- forge tests: 29 pass, 0 failed, 0 skipped

No out-of-lease edits, no browser, no faucet, no push, merge or deploy.
