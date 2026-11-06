# cs-19b-bond-deposit-domain — a countersignature can never become a bond deposit (refs #93)

## Setup

Run `bun install` at the worktree root before anything else. You are on `cs/cs-19`, the seller bond.

## The design is decided (orch-cs; written below and in `docs/decisions.md`, "D11, amended")

**cs-w1 B16.** Today `depositBond` accepts any `ReceiveWithAuthorization` to the escrow, from any caller. A buyer's countersignature is exactly such an authorization, with nonce = jobId. So anyone who sees one can spend it as a deposit: the buyer's money becomes `bondOf[buyer]`, the nonce is burnt, and the job can never be funded.

**Rule 1, domain separation.**

- `depositBond` takes a `salt`, not a raw nonce. The escrow computes the deposit nonce itself:

  ```
  nonce = keccak256(abi.encode(BOND_DEPOSIT_TYPEHASH, payee, amount, salt))
  ```

  with `BOND_DEPOSIT_TYPEHASH = keccak256("BondDeposit(address payee,uint256 amount,bytes32 salt)")`.
- It calls `receiveWithAuthorization(payee, this, amount, validAfter, validBefore, nonce, v, r, s)`.
- **Why this separates the two:**
  - A jobId is an EIP-712 digest (`\x19\x01 || domainSeparator || structHash`), so it can never equal a deposit nonce, and no countersignature can be replayed as a deposit.
  - A deposit authorization cannot fund a job either, because `fund` requires nonce == jobId.
- **Deposits stay relayable.** Anyone may submit one, so a seller without gas, such as on Whitechain, can deposit through a relayer.

**Rule 2, cs-w1's deploy gate.** `fundBonded` is **arbiter-only** (`NotArbiter`). The bond comes from the offer through the arbiter, so no stranger can lock a seller's free bond in a job of their own. #98 adds `reviewWindow` to this same function later.

**Rule 3, should-fix 2.** The buyer treats an on-chain **Failed (4)** job like **Refunded (3)**:

- the amount is back with the buyer, so `resume` returns its budget exactly as it does for a refund;
- check it on chain the same way.

**Recorded, not built (cs-w1 should-fix 1, orch-cs's call).**

- **The arbiter key can move a seller's free bond.** With the arbiter choosing `bond` and calling `failDelivery`, a leaked hub key can lock and slash any seller's free bond.
- Accepted for this deployment, and stated in the trust notes: keep bonds small, because the bond is exactly as safe as the hub's key.
- Seller-signed locks (`LockBond(jobId, bond)`) are a later revision.

**Should-fix 3** (an on-chain check that the locked bond is the offer's bond) is a follow-up after the redeploy.

## Lease

You may create or change only these paths:

- `contracts/src/CountersignedEscrow.sol` and `contracts/src/ICountersignedEscrow.sol`
- `contracts/test/Bond.t.sol`, plus existing tests only where `fundBonded` now needs the arbiter or `depositBond` takes a salt
- `packages/rail/src/escrow/abi.ts` (regenerated, same form) and `packages/rail/src/escrow/index.ts`
- `packages/runner/src/bond.ts` (the deposit builds the nonce from a random salt, exactly as the contract does) and `packages/runner/test/bond.test.ts`
- `packages/buyer/src/resume.ts` (Failed counts as Refunded) and `packages/buyer/test/*`, except `w1-*.test.ts`
- `docs/spec/escrow.md`: the bond deposit lines and the Trust and limits note only
- `.packets/reports/cs-19b-bond-deposit-domain.md`

## Tests

**cs-w1's tests.** Copy `contracts/test/W1Bond.t.sol` from `origin/cs/w1` (f63f306) unedited. These must pass:

- `test_W1_B16_...`: a stranger replaying a fresh countersignature into `depositBond` gets nothing credited, and the same countersignature still funds its job;
- `test_W1_deploy_gate_a_stranger_cannot_lock_a_sellers_free_bond`.

**In `Bond.t.sol`:**

- a deposit whose authorization nonce is the computed bond nonce works;
- a deposit replayed with the same salt reverts in the token;
- `fundBonded` by a non-arbiter reverts with `NotArbiter`;
- the four bond paths and the failing-versus-silent comparison still pass.

**Buyer:** `resume` on an on-chain Failed job returns the budget.

**Runner:** `bond deposit` on anvil credits exactly the amount, with a random salt each time.

## Constraints

- **Never launch a browser of any kind on this machine**: no Chrome or Chromium, headless or not, no Playwright, Puppeteer or screenshot tools. UI checks go back to the lane, which raises NEEDS-BROWSER.
- Never deploy, never call a faucet and never use a public RPC. Use only fixed anvil test keys. TypeScript strict, no `any`. No view code.

## Acceptance

From the worktree root:

```
bun install && forge build && forge test && bun run typecheck && bun test packages/rail packages/runner packages/buyer apps/hub && bun test
```

Every command passes. Both `W1Bond.t.sol` tests are green.

## Stop conditions

- You need to edit outside the lease: stop and write the report.
- One problem has blocked you for more than 20 minutes: stop, commit what passes, and write the report.

## Finish

Commit with small present-tense messages ending `(refs #93)`, and no trailers. Write `.packets/reports/cs-19b-bond-deposit-domain.md`. Do not push, merge or deploy.
