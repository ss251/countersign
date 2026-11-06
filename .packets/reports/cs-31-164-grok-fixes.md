# cs-31-164-grok-fixes — the four audit fixes, red then green (refs #98)

Branch: `cs/164-g`, created from `raj/98-escrow-v2` at `81df37e`.
No `docs/audits/2026-11-06-grok-escrow-v2.md` exists in this worktree, so the packet's restatement was the source.

## What changed

The captain adopted the audit's four fixes, replacing option (d):

1. `fund` is open to anyone again. A bonded job also needs the payee's `Lock(jobId)`
   signature; `LOCK_TYPEHASH = keccak256("Lock(bytes32 jobId)")`, checked before `bondOf`
   is read. `lockSig` is ignored when `cs.bond == 0`.
2. `cancel` unwinds only a `Funded` job. A `Delivered` job is closed only by `accept`,
   `dispute`, `releaseAfterWindow` or `failDelivery`.
3. `DISPUTE_TYPEHASH = keccak256("Dispute(bytes32 jobId,uint8 status)")`, and `dispute`
   takes the status the buyer signed. A signature made while `Funded` can no longer
   forfeit the bond after delivery: it reverts `StatusMismatch`.
4. A registered offer always funds on its terms: the terms check also runs when
   `termsOf[payee][offerHash].price != 0`, even if the countersignature carries bond 0
   and window 0.

## Step 1 — red tests on 81df37e

`contracts/test/GrokFindings.t.sol` was created against the 81df37e interface and
committed alone as `d4cb68b`:

```
add the four audit findings as failing tests on 81df37e (refs #98)
```

Command:

```
forge test --match-path contracts/test/GrokFindings.t.sol
```

Output (all four fail because the call each expects to revert succeeds):

```
Ran 4 tests for contracts/test/GrokFindings.t.sol:GrokFindingsTest
[FAIL: next call did not revert as expected] test_H1_a_bond_moves_only_with_the_payee_lock() (gas: 356532)
[FAIL: next call did not revert as expected] test_H2_a_delivered_job_cannot_be_cancelled() (gas: 474360)
[FAIL: next call did not revert as expected] test_L_a_registered_bonded_offer_cannot_be_funded_with_bond_zero() (gas: 329936)
[FAIL: next call did not revert as expected] test_M_a_funded_time_dispute_signature_cannot_forfeit_after_delivery() (gas: 468302)
Suite result: FAILED. 0 passed; 4 failed; 0 skipped; finished in 6.40ms (13.00ms CPU time)

Ran 1 test suite in 114.24ms (6.40ms CPU time): 0 tests passed, 4 failed, 0 skipped (4 total tests)
```

Each test failed for its finding: H1's bonded fund moved the bond without a lock, H2's
cancel on a `Delivered` job returned the bond, M's funded-time dispute signature
forfeited the bond after delivery, and L funded a registered bonded offer with bond 0.

## Step 2/3 — green

After the contract and test updates:

```
bun install --linker hoisted && forge build && forge test
```

Final counts:

```
Ran 10 test suites in 350.69ms (690.41ms CPU time): 92 tests passed, 0 failed, 0 skipped (92 total tests)
```

Per suite:

| Suite | Passed |
| --- | --- |
| `ParityTest` | 2 |
| `FeeSplitTest` | 4 |
| `W1BondTest` | 2 |
| `GrokFindingsTest` | 4 |
| `LockTest` | 8 |
| `AcceptanceTest` | 14 |
| `BondTest` | 15 |
| `CountersignedEscrowTest` | 24 |
| `AuditFixesTest` | 18 |
| `ConservationInvariantTest` (`invariant_conservation`, 64 × 64) | 1 |
| **Total** | **92 passed, 0 failed, 0 skipped** |

The four fixed tests now pass:

```
[PASS] test_H1_a_bond_moves_only_with_the_payee_lock() (gas: 364188)
[PASS] test_H2_a_delivered_job_cannot_be_cancelled() (gas: 422307)
[PASS] test_L_a_registered_bonded_offer_cannot_be_funded_with_bond_zero() (gas: 194098)
[PASS] test_M_a_funded_time_dispute_signature_cannot_forfeit_after_delivery() (gas: 427630)
```

## Changed test lines

All line numbers below are in the final files.

### `contracts/test/Acceptance.t.sol`

| Line | Change |
| --- | --- |
| 106 | `_disputeSig(uint256 key, bytes32 jobId)` → `_disputeSig(uint256 key, bytes32 jobId, uint8 status)`; digest now `abi.encode(DISPUTE_TYPEHASH, jobId, status)` |
| 110 | added `_lockSig(uint256 payeeKey, bytes32 jobId)` |
| 129 | added `jobId = escrow.jobIdFor(OFFER, buyer, seller, PRICE, cs.deadline, cs.salt, BOND, WINDOW);` |
| 131 | `escrow.fund(OFFER, cs)` → `escrow.fund(OFFER, cs, _lockSig(sellerKey, jobId))` |
| 202 | added `bytes memory sig = _disputeSig(buyerKey, jobId, uint8(Status.Delivered));` (was inline) |
| 212 | `escrow.dispute(jobId, _disputeSig(buyerKey, jobId))` → `escrow.dispute(jobId, uint8(Status.Delivered), sig)` |
| 226 | `escrow.dispute(jobId, "")` → `escrow.dispute(jobId, uint8(Status.Funded), "")` |
| 287 | `_disputeSig(buyerKey, jobId)` → `_disputeSig(buyerKey, jobId, uint8(Status.Delivered))` |
| 289 | `escrow.dispute(jobId, sig)` → `escrow.dispute(jobId, uint8(Status.Delivered), sig)` |
| 298 | `escrow.dispute(jobId, "")` → `escrow.dispute(jobId, uint8(Status.Funded), "")` |
| 306 | `_disputeSig(strangerKey, jobId)` → `_disputeSig(strangerKey, jobId, uint8(Status.Delivered))` |
| 307 | `_disputeSig(sellerKey, jobId)` → `_disputeSig(sellerKey, jobId, uint8(Status.Delivered))` |
| 311 | `escrow.dispute(jobId, "")` → `escrow.dispute(jobId, uint8(Status.Delivered), "")` |
| 313 | `escrow.dispute(jobId, byStranger)` → `escrow.dispute(jobId, uint8(Status.Delivered), byStranger)` |
| 315 | `escrow.dispute(jobId, bySeller)` → `escrow.dispute(jobId, uint8(Status.Delivered), bySeller)` |
| 330 | `escrow.dispute(jobId, buyersAccept)` → `escrow.dispute(jobId, uint8(Status.Delivered), buyersAccept)` |
| 340 | added `bytes32 jobId = escrow.jobIdFor(OFFER, buyer, seller, PRICE, cs.deadline, cs.salt, BOND, 0);` |
| 342 | `escrow.fund(OFFER, cs)` → `escrow.fund(OFFER, cs, _lockSig(sellerKey, jobId))` |

### `contracts/test/AuditFixes.t.sol`

| Line | Change |
| --- | --- |
| 70 | added `_lockSig` to `EscrowSigning` |
| 141 | `_fundJob`: `escrow.fund(OFFER, cs)` → `escrow.fund(OFFER, cs, bond == 0 ? bytes("") : _lockSig(sellerKey, jobId))` |
| 152 | `_disputeSig(bytes32)` → `_disputeSig(bytes32, uint8 signedStatus)`; digest covers the status |
| 178, 181 | `test_C1_no_bond_without_registered_terms`: hoisted `lockSig`; fund gains the lock |
| 196, 198 | `test_C1_each_term_must_match`: hoisted `lockSig`; first fund gains the lock |
| 201, 203 | second term mismatch: reassigned `lockSig`; fund gains the lock |
| 206, 208 | third term mismatch: reassigned `lockSig`; fund gains the lock |
| 212, 214 | fourth term mismatch: reassigned `lockSig`; fund gains the lock |
| 217, 219 | fifth term mismatch: reassigned `lockSig`; fund gains the lock |
| 227 | exact-terms fund gains `_lockSig(sellerKey, jobId)` |
| 251, 253 | `test_C1_only_the_payee_sets_its_terms`: hoisted `lockSig`; fund gains the lock |
| 281 | `test_C1_registered_terms_lock_exactly_the_bond`: fund gains `_lockSig(sellerKey, jobId)` |
| 304 | `test_M1_front_run_with_other_terms_fails`: stripped-bond fund gains `""` |
| 311, 314 | unwindowed variant: hoisted `unwindowedLock`; fund gains the lock |
| 324 | M1 same-terms: added `lockSig = _lockSig(sellerKey, expected)` |
| 327 | M1 same-terms: the attacker's front-run is restored: `bytes32 jobId = escrow.fund(OFFER, cs, lockSig)` |
| 330 | M1 same-terms: message restored to `"the stranger opened exactly the signed job"` |
| 332–335 | M1 same-terms: added assertions `job.deadline`, `job.status == Funded`, `job.offerHash`, `job.slipHash == 0` (original buyer/payee/amount/bond/window assertions kept) |
| 344 | M1 same-terms replay fund gains `lockSig` |
| — | M1 same-terms: removed the option-(d) `vm.expectRevert(NotArbiter)` and the arbiter-only fund; the attacker now opens the job |
| 406 | `test_dispute_inside_the_window...`: `_disputeSig(jobId)` → `_disputeSig(jobId, uint8(Status.Delivered))` |
| 416 | `escrow.dispute(jobId, sig)` → `escrow.dispute(jobId, uint8(Status.Delivered), sig)` |
| 436 | `test_dispute_before_delivery...`: `escrow.dispute(jobId, "")` → `escrow.dispute(jobId, uint8(Status.Funded), "")` |
| 470 | `test_H1_failDelivery_and_release...` loop fund gains `_lockSig(sellerKey, jobId)` |
| 529 | fuzz branch 1: `dispute` call gains `uint8(Status.Funded)` and the signature covers it |
| 550 | fuzz branch 5: `dispute` call gains `uint8(Status.Delivered)` and the signature covers it |
| 600 | `test_L2_the_payee_cannot_be_the_escrow`: fund gains `""` |
| 658 | `ConservationHandler.fund`: fund gains `""` / `_lockSig` by bond |
| 685 | `ConservationHandler.dispute`: `escrow.dispute(jobId, uint8(escrow.jobOf(jobId).status), "")` |

### `contracts/test/Bond.t.sol`

| Line | Change |
| --- | --- |
| 109 | added `_lockSig` |
| 143 | `_fundBonded`: added `expected = escrow.jobIdFor(...)` |
| 144 | `escrow.fund(OFFER, cs)` → `escrow.fund(OFFER, cs, _lockSig(sellerKey, expected))` |
| 243 | `test_fund_bonded_refuses_more_than_the_free_bond`: hoisted `lockSig` |
| 246 | fund gains `lockSig` |
| 293 | `test_a_locked_bond_cannot_be_withdrawn...`: added `expected` jobId |
| 294 | fund gains `_lockSig(sellerKey, expected)` |

### `contracts/test/CountersignedEscrow.t.sol`

All 13 `escrow.fund` calls gained a third argument. Every job in this file is unbonded, so
every one passes `""`:

| Lines |
| --- |
| 95, 105, 140, 145, 154, 209, 244, 252, 260, 268, 275, 282, 337 |

### `contracts/test/W1Bond.t.sol`

| Line | Change |
| --- | --- |
| 97 | unbonded fund gains `""` |
| 114 | the stranger's bonded `junk` fund gains `""` (the attacker has no payee lock, which is the point of the test) |

### `contracts/test/GrokFindings.t.sol` (red → green)

| Line | Change |
| --- | --- |
| 128 | `_disputeSig(bytes32)` → `_disputeSig(bytes32, uint8 signedStatus)` |
| 132 | added `_lockSig` |
| 145–149 | H1: capture `jobId`; `vm.expectRevert()` → `vm.expectRevert(LockMissing(jobId))`; fund passes `""` |
| 153–158 | H1 positive case: a `stranger` funds with `_lockSig(sellerKey, jobId)`; asserts `bondOf(seller) == 0` and `bondOfJob(jobId) == BOND` |
| 168 | H2: fund gains the payee lock |
| 172 | H2: `vm.expectRevert()` → `vm.expectRevert(NotOpen(jobId))` |
| 185 | M: fund gains the payee lock |
| 187 | M: the signature covers `uint8(Status.Funded)` |
| 190–194 | M: `vm.expectRevert()` → `vm.expectRevert(StatusMismatch(jobId, uint8(Status.Funded)))` |
| 197 | M: `escrow.dispute(jobId, fundedSig)` → `escrow.dispute(jobId, uint8(Status.Funded), fundedSig)` |
| 209 | L: fund passes `""` |
| 211 | L: `vm.expectRevert()` → `vm.expectRevert(TermsMismatch(jobId))` |

### `contracts/test/ForcedDefault.t.sol` → `contracts/test/Lock.t.sol`

`ForcedDefault.t.sol` is deleted, because the captain replaced option (d).
`Lock.t.sol` adds eight tests:

1. `test_a_bonded_fund_without_a_lock_reverts` — `LockMissing`.
2. `test_a_lock_signed_by_anyone_but_the_payee_reverts` — buyer-signed lock, `LockMissing`.
3. `test_a_stranger_funds_with_the_payees_lock` — bond locks.
4. `test_the_buyer_funds_with_the_payees_lock` — bond locks.
5. `test_the_arbiter_funds_with_the_payees_lock` — bond locks.
6. `test_an_unbonded_fund_ignores_the_lock_signature` — junk `lockSig` accepted.
7. `test_the_arbiter_cannot_fund_a_bonded_job_the_payee_never_locked` — forced default closed.
8. `test_the_buyer_cannot_fund_a_bonded_job_the_payee_never_locked` — forced default closed.

### Delivered-job cancels that expected success

None existed in the tests at 81df37e. Every existing `cancel` test operates on a
`Funded` job, so no success expectation needed to be changed. The only new Delivered-cancel
expectation is H2 above.

## TypeScript

`bun test` was run once from the worktree root after the final contract state:

```
 967 pass
 3 skip
 2 fail
 3710 expect() calls
Ran 972 tests across 107 files. [19.88s]
```

The two failures are both pre-existing, unrelated to the escrow interface:

| Test | Error |
| --- | --- |
| `packages/identity/test/erc8004.test.ts:224` — `ERC-8004 on anvil > feedback built from a released slip is readable` | `expect(received).toHaveLength(expected)` — expected 1, received 0 |
| `packages/identity/test/erc8004.test.ts:243` — `ERC-8004 on anvil > only feedback from the slip's buyer with the slip's hash is earned` | `expect(received).toHaveLength(expected)` — expected 1, received 0 |

I reproduced both on a separate worktree at `81df37e` (no stash used); the same two tests
fail there with the same errors. They exercise `packages/identity` registry feedback, not
escrow funding or disputes.

The TypeScript tests named in the packet do **not** fail on this branch:

- `packages/rail/test/escrow.test.ts`, `packages/runner/test/bond.test.ts`,
  `packages/verify/test/onchain.test.ts`: 15 tests, all pass.
- `packages/relay`: 190 tests, all pass.

They deploy `CountersignedEscrowV1` from `contracts/test/fixtures/` with the frozen v1
`escrowAbi`, not the v2 contract, so the changed `fund`/`dispute` selectors never reach
them. There are zero TypeScript failures caused by this interface change; the packet's
expected break does not occur until cs-32 regenerates the rail ABI against v2. No
TypeScript was touched.

One flaky failure appeared in the first full `bun test` run and not the final one:
`packages/runner/test/funding.test.ts > sends fail and never spawns the child when the job is not funded`
timed out at 9.4s against a 5s limit. It passes 19/19 when run alone and passed in the final
full run; it is load-related and unrelated to the escrow interface.

## Lease note

One file outside the packet's lease had to change for `forge build` to pass:
`contracts/script/whitechain/EscrowForkCheck.s.sol`. Its five `escrow.fund(offerN, csN)`
calls are all unbonded, so each gained the required third argument `""`. No other script
line changed. Without this, `forge build` fails with `Wrong argument count` and the
acceptance command cannot run.

## Commits

- `d4cb68b` — `add the four audit findings as failing tests on 81df37e (refs #98)`
- final commit — `fund opens to anyone with the payee's Lock, cancel unwinds only a Funded job, a Dispute names its status, and a registered offer funds only on its terms (refs #98)`

Not pushed, merged or deployed.
