> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# Review d2be6e1 (PR 130, TheRealRajdeep, refs #98): escrow v2 part 1, the buyer's Accept and Dispute

Reviewer: cs-w1. Result: **blockers=0 should-fix=1**. The core and buyer tests give 67 pass and 0 fail. The forge tests are parked in `contracts/pending` and were not run; that is expected until the contract lands.

## Held
- **Domain separation.**
  - `Accept(bytes32 jobId, bytes32 slipHash)` and `Dispute(bytes32 jobId)` use the escrow's own EIP-712 domain (`Countersign`, `1`, chainId, escrow), with type names distinct from `Release` and `Cancel`.
  - An Accept is not a Dispute, and neither carries to another escrow or chain.
  - Pending test 6b checks the first two.
- **`accept` signs only a slip the agent holds and checks itself:**
  - the hash matches the body, and the seller signature recovers to the slip's seller;
  - the slip names this job and this buyer;
  - its escrow is pinned;
  - the buyer's own countersigned terms in the slip derive this jobId on that escrow.
  - No escrow and no slip hash comes from the hub, so a hub cannot get an Accept for a delivery the buyer never received.
- **`dispute` signs under the escrow the journal recorded.** For older journal lines, it signs only when exactly one pinned escrow on the job's network holds the job open (Funded or Delivered) for this agent.
- **Budget:** it comes back only when the chain says Refunded (3) or Disputed (6), which v2 refunds at once.
- **No stuck money:** the design keeps a way out of every state. `releaseAfterWindow` can be called by anyone once the window ends (pending test 3), and the deadline refund still covers a job that was never delivered.

## Should-fix
1. **A dispute should not depend on the hub to relay it.**
   - The CLI only POSTs the signed Dispute to the hub. A hub that sits on it until the review window closes, or is simply down, turns the dispute into a release to the seller.
   - The contract accepts the buyer's signature from any caller, and the buyer itself can call `dispute` (pending tests 2 and 2b).
   - Fix: after the hub's answer, read `jobOf` on the pinned escrow. If the job is not Disputed (or Refunded) within a few seconds while the window is still open, submit the dispute directly with the agent key. An Accept needs no fallback: a dropped Accept only means the seller waits for the window.

## Notes for part 2 and the merge
- **The parked tests use the old deposit API.** `contracts/pending/Acceptance.t.sol` calls `depositBond(..., nonce, ...)`. cs-19b changed it to take a `salt` and derive the nonce (`keccak256(abi.encode(BOND_DEPOSIT_TYPEHASH, payee, amount, salt))`), so the helper must sign the derived nonce and pass the salt.
- **The status numbers are hard-coded** (Funded 1, Refunded 3, Delivered 5, Disputed 6). cs-19 already adds Failed as 4, so v2 must append Delivered and Disputed after it, in this order. Better: read them from the escrow ABI once part 2 lands.
- **Merge `resume` carefully.** cs-19 added a `failed` branch that accepts on-chain 3 or 4. This PR's `refunded`/`disputed` branch accepts 3 or 6. Both must survive the merge.
