> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# Review cc2a8fd — CountersignedEscrow, FeeSplit, core countersign.ts

Reviewer: cs-w1. Result: **blockers=0 should-fix=2**. Adversarial tests: `contracts/test/W1Attacks.t.sol` on `cs/w1` (10 tests, all pass). Full `forge test`: 39/39 pass.

## Attacked, held
- Replay / cross-chain / cross-escrow: nonce = jobId = EIP-712 hash under the escrow domain (chainId + address); the buyer's 3009 auth names the escrow. Auth for escrow A dead on B; release sig dead after chainId change. Tests: `test_countersignature_does_not_fund_a_second_escrow`, `test_release_signature_is_not_portable_across_chains`.
- Malleability: OZ ECDSA rejects high-s on both buyer and seller signatures. Tests `test_malleated_*`.
- Amount: jobId binds amount, payee, deadline, offer; any change → CountersignatureMismatch. Toll floor-rounded in the buyer's favour; payout+toll == amount (fuzz exists).
- Deadline edges: release allowed at t<=deadline, refund only t>deadline — disjoint, no race. Tests `test_deadline_edge_*`.
- Double exit across paths (cancel/release/refund): status single-use. `test_no_exit_after_exit_across_paths`. Re-fund after refund blocked (status != None, token nonce burned).
- Reentrancy: nonReentrant on all four entry points, state written before transfers.
- Slip binding: release sig covers (jobId, slipHash). Conservation through release holds.
- Arc USDC (0x3600…0000, read-only probe): FiatTokenV2, `DOMAIN_SEPARATOR()`, `name()="USDC"`, `version()="2"`, `authorizationState` and `receiveWithAuthorization` all present — the pull path will work on Arc.
- TS/Solidity parity: `countersign.ts` mirrors the typehashes and types; its time checks match the token's strict inequalities.

## Should-fix (no failing test; availability, not theft)
1. **Blocklist can brick release.** `release` pays seller then treasury in one tx. If the token (USDC blocklist) blocks `treasury`, every release reverts; buyers only recover via post-deadline refund, sellers are never paid. Treasury is immutable. Use a fresh, non-sanctionable treasury (or the FeeSplit) and say so in the runbook.
2. **Blocked buyer or payee strands funds.** A blocked buyer makes refund/cancel revert forever. Inherent to the pull design; document it.

## Not reviewed
- `packages/rail/src/escrow` (3a36865) is outside the requested sha; needs its own REVIEW-REQ.
- FeeSplit: read; distribute is permissionless, immutable split, last payee takes dust, no reentrancy exposure beyond ERC-20 transfers. No finding.
