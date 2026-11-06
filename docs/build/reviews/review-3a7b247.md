> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review 3a7b247 (PR 164, option (d), the forced-default fix): a bonded job is funded only by the arbiter

Reviewer: cs-w1. Result: **blockers=0 should-fix=1**. This is the re-review of the one-line contract change since my 9240aec review (1050c01, ea9128f, a6f5335, 3a7b247), with every changed test line read.

## The contract line
1. `fund` now reverts `NotArbiter()` when `cs.bond != 0` and the caller is not the arbiter. An unbonded job stays open to any caller.
2. **This closes the forced default.**
   - `fund` is the only path in v2 that moves a payee's free bond into a job (`bondOf[cs.payee] = available - cs.bond`).
   - The buyer can no longer open a bonded job the seller's runner never saw and then take the amount plus the bond after `settleBy`.
   - The buyer cannot dodge the check by countersigning bond 0 either. The bond is inside the jobId (M1), so that would be a different job with nothing at stake.
3. **The check needs no particular order.** It reverts before the bond moves, and any revert unwinds the token pull.
4. **`ForcedDefault.t.sol` covers the new rule.** It holds 4 tests, red before the fix as the report shows:
   - a stranger cannot fund a bonded job;
   - the buyer cannot fund a bonded job;
   - the arbiter funds one and locks the bond;
   - an unbonded job stays open to anyone.
5. **Tests on 3a7b247:** `forge test` for ForcedDefault, AuditFixes, Bond and Acceptance gives 52 pass, 0 fail.

## Every changed test line
Each edit is a caller switch to `vm.prank(arbiter)` on a bonded `fund`, or a comment that now says the arbiter funds. No assertion, expected value or revert selector changed.
- **The BondMissing test** keeps its expected `BondMissing`. The arbiter prank is what lets that check be reached at all.
- **The conservation handler** pranks only when `bond != 0`, so unbonded funding stays open in the invariant run.
- **The H1 loop** pranks after building each countersignature, so the prank lands on `fund`.

## Should-fix
1. **`test_M1_front_run_with_the_same_terms_is_harmless` no longer tests a front-run.**
   - Its attacker was switched to the arbiter, and its message still says "the stranger opened exactly the signed job".
   - Under (d), the M1 property is that a stranger's front-run of a bonded job reverts `NotArbiter`, and the arbiter's later fund opens exactly the signed job.
   - orch-cs's corrective (cs-27b, tests only) does exactly this:
     - it restores the attacker and expects `NotArbiter`;
     - the arbiter then funds;
     - every original assertion is kept.
   - I agree, and I re-read it when it lands.

## Notes
1. **Deploy `ARBITER` as the hub's escrow submitter.**
   - The rail submits `fund` from its single `submitter` account. That one account also submits v1's arbiter-only `fundBonded` and `failDelivery`.
   - If `Deploy.s.sol` gets any other `ARBITER`, every bonded v2 purchase reverts `NotArbiter` at settle.
   - The Whitechain deploy defaults `WC_ARBITER_ADDRESS` to `payees[0]`. If Whitechain moves to v2 with bonds, its relay's submitter must be that address.
2. **"After the payee's runner accepted it" is the hub's rule, not the contract's.**
   - The hub refuses with 503 seller-offline before the 402 when the offer's runner is not connected. It then funds and dispatches.
   - There is no runner acknowledgement before `fund`.
3. **A fault on the hub's side still costs the seller its bond on v2.**
   - When the hub drops a dispatch or cuts it short (fault `hub`), `failedDelivery` leaves the job to the deadline refund.
   - On v2, that refund after `settleBy` pays the buyer the amount plus the bond. So a hub restart between `fund` and dispatch, or a dropped runner connection, forfeits a seller's bond for something the seller did not do.
   - `bond.ts` still says those cases "return the bond to the seller", which was v1's behaviour.
   - The runner half of (d), cs-29 runner-Cancel, is the right place to close this. The runner should cancel a job it received and could not finish. It should also watch `Funded` events for its payee and cancel any job it never received.
   - Before bonded v2 offers go live, cs-29 should cover both cases and correct that comment.
