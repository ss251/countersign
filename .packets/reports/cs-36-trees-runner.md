# cs-36-trees-runner

Branch `cs/36-trees-runner`. A purchase made inside a job carries that job's lineage, and the seller signs the children its own buyer keys bought.

## Diff summary

`packages/runner/src/child.ts`

- `scrubbedEnv` takes an optional `lineage`. When it is set, the scrubbed env gains only `COUNTERSIGN_LINEAGE`. PATH and a fresh HOME are unchanged. The value holds no secret.
- `runInChild` passes that string into the child. Omitting it leaves the env exactly PATH and HOME, so the existing scrub still holds.

`packages/runner/src/daemon.ts`

- Starting a job passes `[...order.lineage, order.jobId].join(",")` as that lineage.
- `RunnerConfig` gains optional `buyerAddresses`.
- Just before `slipBodyFor`, the runner `GET`s `<hub http base>/jobs/<jobId>/children` and then each kept child's slip. The http base is the hub URL with `ws`/`wss` flipped to `http`/`https` and a trailing slash stripped. One 2-second abort covers the list and every slip fetch.
- A child is kept only when `slipHash` matches `0x` plus 64 hex characters and the slip's `body.buyer`, compared case-insensitively, is the runner account or one of `buyerAddresses`. `children` is those hashes, lowercased, sorted, and de-duplicated.
- Any error or timeout leaves `children` as `[]`. Signing still runs.

`packages/runner/src/cli.ts`

- Repeatable `--child-buyer <address>` fills `buyerAddresses`. An empty value is refused. The flag is not restricted to EVM addresses.

`packages/buyer/src/buy.ts`

- Both hub calls use `lineageFromEnv(a.lineage)`. An explicit lineage is returned unchanged. Otherwise `COUNTERSIGN_LINEAGE` is split on commas, entries matching `/^0x[0-9a-fA-F]{64}$/` are kept, and the list stops at 16. An unset variable omits lineage.

`packages/runner/test/children.test.ts` and `packages/buyer/test/lineage-env.test.ts` are new. No existing test edited. No new dependencies.

## Tests

- `slip children > attests a purchase made by the runner and not one made by a stranger`
- `slip children > delivers with an empty children list when the hub times out`
- `slip children > the child env carries COUNTERSIGN_LINEAGE and no other new variable`
- `slip children > also attests purchases made by a configured child buyer, sorted and de-duplicated`
- `--child-buyer > repeats and keeps each address`
- `COUNTERSIGN_LINEAGE > the call body carries the lineage when none was given`
- `COUNTERSIGN_LINEAGE > invalid entries are dropped and at most 16 remain`
- `COUNTERSIGN_LINEAGE > an explicit lineage wins`
- `COUNTERSIGN_LINEAGE > omits lineage when the variable is unset`

## Counts

`bun run typecheck` passed.

`bun test packages/runner packages/buyer apps/hub`: 514 pass, 0 fail, 1995 expect() calls. Ran 514 tests across 68 files.

`bun test`: 1398 pass, 4 skip, 0 fail, 5712 expect() calls. Ran 1402 tests across 182 files. The 4 skips were already skipped (three Arc testnet slip checks and the STEER-2225 wallet-hygiene check).

`forge test`: 47 passed, 0 failed, 0 skipped (5 suites: Parity, FeeSplit, W1Bond, Bond, CountersignedEscrow).
