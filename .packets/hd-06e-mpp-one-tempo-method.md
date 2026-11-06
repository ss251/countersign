# hd-06e-mpp-one-tempo-method: one shared Tempo method per mpp rail, as decided

## Goal

This is the single corrective for hd-06d, tracked by issue #5. hd-06d made each mpp offer pay its own seller, correctly. It did so by building one mppx Tempo method and one `Mppx` instance **per payee**, cached in a `Map`. The lane has decided against that design; the decision and its evidence are below.

Replace the cache with **one** shared Tempo method and **one** `Mppx` instance per rail, built with **no recipient**. Every other behaviour from hd-06d stays exactly as it is:

- the per-offer payee and the stateless inspection;
- the payer taken from the source DID;
- the replay claim;
- the Stripe method behind its option;
- the hermetic hedera tests.

## The decision, and why

mppx 0.17.1, read and run on 06 Nov:

1. `dist/server/Mppx.js`, `prepareStandaloneCredential`: when `validateCredential` or `broadcastCredential` is called with **no route options**, the request it verifies is `credential.challenge.request`, the HMAC-verified challenge's own request. It never binds the method's construction-time defaults, such as the recipient.
2. `dist/tempo/server/Charge.js`: the expected on-chain transfer is built from `resolvedRequest.recipient`, the challenge's recipient.
3. Run on the build machine:
   - `tempo.charge({ testnet: true, currencies: [pathUSD], store })` constructs without a recipient;
   - `Challenge.fromMethod(method, { request: { recipient: B } })` yields a challenge for B, even from a method built with recipient A.

The comment in `rail.ts` that says "mppx keeps the configured recipient in the method's defaults … validate/broadcast pick the method built for the credential's payee" is therefore wrong for the way this rail calls mppx. Delete it.

## Lease

- `packages/rail/src/mpp/rail.ts` and `packages/rail/src/mpp/test/rail.test.ts`
- Report: `/Users/thescoho/Developer/countersign-mumbai/reports/hd-06e-mpp-one-tempo-method.md`

## Required

1. **In `createMppRail`, delete `tempoMethods`, `makeTempo` and `tempoFor`.** Build, once:

   ```ts
   const tempoCharge = tempo.charge({ testnet: true, currencies: [TEMPO_CURRENCY], store: Store.memory() })[0]!;
   const tempoMppx = options.tempoMppx ?? Mppx.create({ methods: [tempoCharge], secretKey, realm });
   ```

   Pass no `recipient` to `tempo.charge`.
2. **Challenge.** `Challenge.fromMethod(tempoCharge, { … request: { …, recipient: payee, … } })`, where `payee` is `tempoPayeeFor(offer)` as today. The challenge always names its payee explicitly.
3. **Verify.** `await tempoMppx.validateCredential(inspected.credential)`, with **no second argument**.
4. **Settle.** `await tempoMppx.broadcastCredential(inspected.credential)`, with **no second argument**.
5. **Test seam.** Add one option to `MppRailOptions`:

   ```ts
   /** Tests only: the mppx instance that validates and broadcasts Tempo credentials. */
   tempoMppx?: { validateCredential(credential: string): Promise<unknown>; broadcastCredential(credential: string): Promise<Receipt.Receipt> };
   ```

   Type it so the real `Mppx` instance satisfies it without a cast.
6. **Comment.** Above `tempoCharge`, three lines: one method for every payee, because mppx's standalone validate and broadcast verify against the HMAC-bound challenge's own recipient, and the rail's inspection pins that recipient to `requirements.payTo`.

## Tests (offline; no network, no RPC)

In `packages/rail/src/mpp/test/rail.test.ts`:

- **One instance serves two payees.**
  1. Build one rail with a fake `tempoMppx`. It records every credential it receives, and `broadcastCredential` returns `{ method: "tempo", reference: "0x" + "ab".repeat(32), status: "success", timestamp: new Date().toISOString() }`.
  2. Create two offers with different payees: offer A has `payTo.mpp = 0x…a1`, and offer B has no `payTo.mpp`, so it pays its `seller`, `0x…b2`.
  3. For each offer, build requirements with `rail.challenge`, then a Tempo credential with the existing helpers, then call `rail.verify` and `rail.settle`.
  4. Expect:
     - both settles succeed;
     - the fake received four calls in total, two validates and two broadcasts, on the **same** object;
     - each challenge's `request.recipient` equals its offer's payee.
- **Payee mismatch, no mppx call.** A credential whose challenge names payee A, presented against offer B's requirements, is refused as `offer_mismatch` before the fake is called.
- Every existing mpp test, and the mainnet guard test, passes unedited.

## Constraints

- **No browser** of any kind on this machine: no headless Chrome, Playwright, Puppeteer or screenshot tools. UI checks go back to the lane, which raises NEEDS-BROWSER.
- **Never run `mppx`** in any form. Never call an RPC. No keys.
- **Scope.** Change nothing outside the lease. Never stage `bun.lock`. TypeScript strict, no `any`.

## Acceptance

```
bun install && bun run typecheck && bun test packages/rail/src/mpp && bun test
```

Every test passes, with none skipped. Commit on `cs/hd-06d` with short present-tense messages ending `refs #5`, and no trailers. Write the report. Do not push, merge or deploy.
