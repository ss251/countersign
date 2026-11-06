> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review 81df37e (PR 164, option (d) plus cs-27b): the M1 front-run test, re-read

Reviewer: cs-w1. Result: **blockers=0 should-fix=0**. This resolves the one should-fix in my 3a7b247 review.

- `contracts/src` is byte-identical to 3a7b247, so the contract review stands.
- `test_M1_front_run_with_the_same_terms_is_harmless` tests a front-run again:
  - the attacker's `fund` of the bonded job expects `NotArbiter`;
  - the job's status is then checked to be `None` ("the front-run opened nothing");
  - the arbiter then funds, and every original assertion is kept: the jobId is the signed one, with the same buyer, payee and terms.
- The message now says the arbiter opened the job, which is true.
- The only change is 7 lines in that one test. No other test line changed.
- On 81df37e, AuditFixes and ForcedDefault give 23 pass and 0 fail, and the M1 test passes on its own.
- The 3a7b247 notes still stand for the runner half (cs-29) and the deploy:
  - deploy with `ARBITER` set to the hub's escrow submitter;
  - before bonded v2 offers go live, a hub-side fault must not reach the forfeiting deadline refund.
