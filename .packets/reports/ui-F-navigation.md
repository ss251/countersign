# ui-F-navigation report

## What was built

- `apps/web/src/app/SiteLinks.tsx`: renders `VIEWS` in order with `Link`, marks the current view with `aria-current="page"`, then the GitHub link (`target="_blank" rel="noreferrer"`). `GitHubLink` is exported both alone and as `SiteLinks.GitHub`.
- `apps/web/src/app/SiteFooter.tsx`: the one-sentence footer, in the exact markup `footer.site-foot > p.site-foot__what`.
- `apps/web/src/app/nav.css`: the current-section marker (ink text and a 2 px ink underline, no blue), the landing's narrow-bar toggle and sheet, and the footer rules.
- `apps/web/src/app/App.tsx`: imports `nav.css`, adds `<SiteLinks.GitHub className="topbar__link" />` as the last item inside `topbar__nav`, and renders `<SiteFooter />` after `</main>` for every surface.
- `apps/web/src/routes/home/index.tsx`: only the header changed. `LandingBar` renders the wordmark, the shared `SiteLinks` inline, and a `Views` toggle at `max-width: 720px`. The toggle opens `#landing-views` under the bar, closes on Escape and on a link click, and the inline links return at 721 px and wider.
- `.site-foot` keeps the paper it lands on. On the default-dark landing, a scoped rule gives the footer the same `--slate` and `--line` as the landing's dark tokens so the sentence stays legible.

No file outside the lease was touched. No browser was launched.

## Tests

`apps/web/test/nav.test.ts` server-renders both components with `react-dom/server` from `apps/web/node_modules`.

Bun cannot evaluate Vite's `import.meta.glob` in `routes.ts`, so the test reads the real `ALL_VIEWS` labels from the source file, mock-loads them as `VIEWS`, and pins the router's `useLocation` to `/registry` because React's server snapshot of `useSyncExternalStore` is always `/`. It then asserts the rendered order (all six views, then GitHub), that only Registry carries `aria-current="page"`, the GitHub `target`/`rel`, and the footer's exact sentence.

## Acceptance output

```
$ bun run typecheck
$ tsc -p tsconfig.json
(no output; exit 0)

$ bun test apps/web/test
 144 pass
 3 skip
 0 fail
 724 expect() calls
Ran 147 tests across 11 files. [1198.00ms]

$ (cd apps/web && bunx --bun vite build)
✓ 1549 modules transformed.
✓ built in 1.21s
```

## Not done

Nothing in the packet was left undone. No push, merge or deploy. Visual checks (the landing sheet at 390 px, the marker on each bar) still belong to the lane, since this machine must not launch a browser.
