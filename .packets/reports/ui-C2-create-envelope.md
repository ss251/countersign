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

## Follow-up: the paste field stays visible, Create waits for Privy

- `TokenGate`: the `<details>` is gone. The paste form sits below Create in a plain `div.locked__paste` with `data-testid="buyer-own-hub"`; with sign-in on it carries the "Or paste a token" label and a secondary submit button, with sign-in off it is the primary field. `TokenForm` takes `variant?: "primary" | "secondary"` (default `"primary"`); other callers are unchanged.
- `PrivyCreate`: the button is disabled until Privy is ready and stays labelled "Create an envelope". While a sign-in is pending the effect waits for the embedded wallet rather than failing, showing "Your wallet is still being set up. It opens here in a moment."; the wallet's arrival clears `pending` and creates once. A press while signed in without a wallet still shows the existing "Try again in a moment." message.
- `create-envelope.test.ts`: the sign-in-off test now asserts "Email sign-in is off on this console", "Approval token", "Use this token" and the buyer-own-hub test id, and that there is no `<details` and no "Paste the token first.".
- Acceptance: install, typecheck, the whole web suite (240 pass, 3 skip, 0 fail), the Vite build and `wallet-grep` all pass. `buyer-locked.test.ts` is unedited.

## Follow-up: the Privy token goes only to this console's own hub

- `apps/web/src/lib/hub.ts`: added `FOREIGN_HUB` and `isOwnHub()`. It is true only when `import.meta.env.VITE_HUB_URL` is a non-empty string and `hubBase()` equals it after stripping trailing slashes from both; `?hub=local`, `off` and a link's hub are false. `hubPost` and `hubGet` check the header keys case-insensitively for `x-privy-token` before any fetch and throw `HubError(403, FOREIGN_HUB, "foreign-hub")` when the hub is not this console's own. The pasted approval token's `Authorization: Bearer` path is untouched.
- `apps/web/src/routes/buyer/session.ts`: the catch returns `{ kind: "error", message: FOREIGN_HUB }` for `code === "foreign-hub"`, before the 401 and status-0 cases.
- `apps/web/src/routes/buyer/Approvals.tsx`: `TokenGate` renders `PrivyCreate` only when email sign-in is available and the hub is this console's own. Signed in on another hub it shows `FOREIGN_HUB`, hides the "Or paste a token" label, and makes the paste form primary. With sign-in off it is unchanged.
- `apps/web/test/w1-privy-token-origin.test.ts`: brought in from `origin/cs/w1` with `git checkout`, byte-identical, never edited.
- `apps/web/test/create-envelope.test.ts`: five more tests, using the w1 test's `window`/`fetch` mock: `isOwnHub()` is false on `#/buyer?hub=https://evil.example`; a `X-Privy-Token` header is refused with status 403 and code `foreign-hub` while `fetch` is never called; a call without a Privy header still reaches the chosen hub; `createSessionEnvelope` with `post: hubPost` returns the `FOREIGN_HUB` message; and `TokenGate` with `privy: true` on that page renders `FOREIGN_HUB` and "Use this token", with no "Create an envelope" and no "Or paste a token".
- Acceptance: install, typecheck, `bun test apps/web/test` (246 pass, 3 skip, 0 fail across 30 files, including the unedited w1 test), the Vite build, and `wallet-grep` (84 bundle files, 83 with source maps, clean) all pass. `buyer-locked.test.ts` is unedited and no CSS was touched.
