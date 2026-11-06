> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# Review d2c824c (PR 84, cs/hd-06, #5): the MPP rail on Tempo testnet

Reviewer: cs-w1. Result: **blockers=1 should-fix=2**.

- Scope: 48ecab5 (the rail), 3548f4f (per-offer payee and payer) and d2c824c (one shared Tempo method). This supersedes the REVIEW-REQs on 48ecab5 and 4ed51ea.
- Test: `W1 B17` in `packages/rail/src/mpp/test/w1-mpp.test.ts` on cs/w1 (3c21fbc). It fails. The rail is not wired into the hub yet; where a scenario runs through the hub, it is how `apps/hub/src/call.ts` would drive the rail.

## Blocker
**B17. Two 402s for one offer in one second are the same challenge, and the rail treats a challenge as one purchase.**

The problem:
- `challenge()` builds `expires` from the hub's whole-second clock and adds no per-issuance nonce. The HMAC covers realm, method, intent, request and expires, so the challenge id is a pure function of the offer and the second it was issued in.
- The replay store is keyed on that id: `verify` checks `seen.has(id)`, `settle` checks `seen.claim(id)`.
- Push-mode credentials (`{type: "hash"}`) are accepted, so the buyer's transfer is already on chain when the rail sees it. Two consequences:
  - **Collision.** Buyers A and B, or one agent making two parallel calls, get the same challenge. A settles. B's payment is refused as `replay`, after B's money has already moved, with a memo bound to that challenge so it can never be redeemed.
  - **Hijack.** Anyone who fetched that second's 402 holds the same challenge. Discovery hands challenges out without authentication. When A's transfer lands, they can present `{challenge, payload: {type: "hash", hash: <A's tx>}}` with no `source`. mppx takes the sender from the receipt, so it verifies, and they get the delivery A paid for. A then gets `replay`. It is a race, but nothing in the code stops it.

The test: two challenges issued in the same second; A's id is claimed; B's verify returns `replay`. Expected: a different id, and no replay for B. Once fixed, B's short hash is refused by mppx offline, so the test stays offline.

The fix:
- Bind a random nonce per issuance into the HMAC'd challenge (`meta` / `opaque`).
- Key the replay store on the transfer, as mppx does natively: the tx hash for push, the signed transaction for pull.
- Consider refusing push mode until a credential's payer is bound to its challenge.

## Should-fix
1. **Settle claims the id before mppx confirms and never releases it.**
   - The problem:
     - Push mode: a transient RPC error inside `broadcastCredential` (it re-reads the receipt) returns `payment_failed`. The id stays claimed, so every retry is `replay`, and the buyer's transfer is on chain and unredeemable.
     - The demo server then answers with a fresh 402. mppx's fetch wrapper pays a fresh challenge again, up to 3 rounds, so the buyer can be charged two or three times.
   - The fix: for push credentials, release the claim when re-verification fails without a definite on-chain refusal; mppx releases its own hash claim on failure. In the server, never answer a 402 after a settle that may have moved money.
2. **The reported payer is the credential's own claim.** `tempoPayer(credential.source)` is client-supplied and not compared with the transfer's sender. The hub would record it as the job's buyer, and ratings and the self-purchase rule key on that. Report the sender from the receipt, or check that `source` matches it.

## Notes
- `assertTempoRecipient` uses `getAddress`, which normalises but does not reject a wrong checksum. This fails closed for viem buyers.
- With Stripe on, a Tempo payment for an offer of 0.50 or more yields a slip describing the card leg: Stripe `networkId`, `usd`, cents. Stripe is off by default.

## Held
- **Binding:** the HMAC covers amount, currency, recipient, `externalId` (the offer hash) and chain 42431. Inspection rechecks each against the current requirements, and the recipient is pinned to the requirement's payee.
- **Payee:** each offer pays its own seller (`offer.payTo.mpp ?? offer.seller`); 48ecab5 paid the rail's one recipient.
- **Replay of one credential:** the same credential is refused once claimed, in one process, and the memo binding stops reuse across challenges.
- **Amounts:** pathUSD has 6 decimals, the same as offer units. The decimal round trip is exact. The 0.01 floor is enforced.
- **On chain:** settle re-reads hash credentials, and confirmation is waited for.
- **Stripe:** reachable only through the explicit `stripe` option.
