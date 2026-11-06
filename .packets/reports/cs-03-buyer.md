# cs-03-buyer report

## Built
packages/buyer: payer, hub-client, journal, state, buy, resume, cli, index, plus test/buy.test.ts (8 tests, fake hub on Bun.serve).

## Acceptance (last lines)
- bun run typecheck: clean
- bun test packages/buyer: 8 pass, 0 fail
- bun test: 56 pass, 0 fail
- forge test: 29 tests passed, 0 failed, 0 skipped

## Could not do
packages/buyer/package.json does not list `viem`, and I may not edit package.json. Without it, `viem` and `viem/accounts` do not resolve from packages/buyer on a clean `bun install`, so typecheck and tests fail there. I verified with an untracked symlink, packages/buyer/node_modules/viem -> ../../core/node_modules/viem. The fix is to add `"viem": "^2.57.16"` to packages/buyer/package.json (as packages/rail does) and rerun `bun install`.
