# cs-40-identity-persist report: a hub restart keeps every seller's ERC-8004 identity

Branch: `cs/40-identity-persist`, created from `cs/int`. Only the leased files changed.

Commits:

- `4402769` store the last erc8004 identity for each seller (refs #31)
- `df963ae` resume erc8004 scans from the block an identity was found (refs #31)

## Diff summary

`apps/hub/src/store.ts`:

- Creates `erc8004_identities` idempotently, with the same `CREATE TABLE IF NOT EXISTS` path as the other tables: `seller TEXT PRIMARY KEY`, `registry TEXT NOT NULL`, `agent_id TEXT NOT NULL`, `block INTEGER NOT NULL`, `updated_at INTEGER NOT NULL`.
- `getIdentity(seller)` returns `{ registry, agentId, block }` or `null`. The lookup key is `seller` lowercased, and `block` comes back as a `bigint`.
- `putIdentity(seller, { registry, agentId, block }, now)` upserts on `seller`. The stored seller is lowercase.

`apps/hub/src/identity.ts`:

- `Erc8004IdentityOptions` gains optional `persist.get` / `persist.put`.
- On a memory-cache miss, the lookup reads `persist.get(seller)` before it scans. A row whose `registry` equals `options.registry`, case-insensitively, seeds `lastFound` when that seller has no in-memory identity yet. The scan starts at `max(fromBlock, row.block)`, so the row's own block stays inside the first window.
- A scan that finds a registration calls `persist.put(seller, { registry, agentId, block: newest.blockNumber })`.
- A failed scan still returns `lastFound`, so a row read back after a restart survives an RPC failure.
- A scan that finds nothing after that block keeps the persisted identity. A later window cannot unregister an agent.
- Cache times, `retryOnce`, the newest-log rule, and null when there is no registration and no matching row are unchanged.

`apps/hub/src/index.ts`:

- The ERC-8004 lookup receives `persist` backed by `store.getIdentity` and `store.putIdentity`. `updated_at` is the hub clock. Nothing else in boot changes.

`apps/hub/test/identity-persist.test.ts` (new). `identity-sticky.test.ts` was not edited.

## The five tests

1. `a persisted row survives a client that throws` — the client throws on every call, the stored registry differs in case, and the lookup returns that agent id. `persist.put` is not called.
2. `a persisted row starts the scan at its block` — the row is at block 12000 and `options.fromBlock` is 0. The first `getRegisteredLogs` starts at 12000, no window starts at 0, an empty scan keeps agent id 7, and `persist.put` is not called.
3. `a newer registration is returned and saved` — the scan from the persisted block finds a later log. The lookup returns its agent id, and `persist.put` saves that agent id and block.
4. `a row for a different registry is ignored` — the lookup does not return that row. The first window starts at `options.fromBlock` (0), and the registration found there is what `persist.put` saves.
5. `the store round-trips an identity and stores the seller lowercase` — a real file-backed store (opened twice) round-trips `getIdentity` / `putIdentity`, the second put replaces the row, and a second connection reads the seller column in lowercase.

No network. No new dependencies.

## Acceptance

From the worktree root, after `bun install --linker hoisted` (no lockfile change):

| Command | Result |
| --- | --- |
| `bun run typecheck` | pass, exit 0 |
| `bun test` | 1458 pass, 5 skip, 0 fail, 5949 expect() calls, 194 files |
| `forge test` | 47 pass, 0 fail, 0 skipped, 5 suites |

Second worktree of the finished commit, `bun install --frozen-lockfile && bun run typecheck`: pass, exit 0.
