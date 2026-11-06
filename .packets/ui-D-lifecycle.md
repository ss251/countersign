# ui-D-lifecycle: the landing follows one real payment through its four steps, from the hub's own records (refs #21, STEER-2058 fix 4)

## Setup

Run `bun install` at the worktree root before anything else. You are on `cs/ui-D`, cut from `origin/main`.

## The captain's words

"A four-step animated sequence: offer published, buyer countersigns, funds held, seller signs and the slip verifies, driven by real hashes and names from the hub, not lorem ipsum." It honours reduced motion. When the hub is unreachable the beat says so, and it never falls back to fixtures.

## Read first

- `apps/web/src/routes/home/Clears.tsx`. Copy its stage pattern exactly:
  - `useBeat`/`toBeat`/`span` from `./stage.ts`;
  - a pinned section with `--span`;
  - a static section per beat when `pinned` is false;
  - `story__line` statements that crossfade with `is-on`;
  - an exit beat;
  - `bring()` for keyboard focus.
- `apps/web/src/routes/home/landing.css`: the `story__*` classes. Reuse them.

## The design is decided (cs-ui)

### 1. Where it goes

- **New `apps/web/src/routes/home/Lifecycle.tsx`,** exporting `LifecycleStage`.
- **In `apps/web/src/routes/home/index.tsx`,** render it between `<ClearsStage …/>` and `<Proof …/>` as `<LifecycleStage release={newestRelease(rows)} rails={hubRails} hubDown={missing !== undefined} pinned={pinned} narrow={narrow} />`. Change nothing else in that file.

### 2. The data: one real escrow payment, read from the hub

- **`release`** is the newest settlement of kind `released`, the same one stage two shows. Its fields are `jobId`, `offerHash`, `slipHash`, `tx`, `buyer`, `seller`, `amount`, `rail`, `network` and `at`. Add `buyer?: string` to `Settlement` in `apps/web/src/lib/types.ts`; the hub already sends it.
- **Inside the stage,** read with the existing `api` functions through `useResource`:
  - `api.listing(release.offerHash)` gives the offer's `title`, `seller` and `issuedAt`, plus the seller's name;
  - `api.slip(release.slipHash)` gives the slip.
- **Then verify the slip in the browser** with `verifySlip(slip)` from `apps/web/src/lib/verify.ts`, exactly as the verify page calls it. Its result decides step 4's word.
- **The escrow address** is `rails.find((r) => r.id === "escrow")?.escrow`, linked to `https://testnet.arcscan.app/address/<escrow>`.
- **Never a fixture.** If a read's `source` is not `"hub"`, treat it as absent.

### 3. The beats

Weights are `[1, 1, 1, 1, 0.3]`; beat 4 is the exit, where the evidence fades and the last statement stays. One statement per beat, using these exact words:

0. **`An offer is published.`**
   - Offer: the title.
   - Seller: the seller's name, or the short address.
   - Offer hash: `Hash`.
   - Published: the local date and time of `issuedAt`.
1. **`A buyer countersigns it.`**
   - Buyer: the short `release.buyer`, or `slip.body.buyer`.
   - Amount: `Amount` with `flight`, since money is in flight.
   - Job: `Hash` of `jobId`.
2. **`The money is held until the work lands.`**
   - Escrow: `Hash` of the escrow address, linked.
   - Job: `Hash`.
   - The quiet line `Held on Arc testnet by the escrow contract until the output checks out.`
3. **`The seller signs, and the slip verifies.`**
   - Slip: `Hash` of `slipHash`.
   - Release: `Hash` of `release.tx`, linked to `https://testnet.arcscan.app/tx/<tx>`.
   - Check: `<span className="status status--released">Verified in this browser</span>` when `verifySlip` passes every check. Otherwise `Not verified:` plus the first failing check's text, in slate. While it runs: `Checking…`.
   - A link `Check it without us` to `/verify/<slipHash>`.

### 4. The evidence: four steps lighting up in order

Under the statement sits `<ol className="life">` with four `<li className="life__step">`. Each step holds:

- a number `01` to `04` (`life__n`, mono);
- a label (`life__label`): `Published`, `Countersigned`, `Held`, `Verified`;
- that step's lines (`story__lines` with `story__lines--two`).

State per beat:

- the current beat's step is `is-on`: ink, full opacity;
- earlier steps are `is-done`: ink, full opacity, their number followed by `✓`;
- later steps are `is-next`: slate, opacity 0.35;
- in the exit beat, all four steps are opacity 0.

At 1440 (min-width 721px) the steps are four equal columns, `grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--sp-6);`. At 390 they stack in one column, and only the current step shows its lines; the others show only number and label.

Motion is transform and opacity only:

- a step turning on rises 8 px over 240 ms with `var(--ease-out)`;
- the four steps are separated by one hairline rail (`border-top: var(--hair) solid var(--line)`) above the row.

Add the styles to `landing.css` under the comment `/* The life of one payment: four steps from the hub's own records (STEER-2058). */`, using tokens only. Nothing under 14 px at 1440.

### 5. When there is nothing real to follow

The stage still pins as one beat, with one statement and no steps:

- **The hub did not answer** (`hubDown`): `The hub did not answer, so there is no live payment to follow right now.`
- **No escrow release yet:** `No escrow payment has cleared on this hub yet. The first one shows here, step by step.`

Never fixtures, never sample hashes.

### 6. Reduced motion

`pinned` is false, so the four beats render as static sections, each with its statement and the steps in that beat's state. The exit beat is not a section, nothing is placed by transform, and nothing animates.

## Lease

You may create or change only:

- `apps/web/src/routes/home/Lifecycle.tsx` (new);
- `apps/web/src/routes/home/index.tsx` (the one render line);
- `apps/web/src/routes/home/landing.css` (appended styles);
- `apps/web/src/lib/types.ts` (`Settlement.buyer?` only);
- `apps/web/test/lifecycle.test.ts` (new);
- `.packets/reports/ui-D-lifecycle.md`.

## Tests (`apps/web/test/lifecycle.test.ts`)

No network and no browser. Server-render `LifecycleStage` with `react-dom/server`'s `renderToString` from `apps/web/node_modules`. Read `apps/web/test/landing.test.ts` for the settlement shape. Test:

1. With a release and `pinned: true`, the HTML holds all four statements in order and four `life__step` items.
2. With `hubDown: true`, the HTML holds `The hub did not answer` and no `life__step`.
3. With no release and the hub up, it holds `No escrow payment has cleared on this hub yet`.
4. With `pinned: false`, there are four static sections and no exit section.

Every existing test passes.

## Constraints

- **Never launch a browser of any kind on this machine:** no Chrome or Chromium, headless or not, no Playwright, Puppeteer or screenshot tools. UI checks go back to the lane, which raises NEEDS-BROWSER.
- No new dependencies. TypeScript strict, no `any`. Do not touch `Evidence.tsx`, `Clears.tsx`, `field.ts` or `stage.ts`.
- Colour as meaning only: green only for `Verified`, and blue only on the in-flight amount and the tx link. No gradients or glass.

## Acceptance

From the worktree root:

```
bun install && bun run typecheck && bun test apps/web/test && (cd apps/web && bunx --bun vite build)
```

Every command passes.

## Stop conditions

- You need to edit outside the lease: stop and write the report.
- One problem has blocked you for more than 15 minutes: stop, commit what passes, and write the report.

## Finish

Commit with small present-tense messages ending `(refs #21)`, and no trailers. Write `.packets/reports/ui-D-lifecycle.md`. Do not push, merge or deploy.
