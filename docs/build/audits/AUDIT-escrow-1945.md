> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Escrow audit on main (project lead, 06 Nov 19:45 IST): four findings block any deploy

Pashov-style audit (solidity-auditor plus access-control, accounting and state-machine passes) of `CountersignedEscrow.sol` as it stands on main.

**Do not deploy the bond version as it is.** A regression test exists for each finding before any deploy.

## The findings

- **C1, critical: theft of a payee's bond.**
  - `fundBonded` is arbiter-only and locks `bondOf[payee]` with only the buyer's signature. So the arbiter can pick a payee with a bond, open a job naming it with a buyer it controls, then call `failDelivery` and pay amount plus bond to that buyer. The payee signed nothing.
  - Fix: require the payee's signature over (jobId, bond) before debiting `bondOf`, and cap the bond at the job amount.
- **C2, critical: a deadline refund hands the bond back to the seller.**
  - `_refund` calls `_returnJobBond` before paying the buyer, so a seller who never delivers keeps the bond. Inaction is the cheapest strategy.
  - Fix: on a deadline default the bond goes to the buyer. It returns to the payee only on a voluntary cancel.
- **H1, high: `failDelivery` reverts after the deadline,** so the arbiter loses jurisdiction exactly when a default becomes provable.
  - Fix: add a `disputeWindow`. `failDelivery` is allowed until deadline + window, and refund is gated on the same boundary.
- **M1, medium: the bond is not in the countersigned terms, and `fund` is permissionless,** so anyone can front-run `fundBonded` with `fund` and open the same jobId with bond 0.
  - Fix: put the bond in the countersign struct, or make `fund` arbiter-gated.
- **Lows:**
  - a blocklisted treasury bricks every release, so accrue the toll instead of transferring it;
  - reject `payee == address(this)`, which can never withdraw;
  - make the deadline comparison consistent across release, refund and failDelivery.

## #98

PR #130 is part 1 only: the buyer's accept and dispute signatures, plus forge tests waiting for the contract. The contract functions do not exist yet, so #98 is not ready to deploy.
