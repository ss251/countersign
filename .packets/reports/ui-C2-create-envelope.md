# ui-C2 create envelope report

## Built

- `apps/web/src/lib/hub.ts`: added `rememberAgent(agent)`. It stores `AGENT_KEY` only for a `0x` plus 40 hex address and is wrapped in try/catch like its neighbours. No other hub change.
- `apps/web/src/routes/buyer/session.ts` (new, no React): `createSessionEnvelope` posts `{ agent }` to `/envelopes/session` with only `x-privy-token`, remembers the token then the agent from a well-formed answer, and maps failures to the three decided outcomes. Malformed answers remember nothing; messages never carry the token or a response body.
- `apps/web/src/routes/buyer/Approvals.tsx`:
  - `PhoneLocked` keeps its title and "No hub of your own?" line; the old body and bare `TokenForm` are replaced by `TokenGate`.
  - `TokenGate` reads `WalletModeContext.privy` once. With email sign-in on it renders `PrivyCreate`; off, it says "Email sign-in is off on this console, so paste a token instead." It always renders the native `<details className="locked__paste">` secondary option, open when rejected or sign-in is off, with the rejected alert and the existing `TokenForm`.
  - `PrivyCreate` carries the two decided sentences, one `Button variant="primary" block` reading "Create an envelope" (or "Creating your envelope…" while running), signs in first when needed, runs the create once after sign-in, and shows the decided messages in a `field__error` alert. A missing embedded wallet shows "Your wallet is still being set up. Try again in a moment." and leaves the button enabled.
- `apps/web/src/routes/buyer/EnvelopeTab.tsx`: the bare `TokenForm` is replaced by `TokenGate`.
- `apps/web/src/routes/buyer/HistoryTab.tsx`: the locked purchases state takes the shared open callback.
- `apps/web/src/routes/buyer/index.tsx`: `openAll` reloads the envelope, approvals and purchases together, and is passed to `Approvals`, `EnvelopeTab` and `HistoryTab`.

## Tests

New `apps/web/test/create-envelope.test.ts` (12 tests, passing):

- the session call's path, body `{ agent }` and sole `x-privy-token` header;
- a well-formed answer remembers `cse_test` and the agent, in that order;
- 401 gives `signed-out` and remembers nothing;
- status 0 and status 500 give the exact decided messages;
- a missing token, and a token beside a non-address agent, give the malformed-answer message and remember nothing;
- no error message ever contains `cse_`;
- `TokenGate` with `privy: false` contains "Paste a token instead", an open `<details`, and the sign-in-off sentence, and does not contain "Paste the token first.";
- source checks: no `console.` in `session.ts` or `Approvals.tsx`, both decided sentences and "Create an envelope" are present exactly, and no buyer route file contains `token=`.

## Verification

- `bun install --linker hoisted`: no changes.
- `bun run typecheck`: clean.
- `bun test apps/web/test/create-envelope.test.ts`: 12 pass, 0 fail.
- `(cd apps/web && bunx --bun vite build)`: built.
- `bun apps/web/scripts/wallet-grep.ts apps/web/dist`: clean; no approval/permit selector and no banned call from our sources.

## Blocked: one existing test contradicts the decided markup

`bun test apps/web/test` is 238 pass, 4 skip, 1 fail. The only failure is the existing `apps/web/test/buyer-locked.test.ts` at line 17:

```ts
expect(html).not.toContain("<details");
```

That assertion was written for the old locked state, where the token field was bare. This packet requires `TokenGate` to always render `<details className="locked__paste">`, so the assertion cannot pass while the decided markup exists. The test does not assert the old body paragraph, but its no-`<details>` assertion is the same kind of superseded expectation. Per the packet, no existing test was edited.

Everything else in the acceptance command passes. If the owner accepts the new locked state, the line should be replaced by assertions for "Paste a token instead" and the open `<details>`; this packet leaves that decision outside its lease.

## Notes

- No browser was launched. No `apps/hub/**`, `packages/**`, `docs/**`, CSS or landing files were touched.
- The pre-existing mode change on `packages/cli/src/bin.ts` was left unstaged and uncommitted.
- The parallel seller-label lines in `Approvals.tsx` were not touched.
- No wallet signature method was added.
