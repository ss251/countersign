# ui-cli-login report

## Built

- `apps/web/src/routes/cli-login/approve.ts` (new, no React): exports `CODE`, `readCode`, `ApproveOutcome` and `approveCliLogin`. `readCode` trims and uppercases `?code` and accepts it only in `XXXX-XXXX` form. The call posts `{ code }` to `/cli/login/approve` with only `x-privy-token`; a 0x address in the answer becomes `approved.address`, otherwise `null`. `foreign-hub` gives the `FOREIGN_HUB` message, 401 gives `signed-out`, 404/410 give `expired`, status 0 and every other failure get the two decided messages. No message carries the token or a response body.
- `apps/web/src/routes/cli-login/View.tsx` (new): `CliLoginView({ code, signIn, reason? })` renders the page head, the code comparison and the never-approve sentence. A missing or malformed code shows only the decided error line. With `signIn: null` it shows the `locked__alt` reason (`FOREIGN_HUB` outside this console's own hub, the email-off sentence otherwise). With a Privy-shaped `signIn` it shows one primary block button, disabled until ready and while connecting; signed out, it calls `login()` and the effect carries on once authenticated, as `PrivyCreate` does. Approved replaces the button with the status line and, when present, `Your agent wallet: <Hash />`.
- `apps/web/src/routes/cli-login/index.tsx` (new): `surface = "desk"`; reads the code, checks `WalletModeContext.privy` and `isOwnHub()`, renders `PrivyConnect` only for Privy on this console's own hub, and passes `signIn: null` with the matching reason otherwise. `PrivyConnect` is the only component that calls `usePrivy()`. Nothing connects on load.

## Tests

New `apps/web/test/cli-login.test.ts` (15 tests):

- `readCode`: `abcd-1234` gives `ABCD-1234`; `ABCD1234`, `AB-CD`, an empty code and no code give `null`.
- `approveCliLogin` with fake posts: exact path, body and sole Privy header; an address and an empty answer; 401, 404, 410, status 0, 500 and `foreign-hub` mapping; no failure message contains the token.
- The real `hubPost` guard, using the w1 test's `window`/`fetch` mock on `#/cli-login?code=ABCD-1234&hub=https://evil.example`: no request carrying `x-privy-token` reaches evil.example and the outcome is `FOREIGN_HUB`.
- `renderToString`: valid code with `signIn: null` shows the code, the never-approve sentence, `FOREIGN_HUB` and no button; no code shows only the error line; a fake `ready: true, authenticated: false` sign-in shows `Connect this CLI`.
- Source check: the three cli-login files contain no `console.`.

## Verification

- `bun install --linker hoisted`: no changes.
- `bun run typecheck`: clean.
- `bun test apps/web/test`: 282 pass, 3 skip, 0 fail across 33 files (including the built-dist wallet scan).
- `(cd apps/web && bunx --bun vite build)`: built.
- `bun apps/web/scripts/wallet-grep.ts apps/web/dist`: clean; 84 bundle files, 83 with source maps.

## Notes

- No browser was launched. No `apps/hub/**`, `lib/**`, `packages/**`, `docs/**` or CSS was touched.
- The pre-existing mode change on `packages/cli/src/bin.ts` was left unstaged and uncommitted.
- No wallet signature method, `dangerouslySetInnerHTML`, `any` or new dependency was added.
