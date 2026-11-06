# tr-06b: the erc8183 escrow pays the buyer even after a direct claimRefund, and the core's refund opens only after the deadline (refs #24)

**Design: decided.** cs-truth wrote this on Opus from the review of tr-06 and `docs/decisions.md` "D21, amended", which is already committed on this branch. Implement exactly what follows. Nothing here is left for you to choose. This is a corrective on `cs/tr-06`: the contract, its mock and its tests from tr-06 are in your worktree.

## Goal

Anyone may call the core's `claimRefund` once a job expires. After that call, the adapter's `refund` and `cancel` still return the full amount to the buyer. The core's refund opens only after the escrow's deadline, never in the same second as the last allowed `release`.

## Decisions (`contracts/src/CountersignedEscrow8183.sol` only)

### 1. `fund`: the core's expiry

Replace these two lines:

```solidity
        uint256 minExpiry = block.timestamp + 6 minutes;
        uint256 expiredAt = cs.deadline > minExpiry ? cs.deadline : minExpiry;
```

with exactly:

```solidity
        uint256 minExpiry = block.timestamp + 6 minutes;
        uint256 afterDeadline = uint256(cs.deadline) + 1;
        uint256 expiredAt = afterDeadline > minExpiry ? afterDeadline : minExpiry;
```

### 2. `_refund`: read the core job first

Replace the whole `_refund` function with exactly:

```solidity
    function _refund(bytes32 jobId, Job storage job, bool byPayee) private {
        uint256 id = job8183Of[jobId];
        uint256 amount = job.amount;
        uint256 before = token.balanceOf(address(this));
        IAgenticCommerce.JobStatus coreStatus = core.getJob(id).status;
        if (coreStatus == IAgenticCommerce.JobStatus.Funded || coreStatus == IAgenticCommerce.JobStatus.Submitted) {
            if (byPayee) {
                core.reject(id, bytes32("cancel"), "");
            } else {
                try core.reject(id, bytes32("deadline"), "") {} catch {
                    core.claimRefund(id);
                }
            }
            uint256 received = token.balanceOf(address(this)) - before;
            if (received != amount) revert CoreFeeTaken(received, amount);
        } else if (coreStatus == IAgenticCommerce.JobStatus.Expired || coreStatus == IAgenticCommerce.JobStatus.Rejected) {
            // The core already returned the budget to this contract: someone called claimRefund directly.
            if (before < amount) revert CoreFeeTaken(before, amount);
        } else {
            revert NotFunded(jobId);
        }

        job.status = Status.Refunded;
        address buyer = job.buyer;
        token.safeTransfer(buyer, amount);
        emit Refunded(jobId, buyer, amount, byPayee);
    }
```

Nothing else in the contract changes.

## Lease

- `contracts/src/CountersignedEscrow8183.sol`: the two decisions above only;
- `contracts/test/CountersignedEscrow8183.t.sol`: add the four tests below at the end of the contract. Do not edit any existing test.

Read only: everything else. Never commit `bun.lock`.

## Tests (append to `contracts/test/CountersignedEscrow8183.t.sol`; use its existing helpers `_funded`, `_countersign`, `_releaseSig`, `_cancelSig` and `_coreJob`)

1. **`test_a_direct_claim_refund_does_not_strand_the_money`.**
   - `(bytes32 jobId,) = _funded();`, then `vm.warp(_coreJob(jobId).expiredAt);`.
   - `vm.prank(stranger); core.claimRefund(escrow.job8183Of(jobId));`.
   - The core job is now `Expired`, and `token.balanceOf(address(escrow)) == PRICE`.
   - Then, with `vm.expectEmit(address(escrow))` for `Refunded(jobId, buyer, PRICE, false)`, call `vm.prank(stranger); escrow.refund(jobId);`.
   - Afterwards `token.balanceOf(buyer) == 100_000_000` and `token.balanceOf(address(escrow)) == 0`.
2. **`test_a_cancel_after_a_direct_claim_refund_still_refunds`.**
   - The same funding, warp and direct `claimRefund`.
   - Then, with `vm.expectEmit(address(escrow))` for `Refunded(jobId, buyer, PRICE, true)`, call `vm.prank(stranger); escrow.cancel(jobId, _cancelSig(sellerKey, jobId));`.
   - The buyer's balance is `100_000_000` again.
3. **`test_a_second_refund_after_a_direct_claim_refund_reverts`.**
   - As in test 1, through the adapter's `refund`.
   - A second `escrow.refund(jobId)` then reverts with `CountersignedEscrow8183.NotFunded.selector` and `jobId`.
4. **`test_the_core_refund_opens_only_after_the_deadline`.**
   - `CountersignedEscrow8183.Countersignature memory cs = _countersign(OFFER, seller, PRICE, uint64(block.timestamp + 3600), 7);`, then `bytes32 jobId = escrow.fund(OFFER, cs);`.
   - `_coreJob(jobId).expiredAt == uint256(cs.deadline) + 1`.
   - `vm.warp(cs.deadline);`. Then `core.claimRefund(escrow.job8183Of(jobId))` reverts with `MockAgenticCommerce.RefundNotYetAvailable.selector`, the core job id and `uint256(cs.deadline) + 1`.
   - `escrow.release(jobId, SLIP, _releaseSig(sellerKey, jobId, SLIP));` succeeds, and the core job is `Completed`.

Every existing test still passes, unedited: the 14 tests in this file and the other 47 forge tests.

## Constraints

- **No browser** of any kind. That means no headless Chrome, no Playwright, no Puppeteer and no screenshot tools.
- **No network** in tests, and no `forge script --broadcast`. Never deploy.
- **Never run `git stash`.** Every worktree of a clone shares one stash stack. Use a temporary commit or a second worktree.
- **Existing tests:** never edit, weaken, skip or delete one to make it pass. If one fails, fix the code, or stop and report the root cause.
- **Commits:** small, present tense, ending `refs #24`, with no emoji and no `Co-authored-by`.

## Acceptance

```
bun install --linker hoisted && bun run typecheck && bun test && forge test
```

All green.

## Stop conditions

Stop if any of these happens:
- a change is needed outside the lease;
- the two lines in decision 1, or `_refund`, differ from what this packet quotes;
- a failure survives three different fixes;
- 30 minutes have passed.

## Report

Write `~/Developer/countersign-mac/reports/tr-06b-refund-after-claim.md` (on the second machine): the diff summary, the test names, and the gate output counts.
