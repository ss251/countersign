# ui-K5-get-started — report

## What shipped

`/get-started` is a desk screen that renders the three K4 quickstarts, copied verbatim from the onboarding guide's own markers.

- `apps/web/src/routes/get-started/blocks.ts` (new) — the pure parser and inline splitter:
  - `section(markdown, id)` returns `null` when the guide is missing, either marker is missing, the closing marker precedes the opening one, or a code fence is never closed. Otherwise it reads the text between the markers line by line: fenced code (language trimmed, `text` when empty, body joined with `\n`), list items, skipped headings and HTML comments, blank-line paragraph breaks, and paragraph lines joined with one space.
  - `inline(text)` splits code spans and `http://` / `https://` links only. Any other link keeps its label as plain text. It never produces HTML.
- `apps/web/src/routes/get-started/View.tsx` (new) — `GetStartedView` with the page head (`Get started.`), three `gs` sections in the fixed order (`Hire a tool`, `List your server`, `Charge for your API`), each with its own `data-testid` and `aria-labelledby`. Paragraphs and grouped list items run through `inline()`; code blocks use the assistant's `command` / `command__head` / `command__body mono` markup with the existing `CopyButton`, labelled `title + " " + lang`. A `null` section renders the exact pending line. The foot links the real guide on GitHub.
- `apps/web/src/routes/get-started/doc.ts` (new) — the only Vite read of `docs/onboarding.md`, through `import.meta.glob` with `?raw` and eager import. No match yields `null`, never a build error.
- `apps/web/src/routes/get-started/index.tsx` (new) — the route, `surface = "desk"`, rendering `ONBOARDING`.
- `apps/web/src/routes/get-started/get-started.css` (new) — token-only: hairline-ruled sections at `--sp-8` vertical padding, the start page's title scale, `--ink` text and lists at 68ch, `--slate` pending and foot lines at `--t-13`. No colour beyond tokens, no gradients, no cards.
- `apps/web/src/routes/home/Evidence.tsx` — one added line inside `landing__cta`, right after `Ask for a paid tool`: `<Link to="/get-started" className="landing__go">Get started</Link>`. Nothing else changed in the file.
- `apps/web/test/get-started.test.ts` (new) — parser, inline, full-screen and no-guide coverage, plus the real-guide marker check gated on the file's presence.

No file outside the lease was touched. No `docs/**`, `README.md`, `packages/**`, `apps/hub/**`, `App.tsx` or `routes.ts` changes. No new dependencies, no `any`, no `dangerouslySetInnerHTML`, no browser.

## Guide presence

`docs/onboarding.md` is absent in this worktree, which is the case the acceptance build ran against: the glob matches nothing, `ONBOARDING` is `null`, and the screen shows all three pending lines. The Vite build passes in that state. The with-guide case could not be run because the file may not be created here; the parser and view are tested against an in-test fixture that carries all three markers.

## Verification

From the worktree root, exactly the acceptance chain:

```
bun install --linker hoisted
bun run typecheck
bun test apps/web/test
(cd apps/web && bunx --bun vite build)
```

Output:

```
bun install: 3 packages installed [218.00ms]
tsc -p tsconfig.json: exit 0

239 pass
4 skip
0 fail
1648 expect() calls
Ran 243 tests across 29 files.

vite v8.3.6: 8615 modules transformed, built in 1.41s
```

The 4 skips are the three pre-existing `onchain.live.test.ts` cases gated on `CS_LIVE=1`, and the new real-guide marker test, skipped because `docs/onboarding.md` does not exist. The Vite build prints the usual pre-existing `node:worker_threads` externalization note from viem's bundled `ox` chain data and the existing large-chunk warning; neither fails the build.

## Needs browser

No browser of any kind was launched. Lane: **NEEDS-BROWSER** for `/get-started` and the new landing CTA: the ruled section rhythm, long command blocks scrolling sideways, pending states with a guide absent, and the foot link.

No push, merge or deploy.
