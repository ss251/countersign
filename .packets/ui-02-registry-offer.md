# ui-02-registry-offer — the registry and the offer page

## Goal

Build two discovery screens of the countersign web app on the desktop surface. They are designed at 1440 px and must stay usable at 390 px.

- `#/registry` lists every offer the hub knows. People can filter it and scan it, and each row opens its offer.
- `#/offer/<offerHash>` is one offer in full: what it does, what it costs, which rails it accepts, the exact input and output schemas, and how an agent buys it.

Both read live data from the hub when one is chosen, and fixtures otherwise. The data layer already handles that.

## Lease

You may create or change only:

- `apps/web/src/routes/registry/**` (`index.tsx` exists as a placeholder; replace it)
- `apps/web/src/routes/offer/**` (same)
- `apps/web/test/registry.test.ts`

Do not touch anything else. That includes `apps/web/src/ui`, `lib`, `app`, `styles` and `fixtures`, `package.json`, and never `bun.lock`. Put any helper or small component inside your route folders.

## Context: read these first

- `apps/web/src/routes/slip/index.tsx` and `apps/web/src/routes/verify/index.tsx`: finished desktop pages. Follow their layout, imports and conventions.
- `apps/web/src/ui/primitives.tsx`: `Amount`, `Hash`, `KV`, `Button`, `Card`, `Tag`, `RailTag`, `Empty`, `FixtureNote`, `CopyButton` and `cx`. Use these for money, hashes, rows and buttons.
- `apps/web/src/ui/RailCard.tsx`: shows a `RailDeclaration` (kind, network, asset, escrow, gas, finality). Use it for each rail the offer accepts.
- `apps/web/src/ui/page.css`: `page`, `page__head`, `page__eyebrow`, `page__title`, `page__lede`, `page__split`, `page__rail`, `section`, `section__title`, `section__note`, `button-row`.
- `apps/web/src/ui/ui.css`: `.input`, `.field`, `.field__label`.
- `apps/web/src/lib/api.ts`: read only through `api` and `useResource(load, deps)`.
  - `api.listings()` gives every listing.
  - `api.listing(hash)` gives one listing, or `undefined` for an unknown hash.
  - `api.rails()` gives the `RailDeclaration[]` the hub serves.
  - `api.purchases()` gives fixtures only, the stand-in for recent calls.

  Every result has a `source` of `"hub"` or `"fixtures"`. Show `<FixtureNote show />` in the page head when it is `"fixtures"`. A `useResource` result can carry `error`: a chosen hub that did not answer. Show it as a plain message, for example `The hub did not answer. Check it is running, or open the registry without ?hub to see fixtures.`, and never fall back silently.
- `apps/web/src/lib/types.ts`: `Listing`. Its fields are `hash`, `offer`, `seller.name`, an optional `stats`, `status` and an optional `online`. `Offer` is in `packages/core/src/types.ts`: `title`, `summary` (can be 2,000 characters long), `adapter`, `upstream?`, `input`, `output`, `price` (atomic, 6 decimals), `deadline` (seconds), `bond`, `rails` and `issuedAt` (unix seconds).
- `apps/web/src/lib/format.ts`: `usd(atomic, rail)`, `formatAmount`, `formatDuration`, `formatDateTime`, `RAIL_LABEL`, `shortHex` and `networkName`.
- `apps/web/src/styles/tokens.css`: read the colour law at the top.

## What to build

### `#/registry`

```
┌ page head ─────────────────────────────────────────────────────────────┐
│ Registry                                                [Fixture data]  │
│ Software that sells itself.                                              │
│ Every offer here is a price and two schemas. The code, prompts and keys │
│ stay with the seller.                                                    │
├─────────────────────────────────────────────────────────────────────────┤
│ [Search offers……]   Adapter: All Skill MCP OpenAPI   Rail: [All ▾]       │
│ 9 offers · 7 online                                                      │
├─────────────────────────────────────────────────────────────────────────┤
│ use-arc  [skill]                                    0.01 USDC            │
│ Build on Arc: chain facts, USDC as gas… (2 lines max)                   │
│ Arc · escrow  Arc · Gateway   ·  0x6BE9…ca4a  ·  Online  ·  41 released │
├─────────────────────────────────────────────────────────────────────────┤
│ …                                                                        │
└─────────────────────────────────────────────────────────────────────────┘
```

- One row per listing, and each row is a single link to `#/offer/<hash>`. The row shows:
  - the title, weight 600, with an adapter `Tag`;
  - the summary clamped to two lines with `-webkit-line-clamp: 2` and `overflow: hidden`;
  - the price at the right as `<Amount money={usd(offer.price, offer.rails[0])} size="md" />`;
  - one `RailTag` per rail;
  - the seller name;
  - `Online` or `Offline` as a word in ink or slate, never green;
  - `stats.released` with the word `released` when `stats` is present.
- Delisted listings sort last. Their title is slate and the row says `Delisted`, plus `reason` when present.
- Search matches title and summary, case-insensitively. The adapter filter is a segmented row of buttons using `aria-pressed`. The rail filter is a `<select>` labelled `Rail`.
- The count line reads `9 offers · 7 online` in tabular numerals and reflects the filters.
- No match: `Empty title="No offer matches."` with a `Clear filters` button.

### `#/offer/<offerHash>`

- Head: the eyebrow `Offer`, the title as `page__title`, the adapter `Tag`, then the full summary as `page__lede`. Under it, when `upstream` is set: `From <a href={upstream.url}>{host and path, trimmed}</a> · {upstream.licence}`.
- `page__split` layout.
  - **Main column**, in sections:
    1. `Price and terms`: a `KV` with the price as an `Amount`, the deadline (`formatDuration`, then `, then anyone can refund`), the bond as an `Amount`, the offer hash as a full `Hash`, the seller as a `Hash`, and `Published` via `formatDateTime(offer.issuedAt)`.
    2. `Rails it accepts`: one `RailCard` per rail in `offer.rails`, in order, each matched by `id` against `api.rails()`. A rail the hub does not declare shows `Not declared by this hub.`
    3. `Input` and `Output`: each schema pretty-printed with `JSON.stringify(schema, null, 2)` in a mono block (`var(--sunk)` background, 1 px `var(--line)` border, radius `var(--r-2)`, 13 px, `overflow: auto`, max height 360 px). Above each, a one-line summary of the required fields, e.g. `Needs task (string).`
  - **Side rail** (`page__rail`):
    1. `How an agent buys it`: three numbered steps, a real sequence:
       - `POST /offers/<short hash>/call with the input.`
       - `The hub answers 402 with the price. The agent's envelope checks it, then the agent countersigns the offer hash and the amount.`
       - `The call is paid into escrow, runs on the seller's machine, and returns the output with a slip.`

       Below the steps, a copyable command (`CopyButton`), in mono: `bun packages/buyer/src/cli.ts buy <offerHash> --input '<example json>' --hub <hub>`. The example JSON gives every required input property a placeholder (`"…"` for strings). `<hub>` is `window.location.origin`. Under it one line: `The agent's key comes from CS_BUYER_KEY and never appears in a command.`
    2. `Record`: `stats.released` released and `stats.refunded` refunded when present, otherwise `No calls yet.` Then `Online` or `Offline`.
- Unknown hash: `Empty title="No offer with that hash."` with a link to `#/registry`.

## Constraints

- Brand: always `countersign`, lowercase. Vocabulary: offer, countersignature, escrow, slip, release, refund, toll, envelope, adapter, rail, runner, registry. No other product nouns.
- Colour law: blue (`Amount`) only for money. Green only for settled or released, so a runner being online is not green. Red only for refused or countersigned. Links and focus are ink.
- Type: the platform sans everywhere, with `.num` for counts and prices. `.mono` only for hashes, addresses, atomic amounts, JSON and commands.
- Tone: declarative and short. No exclamation marks, and no "seamless", "revolutionary" or "powerful".
- No gradients, glow, shadows or glassmorphism. Borders are `1px solid var(--line)`.
- No new dependencies. React 19, TypeScript strict, no `any`.
- Accessibility: labelled controls, `aria-pressed` on the adapter buttons, one link per registry row (not nested links), and focus styles from the base CSS.
- **No browser of any kind on this machine**: no Chrome or Chromium (headless or not), no Playwright, no Puppeteer, no screenshot tools. This is the project lead's standing rule. Check your work with typecheck, tests and the build. UI checks go back to the lane (cs-ui), which raises NEEDS-BROWSER.
- Do not start a dev server or any long-running process. Do not read any directory outside this repository.

## Acceptance

From the worktree root:

```
bun install
bun run typecheck
bun test apps/web/test
cd apps/web && bunx --bun vite build
```

All four must pass. `apps/web/test/registry.test.ts` must test pure functions exported from your route folders:

- filtering by search text, adapter and rail, including no matches;
- sorting with delisted listings last;
- the example-input builder for a schema with two required string fields and one optional field;
- the buy command string.

Commit on your branch with small present-tense messages and no emoji. Do not commit `bun.lock`. Write a report to `$M/reports/ui-02-registry-offer.md` covering what you built, the acceptance output, and anything left undone.

`$M` is the fleet directory named in your brief.

## Stop conditions

- If an acceptance command fails for a reason outside your lease, stop and write it in the report. Don't fix it.
- If the packet contradicts itself, follow Constraints and note it in the report.
- Stop once acceptance passes and the report is written.
