# cs-27-164-option-d: a bonded job is funded only through the arbiter (refs #98)

Branch `cs/164-d`, based on `origin/raj/98-escrow-v2` at `9240aec`.

## What changed

- `contracts/src/CountersignedEscrow.sol:104-105`: inside `fund`'s existing
  `if (cs.bond != 0)` block, before `bondOf[cs.payee]` is read:

  ```solidity
  // Forced default (option d): only the arbiter funds a bonded job, after the payee's runner accepted it.
  if (msg.sender != arbiter) revert NotArbiter();
  ```

- `contracts/src/ICountersignedEscrow.sol:106-107`: the `fund` natspec now says a bonded job is
  funded only by the arbiter, and anyone may submit an unbonded one.

- `contracts/test/ForcedDefault.t.sol` (new): the four forced-default tests.

No other contract logic changed and no new error was added.

## Step 1: the red test

The new file was committed alone as `1050c01` (`add the forced-default regression test, red before the fix (refs #98)`).

`forge test --match-path contracts/test/ForcedDefault.t.sol` before the fix:

```text
Ran 4 tests for contracts/test/ForcedDefault.t.sol:ForcedDefaultTest
[FAIL: next call did not revert as expected] test_a_stranger_cannot_fund_a_bonded_job() (gas: 360517)
[PASS] test_an_unbonded_job_stays_open_to_anyone() (gas: 206862)
[PASS] test_the_arbiter_funds_a_bonded_job_and_locks_the_bond() (gas: 340193)
[FAIL: next call did not revert as expected] test_the_buyer_cannot_fund_a_bonded_job() (gas: 358484)
Suite result: FAILED. 2 passed; 2 failed; 0 skipped; finished in 17.45ms (33.90ms CPU time)

Ran 1 test suite in 129.22ms (17.45ms CPU time): 2 tests passed, 2 failed, 0 skipped (4 total tests)
```

Tests 1 and 2 fail because a non-arbiter could still fund; tests 3 and 4 pass.

## Step 2: the fix

Committed as `ea9128f` (`fund a bonded job only through the arbiter (refs #98)`).

`forge test --match-path contracts/test/ForcedDefault.t.sol` after the fix:

```text
Ran 4 tests for contracts/test/ForcedDefault.t.sol:ForcedDefaultTest
[PASS] test_a_stranger_cannot_fund_a_bonded_job() (gas: 213466)
[PASS] test_an_unbonded_job_stays_open_to_anyone() (gas: 206862)
[PASS] test_the_arbiter_funds_a_bonded_job_and_locks_the_bond() (gas: 340233)
[PASS] test_the_buyer_cannot_fund_a_bonded_job() (gas: 211433)
Suite result: ok. 4 passed; 0 failed; 0 skipped; finished in 1.32ms (2.14ms CPU time)

Ran 1 test suite in 119.22ms (1.32ms CPU time): 4 tests passed, 0 failed, 0 skipped (4 total tests)
```

## Step 3: existing tests

Before the test edits, the full `forge test` showed 46 passed and 38 failed; every failure was a
bonded `fund` from a non-arbiter (37 `NotArbiter()` and one expected `BondMissing` that became
`NotArbiter()`), in `Bond.t.sol`, `Acceptance.t.sol` and `AuditFixes.t.sol`.

Only the funding caller changed (plus the two comments that claimed anyone may fund a bonded job).
No amount, time, expectation or assertion changed, and no unbonded fund's caller changed.

In two places the countersignature had to be built before the prank, because `_cs` / `_countersign`
calls `escrow.jobIdFor` and would consume the prank; the resulting call is still exactly the same
`escrow.fund` with the arbiter as caller.

| File:line | Before | After |
| --- | --- | --- |
| `contracts/test/Acceptance.t.sol:121` | `/// The buyer countersigns the offer's bond and window, and anyone holding that funds the job.` | `/// The buyer countersigns the offer's bond and window, and the arbiter funds the bonded job.` |
| `contracts/test/Acceptance.t.sol:125` | `vm.prank(stranger);` | `vm.prank(arbiter);` |
| `contracts/test/Acceptance.t.sol:333-335` | `bytes32 jobId = escrow.fund(OFFER, _countersign(BOND, 0));` | `ICountersignedEscrow.Countersignature memory cs = _countersign(BOND, 0);`<br>`vm.prank(arbiter);`<br>`bytes32 jobId = escrow.fund(OFFER, cs);` |
| `contracts/test/AuditFixes.t.sol:130` | `/// The seller deposits and registers (bond, window); the buyer countersigns them; a stranger funds.` | `/// The seller deposits and registers (bond, window); the buyer countersigns them; the arbiter funds.` |
| `contracts/test/AuditFixes.t.sol:136` | `vm.prank(stranger);` | `vm.prank(arbiter);` |
| `contracts/test/AuditFixes.t.sol:216` | (no prank) | `vm.prank(arbiter);` before `escrow.fund(OFFER, cs);` |
| `contracts/test/AuditFixes.t.sol:269` | (no prank) | `vm.prank(arbiter);` before `escrow.fund(OFFER, cs);` |
| `contracts/test/AuditFixes.t.sol:313` | `vm.prank(attacker);` | `vm.prank(arbiter);` |
| `contracts/test/AuditFixes.t.sol:452` | (no prank) | `vm.prank(arbiter);` before `escrow.fund(OFFER, cs);` in the H1 loop |
| `contracts/test/AuditFixes.t.sol:622` | (no prank) | `if (bond != 0) vm.prank(arbiter);` before the conservation handler's `try escrow.fund(...)`; kind 0 stays open to anyone |
| `contracts/test/Bond.t.sol:138` | `vm.prank(stranger); // anyone holding the countersignature may fund` | `vm.prank(arbiter); // the arbiter funds a bonded job` |
| `contracts/test/Bond.t.sol:239` | (no prank) | `vm.prank(arbiter);` before `escrow.fund(OFFER, cs);` |
| `contracts/test/Bond.t.sol:285-287` | `bytes32 jobId = escrow.fund(OFFER, _cs(BOND));` | `ICountersignedEscrow.Countersignature memory cs = _cs(BOND);`<br>`vm.prank(arbiter);`<br>`bytes32 jobId = escrow.fund(OFFER, cs);` |

Committed as `a6f5335` (`fund bonded jobs in the existing tests from the arbiter (refs #98)`).

No TypeScript test line needed changing. The anvil tests in `packages/rail`, `packages/runner`,
`packages/verify` and `packages/identity` deploy the frozen
`contracts/test/fixtures/CountersignedEscrowV1.sol`; its bonded entry point (`fundBonded`) already
required the arbiter, and the modified v2 `fund` is not used by them.

## Final counts

`forge test`:

```text
Ran 9 test suites in 419.16ms (770.77ms CPU time): 84 tests passed, 0 failed, 0 skipped (84 total tests)
```

`bun test`:

```text
 967 pass
 3 skip
 2 fail
 3710 expect() calls
Ran 972 tests across 107 files. [21.53s]
```

The two failures are `packages/identity/test/erc8004.test.ts:224`
(`feedback built from a released slip is readable`) and `:243`
(`only feedback from the slip's buyer with the slip's hash is earned`). Both are ERC-8004 feedback
log reads against anvil; the file is untouched by this packet and reproduces when run alone. This
is recorded rather than edited, per the stop condition.

## Acceptance status

- `bun install`: passes.
- `bun run typecheck`: **fails on 11 pre-existing Buffer/Uint8Array typing errors** in files this
  packet does not touch (`apps/hub/src/buyerplumbing.ts`, `packages/buyer/src/hedera/*`,
  `packages/rail/src/hedera/*`, `packages/relay/src/merchant-server.ts`, `packages/relay/src/paywall.ts`,
  `scripts/hedera/agent-run.ts`). The output is unchanged by this packet, which changes only
  Solidity files; `bun install --frozen-lockfile` does not change it. Recorded, not edited, because
  the lease forbids touching those files.
- `bun test`: 967 pass, 3 skip, 2 pre-existing unrelated failures as above.
- `forge test`: 84 pass, 0 fail, 0 skip.

The escrow work itself is green: the new four-test file is green, and the full forge suite is green
after the caller-only test updates.
