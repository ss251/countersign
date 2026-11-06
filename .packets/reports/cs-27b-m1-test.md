# cs-27b-m1-test: the M1 front-run test checks the front-run again (refs #98)

Branch `cs/164-d2`, created from `cs/164-d` at `3a7b247` (PR #164, option (d): a bonded job is
funded only by the arbiter).

## What changed

Only `test_M1_front_run_with_the_same_terms_is_harmless` in `contracts/test/AuditFixes.t.sol`:

- before any fund, the attacker submits the buyer's exact countersignature and must be refused
  with `NotArbiter`, leaving the job status `None` ("the front-run opened nothing");
- the arbiter then funds exactly the signed job, as before;
- the `jobId == expected` message now says "the arbiter opened exactly the signed job".

Every other assertion, the test name, and all source files are untouched.

## Diff

```diff
diff --git a/contracts/test/AuditFixes.t.sol b/contracts/test/AuditFixes.t.sol
index 7964f4f..455c731 100644
--- a/contracts/test/AuditFixes.t.sol
+++ b/contracts/test/AuditFixes.t.sol
@@ -310,10 +310,15 @@ contract AuditFixesTest is EscrowSigning {
         _publish(BOND, WINDOW);
         (ICountersignedEscrow.Countersignature memory cs, bytes32 expected) = _cs(1, BOND, WINDOW);
 
+        vm.prank(attacker);
+        vm.expectRevert(ICountersignedEscrow.NotArbiter.selector);
+        escrow.fund(OFFER, cs);
+        assertEq(uint8(escrow.jobOf(expected).status), uint8(ICountersignedEscrow.Status.None), "the front-run opened nothing");
+
         vm.prank(arbiter);
         bytes32 jobId = escrow.fund(OFFER, cs);
 
-        assertEq(jobId, expected, "the stranger opened exactly the signed job");
+        assertEq(jobId, expected, "the arbiter opened exactly the signed job");
         ICountersignedEscrow.Job memory job = escrow.jobOf(jobId);
         assertEq(job.buyer, buyer);
         assertEq(job.payee, seller);
```

## Full test suite

Command: `bun install --linker hoisted && forge test`

```text
Warning: This is a nightly build of Foundry. It is recommended to use the latest stable version. To mute this warning set `FOUNDRY_DISABLE_NIGHTLY_WARNING` in your environment. 

Compiling 66 files with Solc 0.8.28
Solc 0.8.28 finished in 3.77s
Compiler run successful!

Ran 2 tests for contracts/test/Parity.t.sol:ParityTest
[PASS] test_v2_jobId_matches_the_typescript_vector() (gas: 4765)
[PASS] test_v2_jobId_with_bond_and_window_zero_matches_the_typescript_vector() (gas: 4807)
Suite result: ok. 2 passed; 0 failed; 0 skipped; finished in 6.98ms (1.57ms CPU time)

Ran 4 tests for contracts/test/FeeSplit.t.sol:FeeSplitTest
[PASS] test_distribute_splits_by_share_and_the_last_payee_takes_dust() (gas: 532518)
[PASS] test_distribute_with_nothing_is_a_no_op() (gas: 436368)
[PASS] test_shares_must_sum_to_10000() (gas: 43764)
[PASS] test_zero_share_is_refused() (gas: 43555)
Suite result: ok. 4 passed; 0 failed; 0 skipped; finished in 6.99ms (5.07ms CPU time)

Ran 2 tests for contracts/test/W1Bond.t.sol:W1BondTest
[PASS] test_W1_B16_a_countersignature_cannot_be_spent_as_a_bond_deposit() (gas: 224940)
[PASS] test_W1_deploy_gate_a_stranger_cannot_lock_a_sellers_free_bond() (gas: 193753)
Suite result: ok. 2 passed; 0 failed; 0 skipped; finished in 11.15ms (5.65ms CPU time)

Ran 4 tests for contracts/test/ForcedDefault.t.sol:ForcedDefaultTest
[PASS] test_a_stranger_cannot_fund_a_bonded_job() (gas: 213466)
[PASS] test_an_unbonded_job_stays_open_to_anyone() (gas: 206862)
[PASS] test_the_arbiter_funds_a_bonded_job_and_locks_the_bond() (gas: 340233)
[PASS] test_the_buyer_cannot_fund_a_bonded_job() (gas: 211433)
Suite result: ok. 4 passed; 0 failed; 0 skipped; finished in 11.28ms (5.82ms CPU time)

Ran 15 tests for contracts/test/Bond.t.sol:BondTest
[PASS] test_a_deposit_replayed_with_the_same_salt_reverts_in_the_token() (gas: 129851)
[PASS] test_a_deposit_uses_the_computed_bond_nonce() (gas: 118496)
[PASS] test_a_failing_seller_and_a_silent_one_both_lose_the_bond() (gas: 620427)
[PASS] test_a_locked_bond_cannot_be_withdrawn_but_the_free_bond_can() (gas: 352607)
[PASS] test_constructor_refuses_a_zero_arbiter() (gas: 67619)
[PASS] test_delivering_seller_gets_paid_and_the_bond_comes_back() (gas: 412237)
[PASS] test_deposit_bond_refuses_zero_and_the_zero_payee() (gas: 23222)
[PASS] test_fail_delivery_refuses_a_refunded_job() (gas: 312879)
[PASS] test_fail_delivery_refuses_a_released_job() (gas: 404866)
[PASS] test_fail_delivery_refuses_after_settle_by() (gas: 340019)
[PASS] test_failing_seller_pays_the_buyer_the_amount_and_the_bond() (gas: 316154)
[PASS] test_fund_bonded_refuses_more_than_the_free_bond() (gas: 221983)
[PASS] test_only_the_arbiter_can_fail_a_delivery() (gas: 339522)
[PASS] test_payee_cancel_returns_the_bond() (gas: 347997)
[PASS] test_silent_seller_refunds_the_buyer_and_forfeits_the_bond() (gas: 320210)
Suite result: ok. 15 passed; 0 failed; 0 skipped; finished in 14.79ms (19.39ms CPU time)

Ran 14 tests for contracts/test/Acceptance.t.sol:AcceptanceTest
[PASS] test_1_buyer_accepts_early_the_seller_is_paid_and_the_bond_returns() (gas: 479281)
[PASS] test_1b_the_buyer_can_accept_by_calling_it_directly() (gas: 454697)
[PASS] test_2_buyer_disputes_inside_the_window_is_refunded_and_takes_the_bond() (gas: 421363)
[PASS] test_2b_a_funded_job_can_be_disputed_before_delivery_up_to_the_deadline() (gas: 397685)
[PASS] test_3_release_after_window_fails_one_second_early_then_pays() (gas: 468403)
[PASS] test_3b_a_delivered_job_is_never_refunded_by_the_deadline() (gas: 421726)
[PASS] test_4_seller_never_delivers_the_refund_after_settleBy_pays_amount_plus_bond() (gas: 369631)
[PASS] test_5_a_dispute_after_the_window_has_closed_reverts() (gas: 432308)
[PASS] test_5b_a_funded_job_cannot_be_disputed_after_its_deadline() (gas: 383636)
[PASS] test_6_a_third_party_cannot_dispute_without_the_buyers_signature() (gas: 460766)
[PASS] test_6b_nor_accept_without_it_and_an_accept_signature_is_not_a_dispute() (gas: 451759)
[PASS] test_a_window_of_zero_releases_at_once_as_in_v1() (gas: 404361)
[PASS] test_accept_and_release_after_window_refuse_a_job_that_is_not_delivered() (gas: 384751)
[PASS] test_release_with_a_window_holds_the_money_and_records_the_review() (gas: 419620)
Suite result: ok. 14 passed; 0 failed; 0 skipped; finished in 32.55ms (23.98ms CPU time)

Ran 24 tests for contracts/test/CountersignedEscrow.t.sol:CountersignedEscrowTest
[PASS] testFuzz_toll_and_payout_sum_to_the_amount(uint256) (runs: 256, μ: 295393, ~: 297492)
[PASS] test_another_offer_hash_fails() (gas: 44129)
[PASS] test_constructor_refuses_bad_parameters() (gas: 188457)
[PASS] test_deadline_in_the_past_fails() (gas: 32452)
[PASS] test_double_refund_fails() (gas: 199657)
[PASS] test_double_release_fails() (gas: 301897)
[PASS] test_expired_authorisation_fails() (gas: 136653)
[PASS] test_extending_the_deadline_fails() (gas: 44370)
[PASS] test_fund_locks_the_amount_under_the_countersigned_terms() (gas: 210701)
[PASS] test_payee_cancels_early_and_the_buyer_is_whole() (gas: 207246)
[PASS] test_reentrancy_on_the_payee_path_is_closed() (gas: 624991)
[PASS] test_refund_before_settle_by_fails() (gas: 208256)
[PASS] test_refund_by_a_stranger_succeeds() (gas: 202596)
[PASS] test_relayer_submits_the_payee_cancel() (gas: 206520)
[PASS] test_release_after_settle_by_fails() (gas: 213677)
[PASS] test_release_needs_the_payee_signature() (gas: 218675)
[PASS] test_release_pays_the_seller_less_the_toll() (gas: 304690)
[PASS] test_release_signature_is_bound_to_the_slip() (gas: 219393)
[PASS] test_replay_of_a_nonce_fails() (gas: 315633)
[PASS] test_stranger_cannot_cancel() (gas: 219170)
[PASS] test_swapping_the_payee_fails() (gas: 46150)
[PASS] test_unknown_job_cannot_be_closed() (gas: 34460)
[PASS] test_wrong_amount_fails() (gas: 48439)
[PASS] test_zero_amount_fails() (gas: 31090)
Suite result: ok. 24 passed; 0 failed; 0 skipped; finished in 105.30ms (118.87ms CPU time)

Ran 18 tests for contracts/test/AuditFixes.t.sol:AuditFixesTest
[PASS] testFuzz_L3_one_rule_for_every_boundary(uint8,uint8) (runs: 256, μ: 399842, ~: 400790)
[PASS] test_C1_bond_capped_at_the_price() (gas: 87236)
[PASS] test_C1_each_term_must_match() (gas: 520374)
[PASS] test_C1_no_bond_without_registered_terms() (gas: 162367)
[PASS] test_C1_only_the_payee_sets_its_terms() (gas: 272072)
[PASS] test_C1_registered_terms_lock_exactly_the_bond() (gas: 399900)
[PASS] test_C2_cancel_after_the_deadline_reverts() (gas: 400649)
[PASS] test_C2_cancel_by_the_deadline_returns_the_bond() (gas: 402612)
[PASS] test_C2_default_pays_amount_plus_bond() (gas: 368173)
[PASS] test_H1_failDelivery_and_release_land_until_settleBy() (gas: 957213)
[PASS] test_H1_refund_waits_for_settleBy() (gas: 367556)
[PASS] test_L1_blocklisted_treasury_does_not_block_release() (gas: 438912)
[PASS] test_L2_the_payee_cannot_be_the_escrow() (gas: 42419)
[PASS] test_M1_front_run_with_other_terms_fails() (gas: 242540)
[PASS] test_M1_front_run_with_the_same_terms_is_harmless() (gas: 436877)
[PASS] test_dispute_before_delivery_returns_the_bond_to_the_payee() (gas: 403427)
[PASS] test_dispute_inside_the_window_pays_amount_plus_bond() (gas: 418857)
[PASS] test_failDelivery_pays_amount_plus_bond() (gas: 363857)
Suite result: ok. 18 passed; 0 failed; 0 skipped; finished in 158.48ms (182.14ms CPU time)

Ran 1 test for contracts/test/AuditFixes.t.sol:ConservationInvariantTest
[PASS] invariant_conservation() (runs: 64, calls: 4096, reverts: 0)

╭---------------------+--------------------+-------+---------+----------╮
| Contract            | Selector           | Calls | Reverts | Discards |
+=======================================================================+
| ConservationHandler | accept             | 344   | 0       | 0        |
|---------------------+--------------------+-------+---------+----------|
| ConservationHandler | cancel             | 352   | 0       | 0        |
|---------------------+--------------------+-------+---------+----------|
| ConservationHandler | dispute            | 355   | 0       | 0        |
|---------------------+--------------------+-------+---------+----------|
| ConservationHandler | failDelivery       | 361   | 0       | 0        |
|---------------------+--------------------+-------+---------+----------|
| ConservationHandler | fund               | 386   | 0       | 0        |
|---------------------+--------------------+-------+---------+----------|
| ConservationHandler | refund             | 344   | 0       | 0        |
|---------------------+--------------------+-------+---------+----------|
| ConservationHandler | release            | 422   | 0       | 0        |
|---------------------+--------------------+-------+---------+----------|
| ConservationHandler | releaseAfterWindow | 388   | 0       | 0        |
|---------------------+--------------------+-------+---------+----------|
| ConservationHandler | sweep              | 363   | 0       | 0        |
|---------------------+--------------------+-------+---------+----------|
| ConservationHandler | warp               | 389   | 0       | 0        |
|---------------------+--------------------+-------+---------+----------|
| ConservationHandler | withdraw           | 392   | 0       | 0        |
╰---------------------+--------------------+-------+---------+----------╯

Suite result: ok. 1 passed; 0 failed; 0 skipped; finished in 508.80ms (502.27ms CPU time)

Ran 9 test suites in 513.20ms (856.33ms CPU time): 84 tests passed, 0 failed, 0 skipped (84 total tests)
```

## The M1 front-run test

Command: `bun install --linker hoisted && forge test --match-test test_M1_front_run_with_the_same_terms_is_harmless -vv`

```text
Warning: This is a nightly build of Foundry. It is recommended to use the latest stable version. To mute this warning set `FOUNDRY_DISABLE_NIGHTLY_WARNING` in your environment. 

No files changed, compilation skipped

Ran 1 test for contracts/test/AuditFixes.t.sol:AuditFixesTest
[PASS] test_M1_front_run_with_the_same_terms_is_harmless() (gas: 436877)
Suite result: ok. 1 passed; 0 failed; 0 skipped; finished in 1.84ms (952.83µs CPU time)

Ran 1 test suite in 182.96ms (1.84ms CPU time): 1 tests passed, 0 failed, 0 skipped (1 total tests)
```
