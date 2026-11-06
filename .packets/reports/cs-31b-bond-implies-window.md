# cs-31b-bond-implies-window — a bond always comes with a review window (refs #98)

Branch `cs/164-g2`, created from `cs/164-g` at `840af5d` (PR #164, packet cs-31's four
contract fixes). The captain's rule: a bond is compensation for a buyer who can refuse a
delivery, so a bonded job must have a review window. Otherwise the seller releases on any
receipt with window 0 and takes the payment plus its whole bond back.

## The fix

- `contracts/src/ICountersignedEscrow.sol:96` adds `error BondNeedsWindow();`.
- `contracts/src/CountersignedEscrow.sol:138` adds, beside `BondTooHigh`:
  `if (bond != 0 && reviewWindow == 0) revert BondNeedsWindow();`.
- `contracts/src/ICountersignedEscrow.sol:119-120` extends `setTerms`' natspec: a bond needs
  a review window, because with window 0 the payee releases on any receipt and takes the
  payment plus its whole bond back.

Every bonded `fund` must match the payee's registered terms, so the new `setTerms` check
also makes a bonded job with window 0 unreachable through `fund`.

## Step 1 — red before the fix

Commit `ae0e7f9` adds only the test:

```
add the bond-implies-window test, red before the fix (refs #98)
```

Command:

```
forge test --match-test test_W_a_bond_needs_a_review_window -vvv
```

Output:

```text
Warning: This is a nightly build of Foundry. It is recommended to use the latest stable version. To mute this warning set `FOUNDRY_DISABLE_NIGHTLY_WARNING` in your environment. 

Compiling 50 files with Solc 0.8.28
Solc 0.8.28 finished in 1.06s
Compiler run successful!

Ran 1 test for contracts/test/GrokFindings.t.sol:GrokFindingsTest
[FAIL: next call did not revert as expected] test_W_a_bond_needs_a_review_window() (gas: 60829)
Traces:
  [60829] GrokFindingsTest::test_W_a_bond_needs_a_review_window()
    ├─ [0] VM::prank(seller: [0xDFa97bfe5d2b2E8169b194eAA78Fbb793346B174])
    │   └─ ← [Return]
    ├─ [0] VM::expectRevert(custom error 0xf4844814)
    │   └─ ← [Return]
    ├─ [50156] CountersignedEscrow::setTerms(0x81ae79a2efa7816bcbba29ad904ab30245329035ebbd3cbe64b9d7aa99d58149, 1500000 [1.5e6], 500000 [5e5], 0, 0)
    │   ├─ emit TermsSet(payee: seller: [0xDFa97bfe5d2b2E8169b194eAA78Fbb793346B174], offerHash: 0x81ae79a2efa7816bcbba29ad904ab30245329035ebbd3cbe64b9d7aa99d58149, price: 1500000 [1.5e6], bond: 500000 [5e5], reviewWindow: 0, minDuration: 0)
    │   └─ ← [Stop]
    └─ ← [Revert] next call did not revert as expected

Backtrace:
  at GrokFindingsTest.test_W_a_bond_needs_a_review_window (contracts/test/GrokFindings.t.sol:98:49)

Suite result: FAILED. 0 passed; 1 failed; 0 skipped; finished in 11.38ms (2.87ms CPU time)

Ran 1 test suite in 144.83ms (11.38ms CPU time): 0 tests passed, 1 failed, 0 skipped (1 total tests)

Failing tests:
Encountered 1 failing test in contracts/test/GrokFindings.t.sol:GrokFindingsTest
[FAIL: next call did not revert as expected] test_W_a_bond_needs_a_review_window() (gas: 60829)

Encountered a total of 1 failing tests, 0 tests succeeded

Tip: Run `forge test --rerun` to retry only the 1 failed test
```

The test failed for the right reason: `setTerms` accepted `(PRICE, BOND, 0, 0)` and emitted
`TermsSet` with `bond: 500000`, `reviewWindow: 0`.

## Step 2 — the fix, green

Commit `11d32a7`:

```
setTerms refuses a bond without a review window (refs #98)
```

The test now expects `ICountersignedEscrow.BondNeedsWindow.selector`:

```text
Warning: This is a nightly build of Foundry. It is recommended to use the latest stable version. To mute this warning set `FOUNDRY_DISABLE_NIGHTLY_WARNING` in your environment. 

Compiling 3 files with Solc 0.8.28
Solc 0.8.28 finished in 868.94ms
Compiler run successful!

Ran 1 test for contracts/test/GrokFindings.t.sol:GrokFindingsTest
[PASS] test_W_a_bond_needs_a_review_window() (gas: 11384)
Suite result: ok. 1 passed; 0 failed; 0 skipped; finished in 803.67µs (73.17µs CPU time)

Ran 1 test suite in 119.27ms (803.67µs CPU time): 1 tests passed, 0 failed, 0 skipped (1 total tests)
```

## Step 3 — existing tests that registered a bond with window 0

After the fix, `forge test` failed 26 tests in six files. Each was fixed by its own subject:

- window-0 tests keep window 0 and drop the bond to 0;
- bond tests keep the bond and register a nonzero review window (`REVIEW_WINDOW = 60` in
  `Bond.t.sol`, `Lock.t.sol` and `W1Bond.t.sol`; the existing `WINDOW = 3600` in
  `GrokFindings.t.sol` and `AuditFixes.t.sol`);
- a bonded test that needs settlement now goes through the windowed path (`accept`).

Commit `f116c54`:

```
fix the tests that registered a bond with window 0 (refs #98)
```

### `contracts/test/GrokFindings.t.sol`

| Line | Change |
| --- | --- |
| 214-218 | new `test_W_a_bond_needs_a_review_window`: the seller calls `setTerms(OFFER, PRICE, BOND, 0, 0)` and expects `BondNeedsWindow` |
| 216 | red version used bare `vm.expectRevert()`; green names `ICountersignedEscrow.BondNeedsWindow.selector` |
| 144-145 | `test_H1_a_bond_moves_only_with_the_payee_lock`: `_publish(BOND, 0)` → `_publish(BOND, WINDOW)`; `_cs(1, BOND, 0)` → `_cs(1, BOND, WINDOW)` |
| 204-205 | `test_L_a_registered_bonded_offer_cannot_be_funded_with_bond_zero`: `_publish(BOND, 0)` → `_publish(BOND, WINDOW)`; `_cs(1, 0, 0)` → `_cs(1, 0, WINDOW)` so only the bond differs |

### `contracts/test/Acceptance.t.sol`

| Line | Change |
| --- | --- |
| 338-339 | `test_a_window_of_zero_releases_at_once_as_in_v1`: `_sellerPublishes(0)` (which deposited `BOND` and registered `(BOND, 0)`) → `vm.prank(seller); escrow.setTerms(OFFER, PRICE, 0, 0, 0);` |
| 340 | countersign `_countersign(BOND, 0)` → `_countersign(0, 0)` |
| 341 | `jobIdFor(..., BOND, 0)` → `jobIdFor(..., 0, 0)` |
| 343 | `escrow.fund(OFFER, cs, _lockSig(sellerKey, jobId))` → `escrow.fund(OFFER, cs, "")` |

Removed assertions: none. This test carried no bond-specific `assertEq`; the bond entered
only through `_sellerPublishes` and the countersignature, so dropping it to 0 removed no
assertion line. The payment and status assertions are unchanged.

### `contracts/test/AuditFixes.t.sol`

| Line | Change |
| --- | --- |
| 237 | `test_C1_only_the_payee_sets_its_terms`: attacker's registered terms `setTerms(OFFER, 1, 1, 0, 0)` → `setTerms(OFFER, 1, 1, WINDOW, 0)` |
| 250 | the matching attacker countersignature gains `WINDOW` as its review window |
| 464 | `test_H1_failDelivery_and_release_land_until_settleBy`: removed `_deposit(4 * BOND);` and replaced `_publish(BOND, 0)` with `_publish(0, 0)` |
| 467 | `_cs(i + 1, BOND, 0)` → `_cs(i + 1, 0, 0)` |
| 469 | fund passes `""` instead of `_lockSig(sellerKey, jobId)` |
| 570 | `test_L1_blocklisted_treasury_does_not_block_release`: `_fundJob(1, BOND, 0)` → `_fundJob(1, 0, 0)` |
| 632 | `ConservationHandler` constructor: `setTerms(DIRECT, PRICE, BOND, 0, 0)` → `setTerms(DIRECT, PRICE, 0, 0, 0)` |
| 644 | handler comment now says kinds 0 and 1 are no bond, no window; kind 2 is bonded and windowed |
| 649 | handler `fund`: `bond = kind == 0 ? 0 : BOND` → `bond = kind == 2 ? BOND : 0`, because bonded with no window is no longer a reachable state |

Removed assertions, both because a window-0 job can no longer carry a bond:

- old line 481 in `test_H1_failDelivery_and_release_land_until_settleBy`:
  `assertEq(escrow.bondOf(seller), BOND, "an honest late release keeps the bond");`
- old line 578 in `test_L1_blocklisted_treasury_does_not_block_release`:
  `assertEq(escrow.bondOf(seller), BOND);`

### `contracts/test/Bond.t.sol`

| Line | Change |
| --- | --- |
| 28 | added `uint64 internal constant REVIEW_WINDOW = 60;` |
| 53 | `_countersign`: added `cs.reviewWindow = REVIEW_WINDOW;` |
| 56 | `_countersign`: `jobIdFor(..., bond, 0)` → `jobIdFor(..., bond, REVIEW_WINDOW)` |
| 98 | `_terms`: `setTerms(OFFER, PRICE, bond, 0, 0)` → `setTerms(OFFER, PRICE, bond, REVIEW_WINDOW, 0)` |
| 144 | `_fundBonded`: `jobIdFor(..., bond, 0)` → `jobIdFor(..., bond, REVIEW_WINDOW)` |
| 158 | `test_delivering_seller_gets_paid_and_the_bond_comes_back`: `release` now records the delivery first |
| 161-162 | the test then settles on the windowed path: `vm.prank(buyer); escrow.accept(jobId, "");`; the `BondReturned` expectation stays on the call that pays and returns the bond |
| 243 | `test_fund_bonded_refuses_more_than_the_free_bond`: `jobIdFor(..., BOND + 1, 0)` → `jobIdFor(..., BOND + 1, REVIEW_WINDOW)` |
| 296 | `test_a_locked_bond_cannot_be_withdrawn_but_the_free_bond_can`: `jobIdFor(..., BOND, 0)` → `jobIdFor(..., BOND, REVIEW_WINDOW)` |

### `contracts/test/Lock.t.sol`

| Line | Change |
| --- | --- |
| 27 | added `uint64 internal constant REVIEW_WINDOW = 60;` |
| 52-53 | `_countersign`: a bonded countersignature gets `REVIEW_WINDOW`; an unbonded one keeps window 0 |
| 56 | `_countersign`: `jobIdFor` uses that same window |
| 96-97 | `_jobId`: uses the same bond-dependent window |
| 103 | `_terms`: a bonded offer registers `REVIEW_WINDOW`; an unbonded one keeps window 0 |

### `contracts/test/W1Bond.t.sol`

| Line | Change |
| --- | --- |
| 26 | added `uint64 internal constant REVIEW_WINDOW = 60;` |
| 70-71 | `_countersign`: a bonded countersignature gets `REVIEW_WINDOW`; an unbonded one keeps window 0 |
| 74 | `_countersign`: `jobIdFor` uses that same window |
| 111 | `test_W1_deploy_gate_a_stranger_cannot_lock_a_sellers_free_bond`: `setTerms(OFFER, PRICE, BOND, 0, 0)` → `setTerms(OFFER, PRICE, BOND, REVIEW_WINDOW, 0)` |

No other assertion, amount or time was changed.

## Acceptance run

Command, from the worktree root:

```
bun install --linker hoisted && forge build && forge test
```

`bun install` reported no changes; `forge build` succeeded; `forge test` ended with:

```text
Ran 10 test suites in 438.45ms (768.04ms CPU time): 93 tests passed, 0 failed, 0 skipped (93 total tests)
```

Per suite:

| Suite | Passed |
| --- | --- |
| `ParityTest` | 2 |
| `FeeSplitTest` | 4 |
| `W1BondTest` | 2 |
| `GrokFindingsTest` | 5 |
| `LockTest` | 8 |
| `BondTest` | 15 |
| `AcceptanceTest` | 14 |
| `CountersignedEscrowTest` | 24 |
| `AuditFixesTest` | 18 |
| `ConservationInvariantTest` (`invariant_conservation`, 64 × 64) | 1 |
| **Total** | **93 passed, 0 failed, 0 skipped** |

## Commits

- `ae0e7f9` — `add the bond-implies-window test, red before the fix (refs #98)`
- `11d32a7` — `setTerms refuses a bond without a review window (refs #98)`
- `f116c54` — `fix the tests that registered a bond with window 0 (refs #98)`

Not pushed, merged or deployed.
