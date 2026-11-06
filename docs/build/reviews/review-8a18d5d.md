> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review 8a18d5d — buyer agent (payer, buy, journal, envelope use, resume, cli)

Reviewer: cs-w1. Result: **blockers=1 should-fix=3**. Tests: `packages/buyer/test/w1-attacks.test.ts` on `cs/w1`; the honest-terms case passes, the four tamper cases fail.

## Blocker
**B4. The buyer countersigns whatever the hub's 402 says.** `buy()` fetches the offer, then signs `entry` from the hub's 402 without comparing it to that offer. It checks the envelope against `entry.amount` and `offer.seller`, but signs `req.payTo`, `req.amount`, `extra.offerHash` and `extra.deadlineSeconds` as given. A hostile hub, or anyone on the path, can:
- set `payTo` to its own address while the envelope sees the allowlisted `offer.seller`, so the allowlist and per-merchant limit are checked against the wrong party;
- raise `amount` above `offer.price` (up to the cap);
- sign for a different `offerHash` than the one requested;
- set `deadlineSeconds` huge, locking the buyer's funds until then.
Tests (all expect refusal before signing and no `countersigned` journal entry; all get the signature): payTo, amount, offerHash, deadline. Fix: before `payer.pay`, require `entry.payTo == (offer.payTo?.[rail] ?? offer.seller)`, `entry.amount == offer.price` (scaled for the rail's decimals), `extra.offerHash == requested offerHash`, `extra.deadlineSeconds <= offer.deadline + small`, and `entry.maxTimeoutSeconds` consistent.

## Should-fix
1. **Escrow, token and chain are hub-chosen.** `extra.escrow`, `req.asset` and `extra.chainId` go straight into the EIP-3009 `to`/domain. An attacker-chosen `escrow` is a plain theft path: `receiveWithAuthorization` pays whoever the signature names, and the signer cannot tell. The buyer needs a pinned table of known rails (chainId, escrow, token) and must refuse anything else. Not committed as a test because the trusted set is a config decision; treat it as part of B4's fix.
2. **Spend is counted from the journal only.** `journal.spend()` counts `countersigned` entries, refunds subtract on a `refunded` entry. If the journal file is lost, edited or concurrent calls race (two `buy()` runs read `spend()` before either appends), the cap is exceeded. Append the reservation under a lock before signing.
3. **`resume` trusts the hub for refunds.** A hub that reports `refunded` makes the journal subtract the spend with no chain check, restoring budget for money that never came back. Read `escrow.jobOf` on chain, or require the refund tx to verify.

## Attacked, held
- Envelope order: revoked, expiry, allowlist, cap, merchant limit and askAbove are all checked before `payer.pay`; refusals and holds are journalled.
- A bad slip (hash, seller signature, offerHash, jobId, amount, input and output hashes, output schema) is rejected before the journal says released.
- Salt is 256 random bits; the nonce is the jobId, so a countersignature cannot be replayed on another escrow or chain.
