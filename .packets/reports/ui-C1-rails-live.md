# ui-C1-rails-live — report

Date: 2026-11-07
Branch: `cs/ui-C1`

## Landed

- `apps/web/src/routes/registry/rails.ts` adds `railGroups(offerRails, hubRailIds)`. Undefined hub rails mean unknown and return `null`; otherwise the offer rails keep their order, without duplicates, split into `live` (declared by the hub) and `listed` (named only in offers).
- The Registry reads the hub's `/rails` through `useResource(() => api.rails(), [])` and takes ids only when `source === "hub"`. The rail row is now the exported `RailFilters` component in `registry/index.tsx`: unchanged flat row when the hub's rails are unknown, otherwise `Live (n)` and, when non-empty, `Listed only (m)` over the same toggles, labels and `aria-pressed`. No CSS changed.
- `Figures` in `apps/web/src/routes/home/Evidence.tsx` is exported. Nothing else in that file changed; it still renders `N rail(s) live` from the hub's `/rails` length.
- `apps/web/test/rails-live.test.ts` covers the grouping (three live, two listed, unknown, empty hub, duplicates), the hero number for 1, 3 and 5 declarations and the absence of "live" without rails, and the Registry's two labels and all five toggle names, plus the ungrouped row.

## Verification

From the worktree root:

```
bun install --linker hoisted
bun run typecheck
bun test apps/web/test          # 238 pass, 3 skip, 0 fail
(cd apps/web && bunx --bun vite build)
```

The 3 skips are the pre-existing Arc RPC suite, gated behind `CS_LIVE=1`.

## Notes

- `packages/cli/src/bin.ts` was already modified in the worktree before this packet and is not part of these commits.
- No browser was launched. No dependencies added.

## C1b: live is every hub rail

- `railGroups` builds `live` from every id in the hub's `/rails`, in the hub's order and once each, whether or not an offer names it. `listed` is the offer rails outside that set, in offer order, once each. Hub ids that are not keys of `RAIL_LABEL` are dropped, so the `RailId[]` cast is safe.
- `RailFilters` needed no markup change: a live rail with no offers still renders its toggle, with count `0`.
- The tests add hub rails no offer names, an unknown hub id, the hero/Registry agreement for 1 and 3 hub rails, and `Live (3)` with no `Listed only` for a rail-less offer set. The full suite is 242 pass, 4 skip, 0 fail; the build passes.
