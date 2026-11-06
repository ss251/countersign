# ui-r2-C3-offer-live-rails report

Date: 2026-11-07
Branch: `cs/ui-r2-C3` (cut from `cs/int`)

## What was built

`apps/web/src/lib/live.ts` is new and pure. It exports the decided wording and the split:

```ts
export const NOT_LIVE = "listed, not live on this hub";
export function liveSplit(offerRails: RailId[], hubRailIds: readonly string[] | undefined): { live: RailId[]; listed: RailId[] } | null;
```

`undefined` hub rails return `null`, so no claim is made. Otherwise `live` is the offer's rails
that the hub serves, in the offer's order and once each; `listed` is the rest, also once each.

- **Offer page** (`routes/offer/index.tsx`): the headline rails line is now the exported
  `OfferRailLine`. With a split it reads `Settles on {live labels}` or
  `Settles on no rail live on this hub`, followed by a second `offer__rails` paragraph,
  `{listed labels}: listed, not live on this hub`, only when something is listed. With no split it
  renders the previous single line unchanged. The per-rail fallback now reads
  `{RAIL_LABEL[r]}: listed, not live on this hub.`
- **Registry** (`routes/registry/index.tsx`): the offer row's rails line is the exported
  `OfferRowRails`. With a split it shows the live labels and, when any, `· {listed labels}:
  listed, not live on this hub`; with no split it is unchanged. `RegistryPage` passes its existing
  `hubRailIds` into `SellerCard`, whose new prop is optional so existing callers still typecheck.
- **Assistant** (`routes/assistant/Assistant.tsx`): `PurchaseCard` reuses its `api.rails()` read.
  The shown rail is `wallet ? "escrow" : (split?.live[0] ?? offer.rails[0]!)`. When the split
  exists and `live` is empty, the `<dd>` reads
  `{RAIL_LABEL[offer.rails[0]!]}, listed, not live on this hub`. Nothing else in the card changed.

Hub rail ids are used only when `source === "hub"` and data is present, matching `hubRails` in
`routes/registry/index.tsx`.

## Tests

`apps/web/test/offer-live-rails.test.ts` is new, with no browser and no network:

- `liveSplit` covers the packet's example, `undefined` to `null`, duplicates once in offer order,
  an empty hub putting everything in `listed`, and a hub rail the offer does not name;
- `NOT_LIVE` is exactly `listed, not live on this hub`;
- rendered copy for `OfferRailLine` and `OfferRowRails`: live labels plus the suffix, no suffix
  when every rail is live, the old single line without a split, and the offer page's no-live line;
- a `Bun.Glob("**/*.{ts,tsx}")` scan of `apps/web/src` finds no remaining
  `not declared by this hub`.

No existing test asserted the old wording, so none was edited.

## Verification

From the worktree root:

```
bun install --linker hoisted
bun run typecheck
bun test apps/web/test          # 280 pass, 4 skip, 0 fail, 284 tests across 33 files
(cd apps/web && bunx --bun vite build)
bun apps/web/scripts/wallet-grep.ts apps/web/dist
```

The 4 skips are pre-existing (the Arc RPC suite gated behind `CS_LIVE=1`). The build reports only
the existing large-chunk warning. `wallet-grep` checked 84 bundle files and found no approval or
permit selector and no `approve`, `permit`, `eth_sign`, `personal_sign` or `eth_requestAccounts`
from our code.

## Notes

- `packages/cli/src/bin.ts` was already modified in the worktree before this packet and is not part
  of these commits.
- No browser was launched, no dependency was added, no CSS changed, and no wallet signature was
  made. Nothing outside the lease was edited. No push, merge or deploy; `git stash` was not used.
