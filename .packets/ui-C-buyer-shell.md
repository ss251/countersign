# ui-C-buyer-shell: the buyer's phone keeps the console's shell, says plainly what it is, and never switches identity silently (refs #21, STEER-2058 fix 3)

## Setup

Run `bun install` at the worktree root before anything else. You are on `cs/ui-C`, cut from `origin/main`.

## The captain's words and the firstmate's finding

"Find and kill the Studio-looking surface in the buyer flow, or label it explicitly as the Studio-built console, and make sure no route silently swaps identity."

The firstmate found it:
- There is no Studio embed. The surface is `#/buyer` itself.
- It swaps the console's whole shell for a phone-app frame, with its own header, a `countersign ▾` switcher and its own bottom tabs.
- At 390 there is no top-level nav, and the switcher is the only way out.
- A newcomer is greeted by "Approval token: the approver token your hub was started with", an operator prompt with no explanation.
- At 1440 it is a phone frame in the middle of the page.

## The design is decided (cs-ui)

### 1. Keep the console's shell on `#/buyer`

`apps/web/src/app/routes.ts` gives `buyer` the `phone` surface through `PHONE`, so `App.tsx` drops the `TopBar`. Add `export const surface = "desk";` to `apps/web/src/routes/buyer/index.tsx`. The console's top bar and nav then show on `#/buyer` as on every desk screen.

- **The frame fits under the bar.** The phone frame is an app shell of `height: 100dvh` (`.phone` in `apps/web/src/routes/buyer/buyer.css`). Under the sticky top bar (`.topbar__inner` is `height: var(--bar)`, plus its 1 px border) it must be `height: calc(100dvh - var(--bar) - 1px)`. The phone's own bottom tab bar then stays on screen at 390.
- **At 1440,** the phone stays centred, with its note beside it.

### 2. Label the frame plainly; no switcher

In `apps/web/src/routes/buyer/index.tsx`:

- **The bar.** Remove the `phone__brand` switcher button, its chevron, the `viewsOpen` state and the whole `phone__views` sheet. The top bar is the way to other views now. In the button's place, put `<p className="phone__title">Buyer's phone</p>` and keep the budget link on the right, as now.
- **A plain line** right under the bar, `<p className="phone__who">You approve what your agent asks to buy.</p>`, slate, `var(--t-13)`.
- **The 1440 note** (`phone-note`):
  - eyebrow `The buyer's phone`;
  - title `The human behind an agent.`;
  - body `Your agent buys inside the envelope you set. Above your limit it waits, and you approve the exact offer and amount here.`
  - Delete its `Other views` nav.

### 3. Never change the agent or hub without saying so

`?agent=` and `?hub=` in a link are stored silently in `localStorage` (`countersign.agent` and `countersign.hub`, `apps/web/src/lib/hub.ts`).

- **The helper.** Export `chosenHub(): string | null` and `forgetChoices(): void` from `hub.ts`. The first returns the stored hub choice; the second removes both keys.
- **The line.** When an agent or a hub is chosen, show one line at the top of the phone body: `<p className="phone__chosen">`. Its words:
  - with an agent: `Showing agent <short address>`;
  - with a hub: ` on hub <host of the URL, or "this server" for /hub>`;
  - then `, chosen by a link.`;
  - then a button `Use my own`, which calls `forgetChoices()` and `navigate("/buyer")`.

  This line takes `data-testid="buyer-chosen"`, and the button `data-testid="buyer-use-my-own"`.

### 4. The token prompt moves behind "I run my own hub"

`apps/web/src/routes/buyer/Approvals.tsx` shows `<TokenForm>` in two places: the list's absent branch with `needsToken`, and the approval dock. In both, wrap it:

```tsx
<details className="disclose" data-testid="buyer-own-hub">
  <summary>I run my own hub</summary>
  <p className="disclose__body">Paste the approval token your hub was started with. It stays on this phone and goes only to that hub.</p>
  <TokenForm … />
</details>
```

In the list's absent branch, before the `details`, add `<p className="phone__newcomer">New here? Connect a wallet in the top bar.</p>`. When `hasRoute("start")` is true, follow it with ` Or ` and a `Link` to `/start` reading `start here`; `hasRoute` lives in `apps/web/src/app/routes.ts`.

### 5. Styles (`buyer.css`)

Append under the comment `/* The buyer's phone, inside the console's shell (STEER-2058). */`:

- `.phone__title`: `font-weight: 600; font-size: var(--t-15);`
- `.phone__who`, `.phone__chosen` and `.phone__newcomer`: `color: var(--slate); font-size: var(--t-13); padding: var(--sp-2) var(--sp-4);`
- `.phone__chosen button`: a quiet text button with an underline and a 44 px target.
- `.disclose summary`: `cursor: pointer; min-height: 44px; display: flex; align-items: center; font-weight: 500;`
- `.disclose__body`: slate, `var(--t-13)`.

Nothing blue. Tokens only.

## Lease

You may create or change only:

- `apps/web/src/routes/buyer/index.tsx` and `apps/web/src/routes/buyer/Approvals.tsx` (the parts above);
- `apps/web/src/routes/buyer/buyer.css`;
- `apps/web/src/lib/hub.ts` (the two exports);
- `apps/web/test/buyer-shell.test.ts` (new);
- `.packets/reports/ui-C-buyer-shell.md`.

## Tests (`apps/web/test/buyer-shell.test.ts`)

No browser. Test:

- `forgetChoices()` removes `countersign.agent` and `countersign.hub` from an in-memory `localStorage` on a stubbed `globalThis.window`;
- `chosenHub()` reads `countersign.hub`;
- the buyer module exports `surface === "desk"`.

Every existing test passes, `buyer.test.ts` included.

## Constraints

- **Never launch a browser of any kind on this machine:** no Chrome or Chromium, headless or not, no Playwright, Puppeteer or screenshot tools. UI checks go back to the lane, which raises NEEDS-BROWSER.
- Do not touch `App.tsx`, `shell.css`, the landing, or the decision and signing code in `Approvals.tsx` (`fail`, `countersign`, `decline`, `ApproverKey`, `ApproverLine`).
- No new dependencies. TypeScript strict, no `any`.

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

Commit with small present-tense messages ending `(refs #21)`, and no trailers. Write `.packets/reports/ui-C-buyer-shell.md`. Do not push, merge or deploy.
