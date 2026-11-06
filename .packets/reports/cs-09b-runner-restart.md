# cs-09b-runner-restart — report

Date: 2026-11-06
Branch: `cs/cs-09b`

## Landed

- `publishOffer` returns `{ offerHash, offer }`, where `offer` is the exact stable offer it sent to the hub. The state file, stable key, signature and HTTP call are unchanged.
- `publishCommand` prints the returned `offerHash`.
- `serveCommand`'s publish loop is now the exported `prepareServed(options, account)`, which returns `{ served, hashes }`. `served` holds the stable offers the hub stored, not the freshly built ones, so a restarted runner's `hello` claims the same hash the hub knows and the offer stays online.
- `restart.test.ts` publishes and starts twice against a fake hub with the same state directory, at clocks an hour apart. It asserts both `hello` frames claim the same hash, that hash is stored at the hub and is accepted in `ready`, so the hub marks it online.
- `publish.test.ts` now asserts the returned offer hashes to the returned `offerHash`, and that identical inputs return equal offers.

## Verification

From the worktree root:

```
bun install                       # 162 installs, no changes
bun run typecheck                 # pass
bun test packages/runner          # 20 pass, 0 fail
bun test                          # 486 pass, 3 skip, 0 fail
forge test                        # 29 pass, 0 fail
```

The 3 skips are the pre-existing `apps/web/test/onchain.live.test.ts` suite gated by `CS_LIVE=1`; no new test is skipped.

No browser, Playwright, Puppeteer or screenshot tool was launched. All network traffic was against localhost fakes with fixed anvil test keys.
