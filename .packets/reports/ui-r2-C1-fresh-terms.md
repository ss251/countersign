# ui-r2-C1-fresh-terms — report

Date: 2026-11-07
Branch: `cs/ui-r2-C1`

## Landed

- `apps/web/src/lib/purchase.ts` adds `SIGN_SLACK_SECONDS = 120` and a fifth `slackSeconds = 0` parameter to `buildAuthorization`. The signed deadline is now `nowSeconds + extra.deadlineSeconds + slackSeconds`; `validBefore` stays `nowSeconds + 600`. The default keeps every existing call and test on the old deadline.
- `PendingPurchase` records `preparedAt` (unix seconds). `pendingOf` takes it as its last parameter, and `buy()` passes the same `now` it used for the first 402.
- New `freshTerms(deps)` rebuilds the authorization at the moment of signing. Terms older than 30 seconds are refetched first; a `null` answer or throw returns `failed`, and a fresh requirement whose `payTo`, `amount`, `extra.offerHash`, `extra.deadlineSeconds`, `network` or `asset` moved returns `changed`. A young or unchanged requirement returns `ready`, always with a newly built authorization (fresh salt, fresh job id and nonce) carrying the sign slack.
- `confirm()` now sets `Preparing fresh terms…`, calls `freshTerms` after the existing wallet and chain check, and only then opens the wallet. `failed` keeps the pending and review phase and shows the exact expiry sentence; `changed` installs the fresh pending, stays in review and asks for another look; `ready` installs the fresh pending, clears the note and signs exactly as before. The wallet still opens only in `confirm()`.
- `usePurchase` returns `signer: Address | null`, set with the signature from the fresh authorization's `terms.buyer`. `PurchaseResult` shows `shortHex(signer)` with `title={signer}` on the existing `data-testid`, and both callers (start and assistant card) pass it.
- `apps/web/test/fresh-terms.test.ts` covers the slack deadline and `validBefore`, refetch at 31 seconds (once, rebuilt deadline, new job id, `preparedAt` at Sign), no refetch at 5 seconds but a rebuilt authorization, every material field returning `changed`, `null` and throw returning `failed` with the exact message, and the rail's own `signNow + 120 - 15` … `signNow + 120 + 300` bounds after eight minutes.

## Verification

From the worktree root, in order:

```
bun install --linker hoisted
bun run typecheck
bun test apps/web/test
(cd apps/web && bunx --bun vite build)
bun apps/web/scripts/wallet-grep.ts apps/web/dist
```

The suite is 273 pass, 3 skip, 0 fail (1734 expectations) with `dist` present; the 3 skips are the pre-existing live Arc RPC suite. The build succeeds, and wallet-grep reports 84 bundle files, no approval or permit selector, and no approve, permit, `eth_sign`, `personal_sign` or `eth_requestAccounts` from our code.

## Notes

- `packages/cli/src/bin.ts` already had a mode-only change in the worktree before this packet; it is not part of these commits.
- Only the leased files changed: `purchase.ts`, `PurchaseResult.tsx`, the two callers' `signer` prop and the new test. Nothing under `packages/**` or `apps/hub/**`, and no CSS.
- No browser was launched. No dependencies were added.
