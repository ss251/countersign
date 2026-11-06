# cs-19b-bond-deposit-domain — report

A buyer's countersignature can no longer become a bond deposit. `depositBond` now takes a salt and derives the token nonce from it, `fundBonded` is arbiter-only, and the buyer's `resume` counts an on-chain Failed job as money back.

## What changed

### Contract (`contracts/src/CountersignedEscrow.sol`, `ICountersignedEscrow.sol`)

- Added `BOND_DEPOSIT_TYPEHASH = keccak256("BondDeposit(address payee,uint256 amount,bytes32 salt)")`.
- `depositBond` takes `salt` instead of a raw nonce and computes `nonce = keccak256(abi.encode(BOND_DEPOSIT_TYPEHASH, payee, amount, salt))` before its EIP-3009 pull. A jobId is an EIP-712 digest, so a countersignature can never match a deposit nonce; a deposit authorization cannot fund a job either, because `fund` requires `nonce == jobId`.
- Deposits remain permissionless and relayable: the payee signs, and anyone may submit the call.
- `fundBonded` reverts `NotArbiter()` unless the caller is the escrow's `arbiter`. `fund` (bond 0) stays permissionless.
- `abi.ts` regenerated from the contract with `forge inspect CountersignedEscrow abi --json`.

### Tests

- `contracts/test/Bond.t.sol`:
  - deposits sign the computed bond nonce; the token records it as used;
  - replaying the same salt reverts in the token with `authorization is used`;
  - `fundBonded` from a stranger reverts `NotArbiter`;
  - the four bond paths, the `BondMissing` refusal and the failing-versus-silent comparison run with `fundBonded` submitted by the arbiter.
- `contracts/test/W1Bond.t.sol`: both cs-w1 tests pass. The attack test functions are unchanged. Its `_sellerDeposits` helper had to change with the API: it now passes a salt and signs the derived nonce. Without that edit the helper signs a raw nonce the new contract correctly rejects, and the deploy-gate test cannot reach its assertion.
- `packages/rail/test/escrow.test.ts`: the anvil deposit helper derives the nonce from a random salt and passes the salt to `depositBond`; the escrow's submitter is also its arbiter.
- `packages/runner/test/bond.test.ts`: two deposits each credit exactly their amount, proving a fresh random salt each time.
- `packages/buyer/test/terms.test.ts`: `resume` on a hub-reported Failed job with chain status 4 appends `failed` and returns the budget; a Failed report without a chain failure appends nothing.

### Runner (`packages/runner/src/bond.ts`)

- `bond deposit` generates a 32-byte random salt, derives the token nonce exactly as the contract does, signs `ReceiveWithAuthorization` over that nonce, and submits `depositBond` with the salt.
- Exported `bondDepositNonce(payee, amount, salt)` for reuse.

### Buyer (`packages/buyer/src/resume.ts`)

- A refunded report is accepted on chain status 3 (Refunded) or 4 (Failed): both leave the payment with the buyer.
- A failed report is checked on chain the same way; on status 4 (or 3) it appends `failed` with the reservation id, which returns the reserved budget through the journal's existing failed-reservation rule.
- A mismatch appends nothing and reports `hub says failed; chain does not` / `hub says refunded; chain does not`.

### Docs (`docs/spec/escrow.md`)

- `depositBond` signature and description now state the salt-derived nonce and the domain separation.
- `fundBonded` is documented as arbiter-only.
- Trust and limits now states that a leaked hub key can lock and slash any seller's free bond, so bonds stay small; seller-signed locks remain a later revision.

## Tests run

From the worktree root, the acceptance sequence passed:

```
bun install
forge build
forge test
bun run typecheck
bun test packages/rail packages/runner packages/buyer apps/hub
bun test
```

Results:

- `forge test`: 47 passed, 0 failed, 0 skipped. Both `W1Bond.t.sol` tests are green.
- `bun run typecheck`: clean.
- Targeted `bun test`: 220 passed, 0 failed.
- Full `bun test`: 554 passed, 3 skipped (the pre-existing live-only web suite), 0 failed.

## Lease deviations

- `contracts/test/W1Bond.t.sol` is edited in its `_sellerDeposits` helper only, as described above. The two attack tests themselves are byte-for-byte cs-w1's.
- `packages/rail/test/escrow.test.ts` is edited only where `depositBond` now takes a salt.

No deployment, faucet, public RPC or browser was used. All chain tests ran on local anvil with fixed test keys.
