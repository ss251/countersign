# hd-06d-mpp-payee: each offer is paid to its own seller on Tempo, and the slip names the payer

## Goal

The mpp rail settles for real on Tempo testnet (hd-06c). Before the hub can list mpp offers (cs-16), the money has to go to the right place and the slip has to say who paid.

- **Per-offer payee.** Today every Tempo challenge pays the one `recipient` the rail was built with. On a marketplace, an offer's payee is its seller: `offer.payTo.mpp` when the seller set one, otherwise the seller's identity address (`offer.seller`), which is an EVM address and valid on Tempo.
- **Payer on the settle result.** `SettleResult.payer` and `VerifyResult.payer` should carry the Tempo payer's address, so the hub can record the buyer on the job and the slip.
- **Drop the cast.** `gasPaidBy: "buyer"` is now part of the interface (cs/int 5240abd), so `MPP_DECLARATION` no longer needs the `satisfies … as RailDeclaration` cast.

Tracked by issue #5.

## Lease

- `packages/rail/src/mpp/**`, tests included
- `scripts/mpp/server.ts`, only if a change above needs it
- `docs/mpp.md`: the challenge and receipt mapping sections only
- Report: `/Users/thescoho/Developer/countersign-mumbai/reports/hd-06d-mpp-payee.md`

## Context

Read first: `packages/rail/src/mpp/rail.ts` (`createMppRail`, `inspectMppPayment`, `challenge`, `verify`, `settle`), `constants.ts`, `test/rail.test.ts`, and `packages/rail/src/rail.ts` for `RailDeclaration`, `VerifyResult` and `SettleResult`. The mppx Tempo client puts the payer in the credential's `source` as a DID, `did:pkh:eip155:<chainId>:<address>`; see `Proof.proofSource` in mppx's `dist/tempo/Proof.js`. mppx's server verification checks the transfer sender against that source.

## Required

1. **Payee.**
   - `MppRailOptions.recipient` becomes optional. It is used only when an offer names no payee at all, which cannot happen for a valid offer because `seller` is always set. Keep it for the demo server.
   - The Tempo challenge's `recipient` and `requirements.payTo` are `offer.payTo?.mpp ?? offer.seller`, validated with `assertTempoRecipient`. An offer with an invalid mpp payee gets no Tempo challenge; throw a clear error from `challenge`, as other rails do for an unusable offer.
2. **Inspection.**
   - For Tempo, `challenge.request.recipient` must equal `requirements.payTo`, compared case-insensitively after `getAddress`. A mismatch is `offer_mismatch`.
   - Remove the comparison against the rail-level recipient.
   - The tempo charge method that mppx uses for `validateCredential` and `broadcastCredential` must accept the per-offer recipient. If mppx binds the recipient at method construction, build the server method per recipient and cache it by address, rather than one per rail. Read `dist/tempo/server/Charge.d.ts` to decide, and say which you did in the report.
3. **Payer.**
   - Parse the credential's `source` when it is a `did:pkh:eip155:42431:<address>` DID, and return it, checksummed, as `payer` from `verify` and from a successful `settle`.
   - A missing or malformed source is not a refusal by itself: mppx still verifies the transfer. Leave `payer` unset then.
4. **Declaration.** Write `MPP_DECLARATION` as a plain `RailDeclaration` object literal with `gasPaidBy: "buyer"`, and delete `DECLARED` and the cast.
5. **Server.** `scripts/mpp/server.ts`'s demo offer keeps `payTo: { mpp: recipient }`, so its behaviour does not change.

## Tests (offline; no network, no RPC)

- **Payee.**
  - An offer with `payTo.mpp` gets a Tempo challenge to that address.
  - An offer without `payTo.mpp` gets one to `offer.seller`.
  - An offer whose `payTo.mpp` is not a valid address throws from `challenge`.
- **Inspection.**
  - A credential whose challenge recipient differs from `requirements.payTo` is `offer_mismatch`.
  - The per-offer payee survives the stateless retry: the challenge is issued once, then the credential is inspected against freshly issued requirements for the same offer.
- **Payer.** The source DID becomes `payer` in `verify`. Settle with a pre-claimed id still returns `replay` without calling mppx.
- `MPP_DECLARATION.gasPaidBy === "buyer"`, with no cast left in the source.
- Every existing test, and the mainnet guard test, stays green.

## Constraints

- **No browser** of any kind on this machine: no headless Chrome, Playwright, Puppeteer or screenshot tools. UI checks go back to the lane, which raises NEEDS-BROWSER.
- **Never run `mppx`** in any form. Never call an RPC or faucet. No keys: never read an env file, a config directory or the keychain.
- **Scope.** Change nothing outside the lease. Never stage `bun.lock`. No new dependencies. TypeScript strict, no `any`.

## Acceptance

```
bun install && bun run typecheck && bun test packages/rail/src/mpp && bun test
```

Every test passes, with none skipped. Commit on `cs/hd-06` with short present-tense messages ending `refs #5`, and no trailers. Write the report. Do not push, merge or deploy.

## Stop conditions

- mppx cannot verify a credential for a recipient chosen per request without a new method instance per recipient, and per-recipient instances break replay protection: stop and explain.
- A change outside the lease looks necessary: stop and explain in the report.
