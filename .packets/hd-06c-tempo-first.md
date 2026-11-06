# hd-06c-tempo-first: the MPP rail leads with its native Tempo testnet method and can settle for real

## Goal

The project lead's decision (06 Nov 17:10 IST): MPP leads with its native Tempo method, which needs no Stripe at all. Stripe's card method stays in the code behind a flag that is off by default. The lane will make a real Tempo testnet payment with the `mppx` CLI against our localhost endpoint. Your job is to make the code ready for that payment; you never run it yourself. Tracked by issue #5.

The Tempo method is pathUSD on Tempo Moderato (chain 42431), with a floor of 0.01.

## Lease

- `packages/rail/src/mpp/**`, tests included
- `scripts/mpp/server.ts`
- `docs/mpp.md`: the method description and the server section only. The lane adds the live proof afterwards.
- Report: `$M/reports/hd-06c-tempo-first.md`

## Context

Read first:

- `packages/rail/src/mpp/rail.ts`, `constants.ts`, `mppx.ts`, `test/rail.test.ts`, and `scripts/mpp/server.ts` on this branch;
- the reports `$M/reports/hd-06-mpp-rail.md` and `hd-06b-mpp-testnet.md`.

From mppx 0.17.1 (installed under `node_modules/.bun/mppx@0.17.1*/node_modules/mppx/dist/`):

- **`tempo/server/Methods.d.ts`.** `tempo(parameters)` from `mppx/server` returns the Tempo server methods. `tempo.charge(parameters)` is the charge method alone. Parameters include:
  - `testnet: true`;
  - `recipient`;
  - `currency`;
  - `store` (replay protection);
  - `waitForConfirmation` (default true).
- **`tempo/server/Charge.d.ts`.** A Tempo credential payload is one of:
  - `{type: "hash", hash}`: the client broadcast it, and the server checks the transaction;
  - `{type: "transaction", signature}`: the client signed it, and the server broadcasts it;
  - `{type: "proof", signature}`: a zero-amount proof.
- **`server/Mppx.d.ts`.**
  - `mppx.broadcastCredential(credential)` re-validates the credential, broadcasts or checks the payment on chain, and returns a `Receipt`. For Tempo, `receipt.reference` is the transaction hash.
  - `mppx.validateCredential(credential)` is the non-mutating pre-check.
- **Moderato** (viem's `tempoModerato`): chain 42431, RPC `https://rpc.moderato.tempo.xyz`, explorer `https://explore.testnet.tempo.xyz`. A transaction page is `https://explore.testnet.tempo.xyz/tx/<hash>`.

## Required

### 1. The rail (`packages/rail/src/mpp/`)

1. **Options.**
   - `MppRailOptions.recipient` is required: the Tempo payee address. Validate it as a checksummed or lowercase 20-byte hex address that is not the zero address.
   - Delete `PLACEHOLDER_TEMPO_RECIPIENT` and the `tempoRecipient` option.
   - Stripe becomes optional: `stripe?: { client: StripeClientLike; networkId: string }`. Without it, the rail offers the Tempo method only and never touches Stripe code paths. The rail itself reads no environment variable; the flag lives in the server and, later, the hub.
2. **Tempo method.** Build it once:

   ```ts
   tempo.charge({ testnet: true, recipient, currency: TEMPO_CURRENCY, store })
   ```

   Pass whatever the typings require so that the chain is 42431 and the currency is pathUSD. The static guard test (no `4217`, no mainnet USDC.e address in non-test files) stays and must pass.
3. **Challenge.**
   - Tempo first. The card method is offered only when `stripe` is configured and the price meets its 0.50 USD whole-cent floor.
   - A price under 0.01 is refused outright, as today.
   - The declaration describes Tempo:
     - finality: "Final when the Tempo transaction is included on Moderato.";
     - `explorerTx`: `https://explore.testnet.tempo.xyz/tx/{tx}`;
     - `gasPaidBy`: `"buyer"` (the payer's transaction pays its own fee in a stablecoin);
     - `kind`: `"direct"`.
4. **Stateless inspection.** The hub re-issues the requirements on the paid retry, so challenge ids differ between the 402 and the retry. Today's lookup of the credential's challenge id inside `requirements.extra.mpp.wwwAuthenticate` would refuse every honest retry. Replace it:
   - `Challenge.verify(challenge, { secretKey })` must hold, and the realm must match: this proves the challenge, including its request fields, was issued by this rail;
   - then check every field that decides the payment against the current requirements:
     - `externalId` equals the offer hash;
     - the method is one this requirements object offers;
     - for Tempo, amount, currency, recipient and chain id 42431 all match;
     - for Stripe, amount and currency `usd` match;
     - the challenge has not expired;
   - keep the refusal names and messages (`challenge_not_ours`, `offer_mismatch`, `amount_mismatch`, `currency_mismatch`, `chain_mismatch`, `expired`, `replay`, `malformed`, `method_not_offered`). A recipient mismatch is `offer_mismatch`.
5. **Verify.** For Tempo, run the inspection, then the replay check against `seen`. After that, call `mppx.validateCredential(credential)` and map a throw to `payment_failed`. Delete the `tempo_verification_requires_rpc` refusal.
6. **Settle.** For Tempo:
   1. run the inspection;
   2. `seen.claim(challenge.id)`, refusing `replay` when it is already claimed. A claim is never released;
   3. `mppx.broadcastCredential(credential)`;
   4. return `{ success: true, transaction: receipt.reference, network: "mpp:tempo", receipt: Receipt.serialize(receipt) }`.

   A throw from mppx gives `{ success: false, errorReason: "payment_failed", transaction: "", network: "mpp:tempo" }`, and the error text is never echoed. Delete `tempo_settlement_requires_rpc`.

   The Stripe settle path is unchanged.

### 2. The demo server (`scripts/mpp/server.ts`)

1. **Environment.** Read `MPP_SECRET_KEY` and `MPP_RECIPIENT`.
   - If either is missing or malformed (the secret needs at least 32 bytes once decoded, or at least 43 characters), exit 1 with a message that names the variable but never shows its value.
   - Print neither value, ever.
   - Startup prints one line: the port, "Tempo testnet (Moderato, chain 42431), pathUSD, 0.01 per call", and whether the Stripe card method is on.
2. **`GET /paid` (mppx-native).**
   - `Mppx.create({ methods: [tempo.charge({ testnet: true, recipient, currency: pathUSD })], secretKey, realm: "localhost" })`, then `mppx.charge({ amount: "0.01" })(request)`. Use the per-method handler if the shorthand needs it.
   - A 402 returns the challenge. Success returns `result.withReceipt(Response.json({ ok: true, resource: "countersign mpp demo" }))`.
3. **`GET /rail/paid` (through our rail).** This is the logic the hub will need.
   - Build one demo offer: title "countersign mpp demo", price `"10000"`, rails `["mpp"]`, and a payTo naming the recipient in whatever field the offer type carries; follow the existing tests' offer fixture.
   - Build `createMppRail({ recipient, secretKey, realm: "localhost" })` once.
   - Without `Authorization`: call `rail.challenge(offer, { resource, now })`, then return 402 with `WWW-Authenticate` set to `extra.mpp.wwwAuthenticate`, plus a JSON body `{ error: "payment required" }`.
   - With `Authorization: Payment …`:
     1. build `payment = { x402Version: 2, accepted: requirements, payload: { credential: <the whole Authorization value> } }` against freshly issued requirements;
     2. call `rail.verify`, then `rail.settle`;
     3. on success, return 200 with `Payment-Receipt` set to `settle.receipt` and a JSON body naming the transaction;
     4. on refusal, return 402 with a fresh challenge and the refusal reason in the body.
4. **Card method.** It exists only when `MPP_STRIPE=1`, and then only through the mock Stripe client at `GET /paid-card` for 0.50 USD. Nobody sets this tonight; keep it working for the tests.
5. **Discovery.** Update `/openapi.json` and `/llms.txt` to describe the Tempo routes, using `x-payment-info` in the shape mppx's discovery expects. Find it under `dist/discovery`.

### 3. Docs (`docs/mpp.md`)

- Rewrite the method description: Tempo testnet leads, with pathUSD on Moderato and chain 42431, and real settlement through `broadcastCredential`.
- The Stripe SPT method is implemented behind `MPP_STRIPE=1`, off by default, and gated on a Stripe sandbox business profile.
- Describe the stateless inspection and why it exists.
- Keep the section "Running `mppx validate` safely on this machine" exactly as it is.

## Tests (offline; no network, no RPC)

- **Challenge.** Tempo only without `stripe`: one challenge, method `tempo`, chain id 42431, currency pathUSD, recipient = the configured address, amount `10000` for a 0.01 offer.
- **Floors.**
  - Under 0.01 is refused.
  - With `stripe` configured: a 0.50 offer gets both methods, and a 0.05 offer gets Tempo only.
- **Stateless inspection.**
  - A credential built against a challenge from an earlier `challenge()` call for the same offer, issued a second or more earlier, passes inspection against freshly issued requirements.
  - A challenge HMAC'd with another secret is refused as `challenge_not_ours`.
  - Another offer's `externalId` is `offer_mismatch`.
  - A different recipient is `offer_mismatch`.
  - Chain 4217 is `chain_mismatch`; build that value in the test from mppx's mainnet default, not from a literal in a source file.
  - Requirements whose amount moved give `amount_mismatch`.
- **Replay.** Settle with a `seen` store where the challenge id is already claimed returns `replay`, and mppx is never called.
- **Constructor.** It refuses a missing recipient, a malformed one and the zero address.
- **Stripe path.** Every existing Stripe test against the mock stays green, now with the `stripe` option set.
- The guard test stays and passes.

## Constraints

- **No browser** of any kind on this machine: no headless Chrome, Playwright, Puppeteer or screenshot tools. UI checks go back to the lane, which raises NEEDS-BROWSER.
- **Never run `mppx`** in any form: no `npx mppx`, no `validate`, no `account` and no payment. Never call any RPC or faucet. The network is the npm registry and localhost only.
- **No keys.** Never read an env file, a config directory, the keychain or a CLI config. The server smoke test uses throwaway values only, as below.
- **Scope.** No new dependencies. Change nothing outside the lease. Never stage `bun.lock`. TypeScript strict, no `any`.

## Acceptance

From the worktree root:

```
bun install && bun run typecheck && bun test packages/rail/src/mpp && bun test
MPP_SECRET_KEY="$(head -c 32 /dev/urandom | base64)" MPP_RECIPIENT=0x00000000000000000000000000000000000000aa bun scripts/mpp/server.ts 8799 &
sleep 2
curl -s -i http://localhost:8799/paid | head -20
curl -s -i http://localhost:8799/rail/paid | head -20
kill %1
```

- Every test passes, with none skipped.
- Both routes answer 402 with a `WWW-Authenticate: Payment` header for method `tempo`.
- Decode one challenge's request in the report: chain id 42431, the pathUSD currency, recipient `0x…aa` and amount `10000`.
- Commit on `cs/hd-06` with short present-tense messages ending `refs #5`, and no trailers. Write the report. Do not push, merge or deploy.

## Stop conditions

- mppx cannot build a Tempo charge method pinned to Moderato without an RPC call at construction: stop and report exactly what it calls.
- A change outside the lease looks necessary: stop and explain in the report.
