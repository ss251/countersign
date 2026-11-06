# cs-30-identity-sticky report: a transient RPC error keeps the last identity

Branch: `cs/30-identity-sticky`, created from `cs/int`. Only the leased files changed.

## Diff summary

`apps/hub/src/identity.ts`:

- Added `FAILURE_CACHE_MS = 30 * 1000`.
- Added `lastFound: Map<string, Erc8004Identity>`, keyed like the lookup cache. A
  successful lookup with a non-null value stores it there; a lookup that throws returns
  the stored identity, or `null` when there is none.
- Wrapped each window's `client.getRegisteredLogs(...)` call in `retryOnce`, which calls
  it a second time for the same window when the first call throws.
- A failed lookup is cached for `FAILURE_CACHE_MS`; a successful lookup, including one
  with no registration, stays cached for `CACHE_MS`. The failed/successful distinction
  is a local `failed` flag set by the same catch block that supplies the sticky value.
- Updated the doc comment: a failed lookup keeps the last identity it found and is
  retried after 30 seconds.
- Window size, `fromBlock`, newest-registration rule, exported types, `rpcClient`, and
  the never-a-failed-request behaviour are unchanged.

`apps/hub/test/identity-sticky.test.ts` (new): uses the `client` and `now` seams, no
network.

## Test names

- `a failure keeps the last identity`
- `a failure is cached only 30 s`
- `one failed window is retried`
- `a success with no registration is cached for the full lifetime`

Existing tests were not edited.

## Acceptance

From the worktree root:

```
bun install --linker hoisted && bun run typecheck && bun test apps/hub && bun test && forge test
```

All exit 0.

| Command | Result |
| --- | --- |
| `bun install --linker hoisted` | no changes |
| `bun run typecheck` | pass |
| `bun test apps/hub` | 180 pass, 0 fail, 906 expect() calls, 19 files |
| `bun test` | 1169 pass, 3 skip, 0 fail, 4333 expect() calls, 135 files |
| `forge test` | 47 pass, 0 fail, 0 skipped, 5 suites |

The 4 new tests plus the 4 existing `erc8004 identity` tests pass in
`bun test apps/hub/test/identity-sticky.test.ts apps/hub/test/frontdoor.test.ts`
(26 pass, 0 fail).
