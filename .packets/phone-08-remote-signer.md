# Packet phone-08-remote-signer (STEER-0245; cs-phone's lease: the runner's remote-signer seam, seller side)

## Goal

When the person is signed in, the seller runner (`packages/runner`) signs through the hub's `POST /cli/sign`, so no seller key exists on the person's machine. `CS_SELLER_KEY` stays as the "Advanced: CI" override and still wins whenever it is set, with its behaviour unchanged.

## Lease: touch NOTHING outside `packages/runner/**`

- Do not edit `packages/cli/**`. It is cs-truth's: an earlier run of this packet edited `packages/cli/src/bin.ts`, and that edit was thrown away.
- Do not edit `packages/core`, `packages/buyer`, `packages/mcp`, `apps/**`, `docs/**`, `bun.lock` or any `package.json`.
- Under `.packets/`, write only your own report.

## The hub contract (cs-truth, RUN-STATE 21:10:53Z; build exactly this)

- **Session handover.** The CLI dispatcher sets `process.env.CS_SESSION` (the session token) and `process.env.CS_HUB` (the hub URL) in-process before it delegates to the runner's `main`.
- **`GET ${CS_HUB}/cli/session`**, with header `authorization: Bearer ${CS_SESSION}`:
  - 200 `{address, expiresAt}`: the session wallet, which is the seller address;
  - 401 `{code:"not-signed-in", message}`.
- **`POST ${CS_HUB}/cli/sign`**, with headers `authorization: Bearer ${CS_SESSION}` and `content-type: application/json`. The body is one of:
  - `{"kind":"typed-data","typedData":{domain,types,primaryType,message}}`, with bigints as decimal strings;
  - `{"kind":"message","message":"<string>"}`.
- **Answers to `/cli/sign`:**
  - 200 `{signature, address}`;
  - 401 `{code:"not-signed-in", message:"Not signed in. Run: npx -y @countersign-hub/cli login"}`;
  - 403 `{code:"not-allowed"}` or `{code:"envelope-closed"}`;
  - 502 `{code:"privy-failed"}`.
- **What the hub signs for a seller:**
  - EIP-712 `Release` on an escrow the hub runs;
  - personal_sign of `countersign runner …`, `countersign offer …`, `countersign delist …` and `countersign canary …`.
- **It does NOT sign `Lock` (bonded jobs).**

## Facts (read the code)

- `packages/runner/src/account.ts` defines the structural `RunnerAccount { address; signMessage({ message }); signTypedData(typedData) }`.
- The runner signs in these places:
  - **hello**, `daemon.ts`, `signMessage` over `countersign runner <nonce>` (`packages/core/src/wire.ts:40`);
  - **canary answer**, `daemon.ts`, over `countersign canary <offerHash> <nonce>` (`wire.ts:55`);
  - **slip `Release`**, `daemon.ts:334`;
  - **bonded `Lock`**, `daemon.ts:234`;
  - **publish**, `publish.ts:39`, over `countersign offer <hash>` (`wire.ts:45`).
- `packages/runner/src/cli.ts:281`: `sellerAccount()` reads only `CS_SELLER_KEY`. `bond.ts:365-386` does the same for the bond commands, which send transactions.

## Build

1. **New file `packages/runner/src/remote-signer.ts`:**
   - `remoteRunnerAccount({ hubUrl, session, address, fetch? }): RunnerAccount & { kind: "remote" }`.
     - `signMessage` sends `POST /cli/sign {kind:"message",message}`.
     - `signTypedData` sends `{kind:"typed-data",typedData}`, through a bigint-to-decimal-string JSON replacer.
     - On 200, check that `signature` matches `/^0x[0-9a-fA-F]{130}$/`, and that the returned `address` equals the account's address, compared case-insensitively. If not, throw "The hub signed with a different wallet." Return the signature.
     - On 401, throw `Error(body.message ?? "Not signed in. Run: npx -y @countersign-hub/cli login")`.
     - On 403, throw `Error("The hub refused to sign this: " + (body.code ?? "not-allowed"))`.
     - On 502, throw `Error("The hub could not sign right now (privy-failed).")`.
     - On any other status or a network failure, throw `Error("The hub could not sign right now (<status or 'unreachable'>).")`.
     - Strip trailing slashes from `hubUrl`.
     - **Never put the session token or a payload in any error, log or console line.**
   - `remoteAccountFromSession({ hubUrl, session, fetch? })` calls `GET /cli/session`.
     - On 200, it returns `remoteRunnerAccount` with that address.
     - On 401, it throws the "Not signed in…" message above. Any other failure uses the "could not sign right now" form.
2. **`packages/runner/src/cli.ts`:** `sellerAccount()` picks, in this order:
   1. `CS_SELLER_KEY` set: the local key, exactly as today, with every check and message unchanged. This is the CI override.
   2. Otherwise, `CS_SESSION` set: `remoteAccountFromSession({ hubUrl: process.env.CS_HUB ?? <the hub this command targets>, session })`.
   3. Otherwise, throw `Error("Not signed in. Run: npx -y @countersign-hub/cli login")`.
   - Export `remoteRunnerAccount` and `remoteAccountFromSession` from `packages/runner/src/index.ts`.
3. **Bonded offers with a remote account.** Before `serve` publishes or serves an offer with `bond > 0`, refuse it when `account.kind === "remote"`. The error is: "A bonded offer needs CS_SELLER_KEY (Advanced: CI): the hub does not sign Lock for a signed-in session yet." Unbonded offers serve normally.
4. **`account.ts`:** add the optional `kind?: "local" | "remote"`, and widen `signTypedData` to every typed data the runner signs, removing the cast at `daemon.ts:234` if that is clean. No behaviour change.
5. **`bond.ts`:** keep it key-based. When `CS_SELLER_KEY` is missing, its error adds: "Bond commands need CS_SELLER_KEY (Advanced: CI): a signed-in session cannot send transactions."

## Tests: new file `packages/runner/test/remote-signer.test.ts`

The mock hub is `Bun.serve` on `127.0.0.1:0`. It signs with a throwaway viem key made inside the test, checks the Bearer token and records each body. The tests:
- **hello and canary:** `signMessage` sends `{kind:"message"}` with the Bearer header. The hello (`countersign runner <nonce>`) and canary (`countersign canary <hash> <nonce>`) signatures recover to the test address (viem `recoverMessageAddress`).
- **slip `Release`:** `signTypedData` sends `{kind:"typed-data"}` with the bigints as strings. The signature verifies with viem `verifyTypedData` against `slipTypedData(body)` from `@countersign/core`.
- **address mismatch:** a mock that answers another address gives "The hub signed with a different wallet."
- **errors:** 401 gives exactly "Not signed in. Run: npx -y @countersign-hub/cli login". 403 `{code:"envelope-closed"}` carries that code. 502 gives "privy-failed". A server that is down gives "unreachable".
- **sessions:** `remoteAccountFromSession` takes its address from `GET /cli/session`, and a 401 there gives "Not signed in…".
- **precedence in `cli`:**
  - `CS_SELLER_KEY` set wins, even with `CS_SESSION` set;
  - `CS_SESSION` plus `CS_HUB` (the mock) uses the remote account, checked through publish against the mock or `serve` with a stubbed dial;
  - with neither, the error is "Not signed in…".
- **bonded:** a bonded offer on a remote account is refused with the Lock message.
- **redaction:** the session token appears in no thrown error and no `console.*` output (spy on them).
- All existing tests stay green and unedited. Restore any env var you set.

## Constraints

- Never run `git stash`: use a temporary commit or a second worktree.
- Run `bun install --linker hoisted` before the gate.
- No key, token or signature is printed, logged or committed. Test keys are generated inside the tests.
- Do not edit, skip or weaken any existing test.
- Commits are small and present tense, with no emoji and no Co-authored-by.
- Gate: `bun run typecheck && bun test packages/runner && bun test && forge test`.

## Report

Write `.packets/reports/phone-08-remote-signer.md`, covering:
- the files changed;
- the contract exactly as built;
- the test names and counts;
- the gate numbers.
