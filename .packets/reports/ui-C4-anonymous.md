# ui-C4-anonymous report

## What was built

Sellers may stay anonymous; the console now says so instead of calling the absence of a name a
fault. `apps/web/src/lib/format.ts` gains the one constant:

```ts
/** What the console says for a seller with no name: anonymity is the policy, not a fault. */
export const ANONYMOUS = "anonymous by design";
```

The four places the packet names now use it, with the address left beside it:

- `apps/web/src/routes/registry/index.tsx`, `SellerCard` (now exported): an unnamed group's name is
  `ANONYMOUS`, and the `Hash` of its address stays in the same `<header>`. The `is-unnamed` class is
  unchanged.
- `apps/web/src/routes/offer/index.tsx`: the byline's seller part moved into an exported
  `OfferBy({ seller })` in the same file, which renders
  `By <span class="offer__seller">{name}</span>` plus `, anonymous by design` when
  `named === false`. The agent and address parts of `<p class="offer__by">` are untouched.
- `apps/web/src/routes/buyer/Approvals.tsx`, pass card: an unnamed seller reads
  `anonymous by design`, with the payee `Hash` still under it.
- `apps/web/src/routes/buyer/Approvals.tsx`, dock line: reads
  `to {name}, anonymous by design` for an unnamed seller.

No CSS, layout, other copy, dependency or package outside the lease was touched. The pre-existing
modification to `packages/cli/src/bin.ts` was left alone and is not part of these commits.

## Tests

`apps/web/test/anonymous-seller.test.ts` (new, 6 tests) runs with no browser and no network:

- the constant is exactly `anonymous by design`;
- `SellerCard` renders it with the address inside the same `<header>` for `named: false`, and
  renders a named seller's `acme` with no anonymity wording;
- `OfferBy` reads `By 0x1234…abcd, anonymous by design` after tags are stripped, and `By acme` with
  no `anonymous` for a named seller;
- a `Bun.Glob("**/*.{ts,tsx}")` scan of `apps/web/src` through `Bun.file` finds neither
  `Unnamed seller` nor `an unnamed seller`; `routes/assistant/Assistant.tsx` is skipped as out of
  scope.

All existing tests pass.

## Acceptance output

```
$ bun install --linker hoisted
bun install v1.3.14 (0d9b296a)

Checked 1031 installs across 774 packages (no changes) [229.00ms]

$ bun run typecheck
$ tsc -p tsconfig.json
(no output; exit 0)

$ bun test apps/web/test
bun test v1.3.14 (0d9b296a)

 234 pass
 3 skip
 0 fail
 1597 expect() calls
Ran 237 tests across 29 files. [1203.00ms]

$ (cd apps/web && bunx --bun vite build)
vite v8.3.6 building client environment for production...
✓ 8610 modules transformed.
✓ built in 1.16s
(only the existing chunk-size warning)
```

## Not done

No browser of any kind was launched, as required. Nothing outside the lease was edited, no push,
merge or deploy was made, and `git stash` was not used.
