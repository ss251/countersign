# ui-01-seller — seller dashboard and publish wizard

## Goal

Build the two seller screens of the countersign web app, on the desktop surface (designed at 1440 px, usable down to 390 px):

- `#/seller` — the seller's dashboard: their offers, whether each one's runner is online, what each has earned, and the most recent slips.
- `#/seller/publish` — a four-step wizard that turns a `SKILL.md` into an offer and hands the seller the exact command that signs and publishes it. The seller's key never touches the browser: the runner CLI reads it from `CS_SELLER_KEY` on the seller's own machine.

## Lease

You may create or change only:

- `apps/web/src/routes/seller/**` (the route's `index.tsx` already exists as a placeholder; replace it)
- `apps/web/test/seller.test.ts`

Do not touch anything else: not `apps/web/src/ui`, `lib`, `app`, `styles` or `fixtures`, not `package.json`, and never `bun.lock`. If you need a helper or a small component, put it inside `routes/seller/`.

## Context: read these first

- `apps/web/src/routes/buyer/` and `apps/web/src/routes/slip/`: finished screens that show the conventions. Copy their patterns, not their content.
- `apps/web/src/ui/primitives.tsx`: `Amount`, `Hash`, `KV`, `Button`, `Card`, `Tag`, `RailTag`, `Empty`, `FixtureNote`, `cx`. Use these and nothing else for money, hashes, rows and buttons.
- `apps/web/src/ui/page.css`: page layout classes `page`, `page__head`, `page__eyebrow`, `page__title`, `page__lede`, `page__split`, `page__rail`, `section`, `section__title`, `section__note`, `button-row`. Import it with `import "../../ui/page.css";`.
- `apps/web/src/ui/ui.css`: `.input`, `.field`, `.field__label`, `.btn` variants. Inputs are 16 px so iOS does not zoom.
- `apps/web/src/lib/api.ts`: read data only through `api` and `useResource`. Use `api.listings()` for offers and `api.purchases()` as the stand-in for recent sales until the hub reports per-seller slips. Every result has a `source`; when it is `"fixtures"`, show `<FixtureNote show />` in the page head.
- `apps/web/src/lib/format.ts`: `formatAmount`, `formatMoney`, `usd(atomic, rail)`, `formatDuration`, `formatDateTime`, `RAIL_LABEL`, `shortHex`.
- `apps/web/src/lib/types.ts`: `Listing` (`hash`, `offer`, `seller.name`, `stats`, `status`), `Purchase`, `RailId`. The `Offer` type is in `packages/core/src/types.ts`. Read it, especially `price` (atomic, 6 decimals), `deadline` (seconds) and `rails`.
- `packages/core/src/amount.ts`: `parseUnits("0.05", 6)` gives `50000n`; it throws `AmountError` on bad input.
- `packages/runner/src/cli.ts`: the publish command and its flags: `--hub`, `--skill`, `--price` (atomic), `--deadline` (seconds), `--rails` (comma list), `--upstream-url`, `--licence`. The runner builds the offer from the `SKILL.md` front matter: `name` becomes the title and `description` becomes the summary.
- `apps/web/src/styles/tokens.css`: the colour law at the top of the file.

## What to build

### `#/seller` dashboard

```
countersign top bar (already provided by the shell)
┌─────────────────────────────────────────────────────────────────────────┐
│ Seller                                                    [Fixture data]│
│ Your offers                                     [Publish a skill]       │
│ Code, prompts and keys stay on your machine. Only the schema and the    │
│ price are published.                                                    │
├──────────────────────────────────────────────┬──────────────────────────┤
│ Offers table                                 │ Earned (side rail)       │
│ title + adapter tag   price   rails  runner  │ 0.42 USDC   0.05 USDT    │
│ use-arc  skill        0.05    Arc·escrow  ●  │ released 41  refunded 1  │
│ ...                                          │ Recent sales (5 rows)    │
└──────────────────────────────────────────────┴──────────────────────────┘
```

- A seller filter: an address field, prefilled from `?seller=0x…` when present. Matching is case-insensitive on `listing.offer.seller`. With no filter, show every offer grouped under its seller name.
- The offers table has one row per listing with: title (link to `#/offer/<hash>`), an adapter `Tag`, the price as `<Amount money={usd(offer.price, offer.rails[0])} size="sm" />`, each rail as a `RailTag`, the deadline as `formatDuration`, released and refunded counts from `stats` in tabular numerals, and the listing status. Use `listed` in ink and `delisted` in slate with the reason. A runner's online state is a word, `Online` or `Offline`, in ink or slate. It is never green: green means settled.
- Side rail: the totals released, from `api.purchases()` filtered to this seller with `status === "released"`, summed per asset symbol (`symbolFor(rail)`, USDC or USDT), each total shown with `Amount`. Below them, counts of released and refunded calls, then the five most recent sales as rows: title, `Amount`, `Status`, time, linking to `#/slip/<slipHash>` when there is one.
- Empty state for a filter that matches nothing: `Empty title="No offers from this address."` with a link to `#/seller/publish`.

### `#/seller/publish` wizard

The route is `#/seller/publish`: `params[0] === "publish"`. Four steps, one per screen. A step indicator at the top reads `1 Skill · 2 Terms · 3 Check · 4 Publish` with the current step in ink and the others in slate. This is a real sequence, so numbers are right here.

1. **Skill**. A textarea, mono, at least 14 rows, for pasting a `SKILL.md`, and an `Open a file` button that loads a `.md` file into it. Parse the YAML front matter between the first two `---` lines and read `name` and `description`, with surrounding quotes stripped. Show the parsed title and summary under the field as they will appear on the offer. Errors, word for word: `This file has no front matter. A SKILL.md starts with --- and a name.` and `The front matter needs a name.`
2. **Terms**:
   - Price, a decimal field whose suffix depends on the rail: `USDT` when `whitechain` is the first rail, otherwise `USDC`. Convert with `parseUnits(value, 6)`; on `AmountError` show `Enter a price like 0.05, with at most 6 decimals.` A zero price is refused with `The price must be above zero.`
   - Deadline in seconds, default `120`, range 10 to 604800, with the error `The deadline must be between 10 seconds and 7 days.`
   - Rails, as checkboxes in this order: `escrow`, `gateway`, `eip3009`, `whitechain`, `hedera`, `erc8183`, labelled with `RAIL_LABEL`. At least one is required, with the error `Pick at least one rail.` The first ticked rail is the preferred one.
   - Upstream URL and licence, both optional.
3. **Check**. A review card laid out like the slip's seam. The left half, titled `What buyers see`, shows the title, summary, the price as an `Amount`, the deadline and the rails. The right half, titled `What stays with you`, shows the skill body (first 12 lines, mono, slate), the key and the runner. Below the card, the offer as the runner will publish it, pretty-printed in a mono block: `v`, `title`, `summary`, `adapter: "skill"`, `price` (atomic string), `deadline`, `rails`, `upstream`. Put `<your address>` where the seller field goes and leave `issuedAt` out. Under the block one line: `The runner fills in your address and the time, then signs. The offer hash covers every field, so any change, the price included, is a new offer.`
4. **Publish**. Two copyable command blocks, each with a copy button (`CopyButton` from primitives):
   - `bun packages/runner/src/cli.ts publish --hub <hub> --skill ./SKILL.md --price <atomic> --deadline <s> --rails <list>` plus `--upstream-url <u> --licence <l>` when those are set. Single-quote any value that contains a space.
   - The same command with `serve` in place of `publish`, under the heading `Then keep it online`.
   - `<hub>` is `window.location.origin` while the hub is not known. Above the blocks: `Your key stays on your machine. The runner reads it from CS_SELLER_KEY and never prints it.` Never render an input for a key, and never put a key or a placeholder key value in any command.
   - A `Done` button returns to `#/seller`.

Back and Next buttons on every step. Next is disabled while the step has an error. State lives in the component; reloading starts over.

## Constraints

- Brand: the name is always `countersign`, lowercase. Vocabulary: offer, countersignature, escrow, slip, release, refund, toll, envelope, adapter, rail, runner, registry. Don't invent other product nouns.
- Colour law: blue (`Amount`) only for money. Green only for settled or released, which here means the `Status` component. Red only for refused or countersigned, which here means validation errors. Links and focus are ink.
- Type: the platform sans everywhere, with `.num` for counts and prices. `.mono` only for hashes, addresses, atomic amounts, JSON and commands.
- Tone: declarative and short. No exclamation marks, and nothing like "revolutionary" or "seamless". Errors say what is wrong and how to fix it.
- No gradients, glow, shadows or glassmorphism. Hairline borders use `var(--line)`.
- No new dependencies. React 19, TypeScript strict. No `any`.
- Accessibility: every input has a `<label>`, errors are tied with `aria-describedby`, buttons are real `<button>` elements, and focus moves to the step heading on each step change.
- Do not read any directory outside this repository.

## Acceptance

Run from the worktree root:

```
bun install
bun run typecheck
bun test apps/web/test
cd apps/web && bunx --bun vite build
```

All four must pass. `apps/web/test/seller.test.ts` must cover, with pure functions exported from `routes/seller/`:

- front matter parsing: a valid file, a missing front matter block, a missing name, and quoted values;
- price conversion `"0.05"` to `"50000"`, plus the refusals for `"0"`, `"abc"` and `"0.0000001"`;
- the publish command string for a case with upstream, licence and two rails, including quoting a licence that contains a space.

Commit on your branch with small present-tense messages, no emoji. Do not commit `bun.lock`. Write a report to `/Users/thescoho/Developer/countersign-mumbai/reports/ui-01-seller.md` covering what you built, the acceptance output, and anything left undone.

## Stop conditions

- If an acceptance command fails for a reason outside your lease, such as a type error in another file or a missing package, stop and write it in the report. Don't fix it.
- If the packet contradicts itself, follow the Constraints and note the conflict in the report.
- Stop after the acceptance commands pass and the report is written. Do not start other screens.
