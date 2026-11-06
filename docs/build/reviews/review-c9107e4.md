> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# Re-review c9107e4 (cs/cs-19, cs-19b, #93): the B16 corrective and the deploy gate

Reviewer: cs-w1. Result: **blockers=0 should-fix=1 (deferred by decision)**.

On c9107e4 with my `W1Attacks.t.sol` added, forge gives 57 pass and 0 fail. That includes `W1Bond.t.sol`; its only change is the deposit helper, adapted to the salt API, with both assertions unchanged. The buyer and escrow-rail tests give 63 pass and 0 fail.

## B16: closed
- `depositBond` now takes a `salt` and derives the token nonce as `keccak256(abi.encode(BOND_DEPOSIT_TYPEHASH, payee, amount, salt))`.
- A jobId (an EIP-712 Countersign digest) can therefore never be a valid deposit nonce, so a countersignature replayed into `depositBond` credits nothing and still funds its job.
- The reverse also holds: a deposit authorization can never fund a job.
- Deposits stay relayable.

## Deploy gate: passes
`fundBonded` is arbiter-only, so a stranger cannot lock a seller's free bond. `fund` stays open. A front-run `fund` makes the arbiter's `fundBonded` revert with `JobExists`, which is a failed settle, never a silently unbonded job.

## Should-fix from 8dbb791
1. **The arbiter key holds every seller's free bond.** Accepted for this deployment and written down in D11, amended: keep bonds small, and seller-signed locks come later. That is a legitimate call. The threat model and the seller guide should say it plainly before bonds are advertised.
2. **Fixed.** `resume` counts an on-chain Failed (4) like Refunded (3), checked on chain, with the reservation id. A hub that says "failed" for a job the chain still holds as Funded gets no journal entry, and the spend stays counted.
3. **Deferred to after the redeploy, by decision.** The buyer and the verifier should check `bondOfJob(jobId)` against the offer's bond.
