# phone-08-remote-signer

## Files changed

- `packages/runner/src/remote-signer.ts` (new): the hub-backed seller account and the session lookup.
- `packages/runner/src/account.ts`: `kind?: "local" | "remote"`; `signTypedData` accepts the widened `RunnerTypedData` (Release and Lock) instead of only `ReleaseTypedData`.
- `packages/runner/src/cli.ts`: `sellerAccount(hub)` picks `CS_SELLER_KEY`, then `CS_SESSION` + `CS_HUB` (falling back to the command's `--hub`), then refuses with the login sentence. Every publish goes through the remote bonded-offer check.
- `packages/runner/src/daemon.ts`: the lock path signs `lockTypedData(...)` without the old cast; `startRunner` refuses a bonded offer on a remote account before it serves anything.
- `packages/runner/src/bond.ts`: a missing `CS_SELLER_KEY` now adds the "Bond commands need CS_SELLER_KEY (Advanced: CI)" sentence.
- `packages/runner/src/index.ts`: exports `remoteRunnerAccount`, `remoteAccountFromSession`, `assertRemoteCanServe`, the refusal/notice strings and the new types.
- `packages/runner/test/remote-signer.test.ts` (new): 19 tests against a `Bun.serve` mock on `127.0.0.1:0`.
- `.packets/reports/phone-08-remote-signer.md`: this report.

`packages/cli/**`, `packages/core`, `packages/buyer`, `packages/mcp`, `apps/**`, `docs/**`, `bun.lock` and every `package.json` are untouched.

## The contract as built

- `remoteRunnerAccount({ hubUrl, session, address, fetch? })` returns `RunnerAccount & { kind: "remote" }`.
  - `signMessage` sends `POST {hub}/cli/sign` with `authorization: Bearer <session>` and `content-type: application/json`, body `{kind:"message",message}`.
  - `signTypedData` sends `{kind:"typed-data",typedData}`, with a JSON replacer that turns every bigint at any depth into a decimal string.
  - 200: the signature must match `/^0x[0-9a-fA-F]{130}$/` and the returned `address` must equal the account address case-insensitively; otherwise "The hub signed with a different wallet."
  - 401: `body.message` when present, else "Not signed in. Run: npx -y @countersign-hub/cli login".
  - 403: "The hub refused to sign this: <code>" (`not-allowed` when the body has no code).
  - 502: "The hub could not sign right now (privy-failed)."
  - Any other status or a network failure: "The hub could not sign right now (<status>)." / "(unreachable)."
  - `hubUrl` is stripped of trailing slashes.
  - The session token and the payload are never interpolated into an error, log or console line.
- `remoteAccountFromSession({ hubUrl, session, fetch? })` calls `GET {hub}/cli/session`, takes `address` from the 200 body, and returns a remote account. A 401 throws the login sentence; every other non-200, a failed request and a malformed address use the "could not sign right now" form.
- `sellerAccount` precedence: `CS_SELLER_KEY` (local key, unchanged checks and message) > `CS_SESSION` with `CS_HUB` or the command's `--hub` > "Not signed in. Run: npx -y @countersign-hub/cli login".
- A bonded offer (`bond > 0`) on a remote account is refused before publish (`publishWithState`) and before serve (`startRunner`) with: "A bonded offer needs CS_SELLER_KEY (Advanced: CI): the hub does not sign Lock for a signed-in session yet." Unbonded offers pass.
- `bondFromEnv` stays key-based; a missing key yields "CS_SELLER_KEY must hold a 0x-prefixed 32-byte hex key. Bond commands need CS_SELLER_KEY (Advanced: CI): a signed-in session cannot send transactions."

## Tests

New file `packages/runner/test/remote-signer.test.ts`, 19 tests, no network beyond `127.0.0.1`; the mock key is generated inside the test and every env var is restored.

- remote signer (12):
  1. the hello signature is made by the hub over the runner challenge
  2. the canary answer is made by the hub over the canary message
  3. a slip Release is signed by the hub and verifies against slipTypedData
  4. typed data bigints travel as decimal strings
  5. a signature from another wallet is refused
  6. 401 is the not-signed-in message
  7. 403 carries the hub's code
  8. 502 is the privy-failed sentence
  9. another status is reported by number
  10. a hub that is down is unreachable
  11. the session supplies the address and trailing slashes are stripped
  12. a 401 from the session route is the not-signed-in message
- seller CLI account precedence (4):
  13. CS_SELLER_KEY wins even when CS_SESSION is set
  14. CS_SESSION signs publish through CS_HUB
  15. without CS_HUB the session is checked against the hub the command targets
  16. with no key and no session the CLI asks the person to log in
- bonded offers on a remote account (2):
  17. a bonded offer is refused with the Lock message
  18. an unbonded offer serves normally
- redaction (1):
  19. the session token appears in no error and no console output

The 45 assertions include viem `recoverMessageAddress`, `verifyTypedData`, the recorded Bearer header and bodies, the session address, the `--offers` seller/signature, and console spies for redaction.

## Gate

`bun install --linker hoisted`, then from the worktree root:

```
bun run typecheck            # pass, no diagnostics
bun test packages/runner     # 137 pass, 0 fail, 336 expect() calls, 19 files
bun test                     # 1804 pass, 5 skip, 0 fail, 6946 expect() calls, 239 files
forge test                   # 10 suites, 100 tests passed, 0 failed, 0 skipped
```

Every pre-existing test is green and unedited. No key, token or signature was printed, logged or committed.
