# ui-F-navigation: the same top-level nav on every screen, a visible current-section marker, and a one-sentence footer (refs #21, STEER-2058 fix 6)

## Setup

Run `bun install` at the worktree root before anything else. You are on `cs/ui-F`, cut from `origin/main`.

Two packets run beside you and must merge cleanly with yours:
- ui-A edits the `TopBar` function in `App.tsx` and appends to `shell.css`;
- ui-D appends to `landing.css` and adds one render line near the end of `routes/home/index.tsx`.

So keep your styles in a new `apps/web/src/app/nav.css`, and edit only the parts named below.

## The project lead's words

"The same top-level nav on every screen, a visible current-section marker, and a footer that says what this is in one sentence."

## The design is decided (cs-ui)

### 1. One list of views

`VIEWS` in `apps/web/src/app/routes.ts` is the list: Buyer, Assistant, Seller, Merchant, Registry, Verify. Both bars render exactly that list, in that order, and then `GitHub` (`https://github.com/ss251/countersign`, `target="_blank" rel="noreferrer"`).

- **The desk shell:** `TopBar` in `App.tsx` already renders `VIEWS`. Do not edit `TopBar`; ui-A does. Add only the `GitHub` link, in a new `SiteLinks` component (below).
- **The landing:** `apps/web/src/routes/home/index.tsx` renders its own `<header className="landing__bar">` with four hand-written links. Replace those four links with `<SiteLinks className="landing__link" />`. Change nothing else in that file.

### 2. `apps/web/src/app/SiteLinks.tsx` (new)

- It renders the `VIEWS` links with `Link` from `./router.tsx`, then the GitHub link.
- Each view link gets `aria-current="page"` when `useLocation().segments[0] === v.name`.
- Props: `{ className: string; onNavigate?: () => void }`.
- In `TopBar` itself, keep its own links. Append `<SiteLinks.GitHub className="topbar__link" />`: a second export, `GitHubLink`, that renders only the GitHub link. Place it after the existing nav's links, inside `topbar__nav`. That is the single line you may add inside `TopBar`.

### 3. The landing's narrow bar

- At `max-width: 720px` the six views and GitHub do not fit. In the landing's header, add a `Views` toggle button (`landing__menu`, `aria-expanded`, `aria-controls="landing-views"`) to the right of the wordmark.
- It opens `<nav id="landing-views" className="landing__sheet">` under the bar, holding the same `SiteLinks`.
- Escape closes it, as `TopBar` does. A link click closes it (`onNavigate`).
- At 721 px and wider, the toggle is hidden and the links sit inline, as now.
- The sheet's background is `var(--paper)`, with a `var(--hair)` bottom line.

### 4. The current-section marker (`apps/web/src/app/nav.css`, new, imported once in `App.tsx`)

A link with `aria-current="page"`, in both bars and in both sheets, reads in ink with a 2 px ink underline:

```css
:is(.topbar__link, .landing__link)[aria-current="page"] { color: var(--ink); box-shadow: inset 0 -2px 0 var(--ink); }
:is(.topbar__sheet-link, .landing__link)[aria-current="page"] { color: var(--ink); }
```

Other links stay slate, with ink on hover only under `(hover: hover) and (pointer: fine)`. Never blue: blue is for money in motion only.

### 5. The footer, on every screen

- New `apps/web/src/app/SiteFooter.tsx`, rendered in `App.tsx` right after `</main>`, for every surface, the landing included.
- Its exact words: `countersign lets an AI agent pay for tools only inside limits you sign, and every payment leaves a slip anyone can check without us.`
- Markup: `<footer className="site-foot"><p className="site-foot__what">…</p></footer>`.

Styles in `nav.css`:

```css
.site-foot { max-width: var(--content); margin: 0 auto; padding: var(--sp-8) clamp(16px, 4vw, 40px); border-top: var(--hair) solid var(--line); }
.site-foot__what { color: var(--slate); font-size: var(--t-13); max-width: 60ch; }
```

On the landing, `.landing .site-foot` sits on the landing's paper colour; give `body` nothing new.

## Lease

You may create or change only:

- `apps/web/src/app/SiteLinks.tsx`, `apps/web/src/app/SiteFooter.tsx` and `apps/web/src/app/nav.css` (new);
- `apps/web/src/app/App.tsx`: the `nav.css` import, the footer after `</main>`, and the one GitHub line in `TopBar`;
- `apps/web/src/routes/home/index.tsx`: the landing header only;
- `apps/web/test/nav.test.ts` (new);
- `.packets/reports/ui-F-navigation.md`.

## Tests (`apps/web/test/nav.test.ts`)

No browser. Server-render with `react-dom/server`'s `renderToString`, imported from `apps/web/node_modules`. Stub `globalThis.window` with `location.hash` set to `#/registry`. Test:

1. `SiteLinks` renders every `VIEWS` label in order, then GitHub, with `aria-current="page"` only on Registry.
2. `SiteFooter` renders the exact sentence.

Every existing test passes.

## Constraints

- **Never launch a browser of any kind on this machine:** no Chrome or Chromium, headless or not, no Playwright, Puppeteer or screenshot tools. UI checks go back to the lane, which raises NEEDS-BROWSER.
- No new dependencies. TypeScript strict, no `any`. Touch no landing file but the header in `index.tsx`. No changes to `shell.css`, `landing.css` or `TopBar` beyond the one line.

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

Commit with small present-tense messages ending `(refs #21)`, and no trailers. Write `.packets/reports/ui-F-navigation.md`. Do not push, merge or deploy.
