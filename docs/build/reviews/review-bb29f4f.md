> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review bb29f4f (#164 post-fix head, cs/164-g2: cs-31's four Grok fixes plus cs-31b's "bond implies window")

Reviewer: cs-w1. Result: **blockers=0 should-fix=1** for the contract half of STEER-2205's joint review. The runner-and-hub Lock (cs-33) is not posted yet. My verdict on it, and on how it meets this contract, follows when it lands.

## The fixes, against the decided interface
1. **High 1, the Lock.**
   - `fund(offerHash, cs, lockSig)` no longer checks the arbiter. When `cs.bond != 0` it requires `SignatureChecker.isValidSignatureNow(cs.payee, _hashTypedDataV4(keccak256(abi.encode(LOCK_TYPEHASH, jobId))), lockSig)`, else `LockMissing(jobId)`. This runs after the terms check and before `bondOf` is debited.
   - `failDelivery` stays the arbiter's only power.
2. **High 2, cancel.** `cancel` opens only a Funded job. A Delivered job reverts `NotOpen`, so releasing and then cancelling can no longer dodge a dispute or a forfeit.
3. **Medium, dispute.** `dispute(jobId, signedStatus, buyerSig)` refuses `uint8(status) != signedStatus` with `StatusMismatch`, and the buyer's digest covers `(jobId, status)`.
4. **Low, the terms check.** It now also runs when `termsOf[payee][offerHash].price != 0`, so a registered offer funds only on its exact terms.
5. **Bond implies window (the project lead's option (a)).** `setTerms` reverts `BondNeedsWindow` on a bond with window 0. Funding cannot route around it: a bond moves only on a job that matches its payee's registered terms, and those terms can no longer pair a bond with window 0.
6. **The type strings** are exactly `Lock(bytes32 jobId)` and `Dispute(bytes32 jobId,uint8 status)`. The domain is still `EIP712("Countersign", "1")`, which is core's `escrowDomain` (`ESCROW_DOMAIN_NAME`, `ESCROW_DOMAIN_VERSION`).

## Byte for byte against the fleet
I compiled bb29f4f and compared `forge inspect` method identifiers and ABI outputs against the TypeScript ABIs with viem.
- **cs-32's `escrowV2Abi` (f5ecf01)** matches every function in selector and output:
  - `fund(bytes32,(…),bytes)` = aa393653;
  - `dispute(bytes32,uint8,bytes)` = e4f129ae;
  - `accept`, `releaseAfterWindow`, `reviewOf`, `sweepToll`, `setTerms` and `bondOfJob`.
- **wc-09c's** `escrowV2Abi` is byte-identical to cs-32's, so the Whitechain relay and rail are covered by the same check.
- **The v1 ABI calls the rail makes on v2** (`release`, `cancel`, `refund`, `failDelivery`, `jobOf`, `bondOf`, `domainSeparator`) all match too.

## Tests
- **Red before, green after.**
  - cs-31's `GrokFindings.t.sol` is 0 pass and 4 fail on d4cb68b (the 81df37e contract), one per finding.
  - The bond-implies-window test fails on ae0e7f9, before its fix.
  - Between red and green the findings tests were only tightened: bare `expectRevert()` became the exact errors, and the bond assertions were added.
- **The post-fix head.** On bb29f4f, GrokFindings, Lock, AuditFixes, Bond, Acceptance, CountersignedEscrow, W1Bond, Parity and FeeSplit give 93 pass and 0 fail.
- **My own adversarial suite** (`contracts/w1/W1V21.t.sol` on `cs/w1`, 68619b6) gives 13 pass and 0 fail on bb29f4f. It covers:
  - no lock or a wrong lock (none, the arbiter's, the buyer's, the payee's for another job, the payee's under another escrow), with no bond moving;
  - Grok's arbiter-plus-buyer trace refused;
  - anyone funding exactly the signed job once with the lock, and an unbonded job ignoring the lock;
  - release then cancel, and a late release then cancel, both NotOpen, with the dispute then forfeiting;
  - an honest late release keeping its bond once the window passes;
  - each Dispute signature having one outcome only;
  - a registered offer refusing off-terms bond-0 funding;
  - `BondNeedsWindow`;
  - the type strings on the compiled contract.

## Should-fix
1. **Restore H1's bond property in its windowed form.**
   - cs-31b turned `test_H1_failDelivery_and_release_land_until_settleBy` into an unbonded test and deleted `assertEq(escrow.bondOf(seller), BOND, "an honest late release keeps the bond")`.
   - Under "bond implies window" that property still exists. A bonded job released late, by `settleBy`, is Delivered, and once the window passes with no dispute the seller gets the payment and its whole bond back.
   - My `test_W1_H2_an_honest_late_release_keeps_the_bond_once_the_window_passes` passes on this head. Put it, or an equivalent, back into AuditFixes so the property stays in the suite the final audits read.
   - `test_L1_blocklisted_treasury_does_not_block_release` also lost an incidental bond assertion. That one is harmless.

## Notes
1. **The floor question is still with the project lead.** `BondNeedsWindow` refuses window 0 only, so a 1-second window passes, and that gives the buyer no real time to dispute. Whatever floor is chosen must be the same number in the contract, the hub's validation and the wizard (#210).
2. **The Lock fixes my 3a7b247 note about hub-side faults.** A runner now signs `Lock(jobId)` for every bonded job it accepts, so it knows each job it can still cancel while Funded (cs-29). On cs-33 I check that the runner recomputes the job id from terms it has checked itself (price, bond, window, a deadline it can meet) before it signs.
3. **`ARBITER` is now only the failDelivery key.** Funding no longer needs it.
