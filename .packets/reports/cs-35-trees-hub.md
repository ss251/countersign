# cs-35-trees-hub

Branch `cs/35-trees-hub`. The hub records which job a purchase was made inside, and serves that job's children and the receipt tree.

## Diff summary

`apps/hub/src/store.ts`

- `JobRecord` gains `parentJobId?: Hex | null`. The property is optional so existing job literals still typecheck; every reader sets it to hex or null. Rows from before the column read null.
- `jobs` gains `parent_job_id TEXT NULL`, in `CREATE TABLE` and in the same idempotent `PRAGMA table_info` alter as `review_window` and `ends_at`.
- `putJob` and `claimJob` write the column. A record that omits the field stores null.
- `jobFromRow` and the seller job query return the field.
- `childJobs(parentJobId)` returns those jobs, compared with `lower()`, ordered by `created_at`, then `job_id`.

`apps/hub/src/call.ts`

- `parentOf(store, lineage)` walks the lineage from the end and returns the stored `jobId` of the first entry `getJob` knows. Offer hashes and unknown ids are skipped.
- `claimJob` sets `parentJobId: parentOf(deps.store, lineage)` from the `lineage` `paidCall` already computed.

`apps/hub/src/app.ts`

- `GET /jobs/:jobId/children` returns `{ jobId, children: [{ jobId, offerHash, status, slipHash }] }` from `childJobs`. An unknown or childless job returns `children: []`.
- `GET /trees/:root` returns 404 `unknown-slip` ("Refused. That slip is not known.") when the slip is absent. Otherwise it walks `body.children` breadth-first, visits each hash once, stops below depth 8 (root is depth 0), and stops at 256 nodes. Each node is `{ slip, title, sellerName, observed }`. `title` is the stored offer title, or `offer` plus the short hash. `sellerName` and that short hash are the first 6 characters, `…`, and the last 4. `observed` is the non-null slip hashes of jobs recorded inside `slip.body.jobId`. A child hash the hub does not hold is listed in `missing`.

`apps/hub/test/trees.test.ts` is new. No view code, no new dependencies, no existing test edited.

## Tests

- `recording the parent > a paid call records the last lineage job this hub knows`
- `GET /jobs/:jobId/children > lists the jobs claimed inside J, in order, each with its slip once released`
- `GET /trees/:root > a root with two signed children, one of which has its own child, returns all four titled nodes`
- `GET /trees/:root > a child hash the hub does not hold goes into missing`
- `GET /trees/:root > a cycle, where a child names the root, visits every slip once`
- `GET /trees/:root > a chain deeper than 8 stops at depth 8`
- `GET /trees/:root > an unknown root answers 404 unknown-slip`
- `GET /trees/:root > an empty children list still reports the child jobs the hub recorded`

## Counts

`bun run typecheck` passed.

`bun test apps/hub`: 248 pass, 0 fail, 1183 expect() calls, 31 files.

`bun test`: 1389 pass, 4 skip, 0 fail, 5690 expect() calls. Ran 1393 tests across 180 files. The 4 skips were already skipped (Arc testnet slip checks and the STEER-2225 wallet-hygiene check).

`forge test`: 47 passed, 0 failed, 0 skipped (5 suites).
