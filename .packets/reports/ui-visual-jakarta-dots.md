# ui-visual-jakarta-dots

One PR for the console's typeface and a quiet dotted background. Branch
`cs/ui-visual-jakarta-dots`, created from `origin/main`.

## Diff summary

```
 apps/web/index.html             |  2 ++
 apps/web/public/fonts/README.md | 28 ++++++++++++++++++--
 apps/web/src/app/App.tsx        |  2 ++
 apps/web/src/styles/tokens.css  | 58 +++++++++++++++++++++++++++++++++++++++--
```

New files:

- `apps/web/src/components/DotField.tsx`
- `apps/web/src/components/DotField.css`
- `apps/web/test/dot-field.test.ts`
- eight font binaries and two OFL licence files under `apps/web/public/fonts/`

The only app-root change is the `DotField` import and `<DotField />` as the
first child of the shell. The landing, `apps/web/public/media/**`, the hero
branch, and every purchase, wallet and merchant path are untouched. An
unrelated pre-existing mode change on `packages/cli/src/bin.ts` was left alone
and is not staged.

## Fonts

| File | Weight | Style | Bytes | Licence |
| --- | ---: | --- | ---: | --- |
| `PlusJakartaSans-Regular.woff2` | 400 | normal | 21,884 | SIL OFL 1.1, `PlusJakartaSans-OFL.txt` |
| `PlusJakartaSans-Medium.woff2` | 500 | normal | 22,332 | SIL OFL 1.1, `PlusJakartaSans-OFL.txt` |
| `PlusJakartaSans-SemiBold.woff2` | 600 | normal | 22,216 | SIL OFL 1.1, `PlusJakartaSans-OFL.txt` |
| `PlusJakartaSans-Bold.woff2` | 700 | normal | 22,368 | SIL OFL 1.1, `PlusJakartaSans-OFL.txt` |
| `PlusJakartaSans-Italic.woff2` | 400 | italic | 23,120 | SIL OFL 1.1, `PlusJakartaSans-OFL.txt` |
| `GeistMono-Regular.woff2` | 400 | normal | 50,476 | SIL OFL 1.1, `GeistMono-OFL.txt` |
| `GeistMono-Medium.woff2` | 500 | normal | 51,512 | SIL OFL 1.1, `GeistMono-OFL.txt` |

Sources:

- **Plus Jakarta Sans** — the official static webfonts from
  `github.com/tokotype/PlusJakartaSans` (`fonts/webfonts/`), the project that
  Google Fonts distributes. Each file was cut to the Google Fonts Latin range
  (`U+0000-00FF` plus the Latin punctuation and currency ranges) with
  `pyftsubset --flavor=woff2`. The 400 and 600 weights are preloaded in
  `index.html`; every `@font-face` uses `font-display: swap`. The OFL has no
  Reserved Font Names, so the subset keeps the family name.
- **Geist Mono** — the official WOFF2 builds from the
  `vercel/geist-font` v1.9.2 release (`GeistMono/webfonts/`), copied unmodified.

`tokens.css` now holds the seven `@font-face` rules and the family tokens:

```css
--sans: "Plus Jakarta Sans", ui-sans-serif, system-ui;
--mono: "Geist Mono", ui-monospace, SFMono-Regular, Menlo;
```

All `src` URLs are root-relative `/fonts/...`; nothing points at another origin
and no font is fetched at runtime. Font sizes, component weights and layout are
unchanged: only the family tokens changed.

## How the animation is driven

`DotField.tsx` mounts one fixed canvas behind the app and runs a small frame
driver:

- **Grid** — 22 px pitch, 1.5 px round dots, 12% ink. The grid is centred on
  the viewport so the gutters stay even, and `devicePixelRatio` (capped at 2)
  sizes the backing store for crisp edges. Every frame clears and redraws the
  grid.
- **Spotlight** — a soft radial falloff with
  `radius = max(240, 0.55 * min(viewport))`. Dots reach `2 × 12% = 24%` at its
  centre and return to 12% at the edge, via smoothstep. Only dot alpha changes;
  there is no overlay gradient, glow or colour shift.
- **Pointer** — mouse movement sets the target. The spotlight eases towards it
  with an exponential time constant of 200 ms, covering about 95% of the
  distance in 600 ms. Touch and pen moves are ignored; leaving the window or
  releasing a touch hands control back to the drift.
- **Drift** — after three seconds without a mouse move (or immediately on
  touch), the target follows a slow ellipse around the centre, one loop every
  24 seconds.
- **Frame discipline** — at most one draw per 33.3 ms (30 fps). The loop stops
  scheduling while `document.visibilityState` is not `visible` and restarts on
  the visibility event. Resize handlers re-layout after a 140 ms debounce.
- **Reduced motion** — `prefers-reduced-motion: reduce` draws the grid once,
  subscribes only to resize (debounced static redraw) and never calls
  `requestAnimationFrame`. The test asserts zero frame requests.
- **Layer** — `position: fixed; inset: 0; z-index: -1; pointer-events: none`,
  with `#root { isolation: isolate }` so the field paints above the paper and
  below every app surface without giving any surface a new z-index. The canvas
  is `aria-hidden="true"` and cannot shift layout. Dot colour is the theme
  `--ink` read through `getComputedStyle`, so dark mode gets light dots and
  light mode gets dark dots at the same 12% base opacity.

## Tests

New file `apps/web/test/dot-field.test.ts`:

1. With `prefers-reduced-motion: reduce`, `mountDotField` makes zero
   `requestAnimationFrame` requests, draws the grid once, and every dot uses
   the 12% base alpha.
2. The rendered layer carries `aria-hidden="true"` and the `.dot-field` rule
   has `pointer-events: none`, `position: fixed` and `z-index: -1`.
3. Every `@font-face` in every stylesheet has `font-display: swap`, references
   a local `/fonts/*.woff2` that exists under `apps/web/public/fonts/`, and no
   `<link>` in `index.html` points at another origin. The two preloads and the
   family tokens are asserted too.

No existing test was edited, skipped or weakened.

## Acceptance output

From the worktree root:

```
$ bun install --linker hoisted && bun run typecheck && bun test apps/web && bun run web:build
bun install v1.3.14 (0d9b296a)
+ @countersign/relay@workspace:packages/relay
3 packages installed [336.00ms]
$ tsc -p tsconfig.json
bun test v1.3.14 (0d9b296a)

 318 pass
 3 skip
 0 fail
 1940 expect() calls
Ran 321 tests across 37 files. [1329.00ms]
...
✓ built in 1.27s
```

The build warning is the pre-existing `>900 kB` chunk warning for the single
app bundle; no new chunk was introduced.

### Wallet grep

`apps/web/deploy.sh` has a dry-run mode, so it was run against the working tree
with `DRY_RUN=1 ALLOW_NO_PRIVY=1`. It built the web and phone bundles, then:

```
wallet-grep: 84 bundle files (83 with source maps): no approval or permit
selector anywhere, and no approve, permit, eth_sign, personal_sign or
eth_requestAccounts from our code
staged 5.4M
DRY_RUN=1: not uploading. Stage left at .../countersign-console.HJyefN
```

The bundle still passes the wallet check.
