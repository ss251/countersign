# ui-r2-C1c — report

Date: 2026-11-07
Branch: `cs/ui-r2-C1c`

## Landed

- `apps/web/src/lib/arc-pin.ts` keeps `ARC_PIN` (v1) and `ARC_CHAIN_ID` as they were and adds `ArcPin`, `ARC_PINS` and `pinFor`. The pins are v1 at `0x19c2…1b76` and v2 at `0x10A3…F3CE` on chain 5042002, both on the same Arc USDC token and domain. `pinFor` compares with viem's `getAddress` inside a try/catch, returns v1 when the 402 names no escrow, and `null` for a bad or unpinned address. A mixed-case `0X` prefix is normalised before viem sees it; checksum validation still applies.
- `trustedRequirement` now returns `{ ok: true, req, pin }`. It resolves the named escrow through `pinFor`; a `null` pin keeps the existing "escrow this page does not trust" sentence. It then enforces the version rules with the exact required sentences: a v1 pin refuses `escrowVersion === 2`, a v2 pin refuses anything but `escrowVersion === 2`, and a v2 pin refuses unless `extra.bond === (offer.bond ?? "0")` and `extra.reviewWindow === (offer.reviewWindow ?? 0)`.
- `buildAuthorization` takes `pin: ArcPin = ARC_PINS[0]` as its sixth parameter. `chainId`, `escrow`, `token`, `tokenName` and `tokenVersion` come from the pin. A v2 pin adds `bond` and `reviewWindow` to the terms the same way `packages/buyer/src/payer.ts` does, so core derives the v2 job id. The default keeps every existing caller on v1.
- `PendingPurchase` carries `pin`, set by `pendingOf` (last parameter, default v1 so existing callers stay on v1). `buy()` passes the pin chosen by `trustedRequirement` into both `buildAuthorization` and `pendingOf`.
- `freshTerms`'s production `refetch` returns `{ req, pin } | null`. A refetched pin whose version or escrow differs from `pending.pin` is `changed` before any `ready`, and the changed pending is rebuilt on the new pin so the next review signs the hub's current escrow. The type also still accepts a bare `PaymentRequirements` for older callers; that path derives its pin from the requirement's own escrow and falls back to the pending pin, which is what keeps the pre-existing fresh-terms tests untouched while production always supplies the pin explicitly.
- `apps/web/test/arc-v2-pin.test.ts` covers `pinFor` case handling, v2, no escrow, bad and unpinned addresses; v1 and v2 402 acceptance; both version refusals; the v2 bond and review-window refusals; today's unpinned refusal; the v2 authorization's escrow, bond and reviewWindow; the v2 job id differing from the v1 one; and a refetch on the other pin returning `changed`.

## Verification

From the worktree root, in order:

```
bun install --linker hoisted
bun run typecheck
bun test apps/web/test
(cd apps/web && bunx --bun vite build)
bun apps/web/scripts/wallet-grep.ts apps/web/dist
```

Typecheck is clean. The suite before the build is 289 pass, 4 skip, 0 fail (1770 expectations); after the build, with the bundle test active, it is 290 pass, 3 skip, 0 fail (1771 expectations). The Vite build succeeds. `wallet-grep` reports 84 bundle files (83 with source maps), no approval or permit selector, and no `approve`, `permit`, `eth_sign`, `personal_sign` or `eth_requestAccounts` from our code.

## Notes

- No browser of any kind was launched. No network test was added.
- No dependency was added, and the wallet still opens only in `confirm()`.
- Only the leased files changed: `apps/web/src/lib/arc-pin.ts`, `apps/web/src/lib/purchase.ts` and the new test. Nothing under `packages/**` or `apps/hub/**`, and no CSS.
- `packages/cli/src/bin.ts` still has the pre-existing mode-only change in the worktree; it is not part of these commits.

Commits:

- `pin Arc escrow v2 beside v1 (refs #21)`
- `sign the terms the 402's escrow names (refs #21)`
- `test the buy path against both Arc pins (refs #21)`
- `record the Arc v2 pin report (refs #21)`
