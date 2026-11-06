# ui-C buyer shell report

## Built

- `apps/web/src/routes/buyer/index.tsx`: exports `surface = "desk"`, so `#/buyer` keeps the console's top bar and nav. Removed the `phone__brand` switcher, its chevron, `viewsOpen` and the `phone__views` sheet. The bar now reads `Buyer's phone`, with the budget link on the right as before. Under the bar: `You approve what your agent asks to buy.`
- The 1440 note now reads `The buyer's phone` / `The human behind an agent.` / the approved body, and its `Other views` nav is gone.
- Chosen identity: when `countersign.agent` or `countersign.hub` is stored, a `phone__chosen` line names the short agent address and the hub host (`this server` for `/hub`), ends `, chosen by a link.`, and offers `Use my own` (`forgetChoices()` then `navigate("/buyer")`). Marked `data-testid="buyer-chosen"` and `buyer-use-my-own`.
- `apps/web/src/lib/hub.ts`: added `chosenHub()` and `forgetChoices()`.
- `apps/web/src/routes/buyer/Approvals.tsx`: both `TokenForm` sites are now inside `<details class="disclose" data-testid="buyer-own-hub">` with the summary `I run my own hub` and the approved body. The list's absent branch also says `New here? Connect a wallet in the top bar.` and adds `Or start here` only when `hasRoute("start")` is true (it is false today, so no link renders).
- `apps/web/src/routes/buyer/buyer.css`: the phone is `calc(100dvh - var(--bar) - 1px)` inside the console shell; removed the switcher/sheet/nav rules; appended the `STEER-2058` block for the title, who/chosen/newcomer lines, `Use my own`, and the disclosure. Tokens only.

## Tests

- New `apps/web/test/buyer-shell.test.ts` stubs `globalThis.window` with an in-memory `localStorage`:
  - `chosenHub()` returns null with nothing stored and reads `countersign.hub` after a link stores one;
  - `forgetChoices()` removes `countersign.agent` and `countersign.hub`;
  - importing the buyer route (with the Vite-only `app/routes.ts` mocked, since `import.meta.glob` does not run under Bun) yields `surface === "desk"`.

## Acceptance

From the worktree root:

```
bun install && bun run typecheck && bun test apps/web/test && (cd apps/web && bunx --bun vite build)
```

- `bun install`: no changes
- typecheck: clean
- tests: 145 pass, 3 skip, 0 fail (11 files), `buyer.test.ts` included
- vite build: 1546 modules, built in 1.18s

## Notes

- No browser was launched. No out-of-lease edits. `.packets/ui-C-buyer-shell.md` (the packet) was left untouched.
- At 390 the console top bar now carries the view menu; at 1440 the phone stays centred with its note beside it.
