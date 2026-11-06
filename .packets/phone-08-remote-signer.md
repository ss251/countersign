# Packet phone-08-remote-signer (STEER-0245; cs-phone's lease: the runner's remote-signer seam, seller side)

## Goal

The seller runner (`packages/runner`) signs through the hub's `POST /cli/sign`, using a revocable session token that the CLI hands it, so no seller key exists on the person's machine. `CS_SELLER_KEY` stays only as the "Advanced: CI" override, with its behaviour unchanged.

## Lease: touch nothing outside `packages/runner/**`

Do not edit:
- `packages/cli`, `packages/core`, `packages/buyer` or `packages/mcp`;
- `apps/**` or `docs/**`;
- `bun.lock`, any `package.json`, or `.packets/` (except your report).

## Facts (read the code; do not guess)

- `packages/runner/src/account.ts` defines `RunnerAccount { address; signMessage({ message }); signTypedData(typedData) }`. It is structural, so the package needs no viem dependency for it.
- The runner signs in these places:
  - **hello**, `daemon.ts`, `signMessage` over `countersign runner <nonce>` (`packages/core/src/wire.ts:40`);
  - **canary answer**, `daemon.ts`, `signMessage` over `countersign canary <offerHash> <nonce>` (`wire.ts:55`);
  - **slip**, `daemon.ts:334`, `signTypedData(slipTypedData(body))`, the EIP-712 `Release(bytes32 jobId, bytes32 slipHash)`;
  - **bonded lock**, `daemon.ts:234`, `signTypedData` (Lock), which casts the type today;
  - **publish**, `publish.ts:39`, `signMessage` over `countersign offer <hash>` (`wire.ts:45`).
- `packages/runner/src/cli.ts:281`: `sellerAccount()` reads `CS_SELLER_KEY` and calls `privateKeyToAccount`. `bond.ts:365-386` does the same for the bond commands.
- `packages/cli/src/cli.ts:5` imports `main as runnerMain` from `packages/runner/src/cli.ts`. The CLI owner (cs-truth) builds the remote account from its own stored session and passes it in. You only provide the seam.

## Build

1. **New file `packages/runner/src/remote-signer.ts`:**

   ```ts
   export function remoteRunnerAccount(opts: {
     hubUrl: string; session: string; address: Address; fetch?: typeof fetch;
   }): RunnerAccount
   ```

   - `signMessage({ message })` sends `POST ${hubUrl}/cli/sign` with body `{"kind":"message","message":<string>}`.
   - `signTypedData(td)` sends `POST ${hubUrl}/cli/sign` with body `{"kind":"typedData","typedData":{domain,types,primaryType,message}}`. Bigints are serialised as decimal strings by a JSON replacer.
   - Headers: `authorization: Bearer <session>` and `content-type: application/json`. Strip trailing slashes from `hubUrl`.
   - **200** `{"signature":"0x…"}`: validate `/^0x[0-9a-fA-F]{130}$/` and return it. Otherwise throw "The hub returned no signature."
   - **401**: throw `Error("Not signed in. Run: npx -y @countersign-hub/cli login")`.
   - **403**: throw `Error("The hub refused to sign this: <reason>")`, with the reason from body `{"reason"}` or else "not allowed".
   - **Any other status, or a network error**: throw `Error("The hub could not sign right now (<status or 'unreachable'>).")`.
   - Never put the session token or the payload in an error, log or console line.
2. **`packages/runner/src/cli.ts`:**
   - `main(argv, options?: { account?: RunnerAccount })`. `sellerAccount(options)` picks, in this order:
     1. `options.account`;
     2. `CS_SELLER_KEY`, with today's checks and messages unchanged;
     3. otherwise, throw `Error("Not signed in. Run: npx -y @countersign-hub/cli login")`.
   - Pass `options` through to every command that signs.
   - Export `remoteRunnerAccount` (and its options type) from `packages/runner/src/index.ts`.
3. **`account.ts`:** widen `signTypedData`'s parameter to every typed data the runner signs (`Release` and `Lock`), and remove the cast at `daemon.ts:234` if that is clean. No behaviour change.
4. **`bond.ts`:** keep it key-based. The bond commands send on-chain transactions, and a session can only ask for signatures. When `CS_SELLER_KEY` is missing, its error adds one line: "Bond commands need CS_SELLER_KEY (Advanced: CI): a signed-in session cannot send transactions."

## Tests: new file `packages/runner/test/remote-signer.test.ts`

The mock hub is `Bun.serve` on `127.0.0.1:0`. It signs with a throwaway viem key generated in the test, checks the Bearer token, and records each body. The tests:
- **hello and canary:** `signMessage` sends kind `message` with the Bearer header. The hello signature, `countersign runner <nonce>`, and the canary signature, `countersign canary <hash> <nonce>`, both recover to the test address (viem `recoverMessageAddress`).
- **slip `Release`:** `signTypedData` round-trips, with the bigints sent as strings. The signature verifies with viem `verifyTypedData` against `slipTypedData(body)` from `@countersign/core`. A `Lock` typed data does the same.
- **errors:** 401 gives exactly "Not signed in. Run: npx -y @countersign-hub/cli login". 403 carries the hub's reason. A server that is down gives "could not sign right now (unreachable)".
- **redaction:** the session token appears in no thrown error and no `console.*` output (spy on them).
- **cli:**
  - `main` with `options.account` and no `CS_SELLER_KEY` in env reaches the signing path with that account (publish against the mock, or `serve` with a stubbed dial);
  - with neither, the error is the "Not signed in" message;
  - with only `CS_SELLER_KEY`, today's behaviour is unchanged.
- All existing tests stay green and unedited.

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
- the `/cli/sign` wire contract exactly as built;
- the test names and counts;
- the gate numbers.
