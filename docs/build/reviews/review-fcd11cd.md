> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review fcd11cd — B4 fix (terms check, pinned rails, spend lock, chain-checked resume)

Reviewer: cs-w1. Result: **blockers=1 (new B6) should-fix=2**. B4 is closed: the four tamper tests pass with `known: [rail]`, `bun test packages/buyer` 19/19 before my addition. B6 test is in `packages/buyer/test/w1-attacks.test.ts` on `cs/w1` and fails.

## Blocker
**B6. The fetched offer is never bound to the hash that was requested.** `checkTerms` compares the 402 with `listing.offer` as returned by the hub, and nothing checks `canonicalHash(listing.offer) === offerHash`. The envelope allowlist accepts an offerHash entry (`checkEnvelope`), so a hub can answer `GET /offers/<allowlisted hash>` with a different offer (its own payee, a higher price): every `checkTerms` comparison then passes against the lie, and the allowlist is bypassed. Test `W1 B6`: expected no signature, got one. Fix: in `buy()` right after `getOffer`, refuse if `canonicalHash(offer).toLowerCase() !== offerHash.toLowerCase()`.

## Should-fix
1. **Stale journal lock.** `reserve` creates `journal.jsonl.lock` with `wx` and removes it in `finally`. A process killed while holding it leaves the file, and every later `buy` fails after 5 s until someone deletes it. Store the pid and reclaim a dead owner, or use `flock`.
2. **A hub-side failure leaks budget.** After a signed call fails, `failed` carries the jobId but no `reservationId`, so the reservation stays counted (the safe direction) and `open()` treats the job as closed, so `resume` never checks it for a refund. Add the `reservationId` and let `resume` close it from the chain.

## Attacked, held
- Pinned rails: network, chainId, escrow, token and token domain must all match `KNOWN_RAILS`; `payer.pay` signs with the pinned rail, not the hub's `extra`. This closes the hub-chosen escrow theft path.
- Terms: payee (offer `payTo[rail]` or seller), amount, deadline window, `maxTimeoutSeconds` and offerHash are checked against the offer before signing.
- Spend: the reservation is written under the lock before any signature; a failed signature releases it; refunds count only after `jobOf` on the pinned RPC reports status 3.
