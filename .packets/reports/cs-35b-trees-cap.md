# cs-35b-trees-cap

Branch `cs/35b-trees-cap`. `GET /trees/:root` still walks breadth-first, but the queue and the `missing` list stay bounded however many children a slip names.

## Diff summary

`apps/hub/src/app.ts` (`receiptTree` and one new constant):

- `TREE_MAX_MISSING = 256` sits beside `TREE_MAX_DEPTH` (8) and `TREE_MAX_NODES` (256).
- Before each child is queued, the walk stops pushing once `queue.length + Object.keys(nodes).length >= TREE_MAX_NODES`. The queue never holds more hashes than the walk could still visit.
- A hash is appended to `missing` only while `missing.length < TREE_MAX_MISSING`.
- The response gains `truncated`. It is true when a child is dropped for the queue limit, the node limit, the missing limit, or the depth limit (a slip at depth 8 that still has children). Otherwise it is false.
- Visit order, the depth limit, the 404 for an unknown root, and `observed` are unchanged.

`apps/hub/test/trees.test.ts` adds two tests. No existing test was edited, skipped, or weakened. `TreeBody` gains `truncated`.

## Tests

- `GET /trees/:root > a root naming 300 children the hub does not hold answers 200, caps missing, and sets truncated`
  - The slip is built with `signedSlip` / `keep`, the same way the other child-list tests build slips. Its body names 300 hashes the hub does not hold.
  - The response is 200. `missing.length` is at most 256. `truncated` is true.
- `GET /trees/:root > a small tree answers with truncated false and the same nodes`
  - Same four-node shape as the existing titled-nodes test: a root, two children, and one grandchild.
  - `truncated` is false, `missing` is empty, and the four node hashes and titles are unchanged.

## Counts

`bun install --linker hoisted` completed with no package changes.

`bun run typecheck` passed.

`bun test`: 1391 pass, 4 skip, 0 fail, 5700 expect() calls. Ran 1395 tests across 180 files. The 4 skips were already skipped (Arc testnet slip checks and the STEER-2225 wallet-hygiene check).

`forge test`: 47 passed, 0 failed, 0 skipped (5 suites).
