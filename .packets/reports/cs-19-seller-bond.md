# cs-19-seller-bond — report

The declared bond is now real: the payee deposits it as a free bond, funding locks it on the job, and the hub's arbiter pays it to the buyer when a delivered job fails the delivery gate. A silent seller still takes the ordinary permissionless refund, which returns the bond to the seller.

## What changed

### Contract (`contracts/src/CountersignedEscrow.sol`, `ICountersignedEscrow.sol`)

- Constructor takes `address arbiter_` (immutable `arbiter`) and refuses zero with `ZeroAddress`.
- Free bond: `bondOf(payee)`, `depositBond(...)` (EIP-3009 pull with an exact balance check), and `withdrawBond(amount)`. Events `BondDeposited` and `BondWithdrawn`; shortfalls revert `BondMissing(payee, requested, available)`.
- Per-job bond: private `_jobBond` with `bondOfJob(jobId)`. The `Job` struct and `jobOf` are unchanged.
- `fundBonded(offerHash, cs, bond)` shares `_fund` with `fund`; a non-zero bond must be covered by the payee's free bond, moves onto the job, and emits `BondLocked`.
- `release`, `refund` and `cancel` return the job bond to the payee's free bond and emit `BondReturned`. With no bond they behave exactly as before.
- `failDelivery(jobId)`: arbiter-only (`NotArbiter`), funded only (`NotFunded`), at or before the deadline (`DeadlinePassed`), status `Failed` appended after `Refunded`, buyer paid `amount + bond` with no toll, event `DeliveryFailed`.
- Checks-effects-interactions and `nonReentrant` throughout.

### Rail (`packages/rail`)

- `challenge` publishes `extra.bond` as the offer's atomic bond string.
- `settle` calls `fundBonded` when the hub's own `requirements.extra.bond` is a non-zero atomic string, otherwise `fund` as before.
- `EscrowOps` gains `failDelivery` and `bondOfPayee`, and status includes `failed`.
- Exported `bondOfPayee(client, escrow, payee)` helper (also available on the escrow ops).
- `abi.ts` regenerated with `forge inspect CountersignedEscrow abi --json`.
- Anvil tests deploy with the submitter as arbiter, prove a bonded fund locks the bond, prove `failDelivery` pays `amount + bond`, and prove a bonded fund without a deposit fails settle with a clear `fundBonded` revert.

### Hub (`apps/hub`)

- New `bond.ts` with `failOnGate(rail, jobId, store)`: calls `escrow.failDelivery` when present, stores the tx as `closeTx` on success, and returns the new buyer message; otherwise returns null.
- `call.ts` calls it only in the two delivery-gate branches (output/slip check and slip-body commitment). Runner errors and timeouts keep the deadline-refund path.
- New `bond.test.ts`: gate failure calls `failDelivery` once and returns the bond message; a runner error does not call it; a rail without `failDelivery` keeps the old message.

### Buyer (`packages/buyer`)

- `checkTerms` refuses a countersign entry whose present `extra.bond` differs from `offer.bond` with "Refused. The hub's bond differs from the offer's."
- Added the mismatch test.

### Runner (`packages/runner`)

- New `bond.ts`: `bond deposit <atomic>`, `bond withdraw <atomic>` and `bond show`, all `--escrow <address> [--rpc <url>]`.
- The key comes only from `CS_SELLER_KEY`; `--rpc` defaults to Arc testnet.
- Deposit signs EIP-3009 `ReceiveWithAuthorization` from the seller to the escrow with a random nonce valid for ten minutes, under the token domain read from `escrow.token()` (`USDC`/`2` by default, `--token-name`/`--token-version` override), then submits `depositBond`. Deposit/withdraw print the tx hash; show prints the free bond.
- `cli.ts` dispatches `bond`.
- New anvil test proves deposit, show and withdraw against the mock token.

### Docs and core

- `docs/spec/escrow.md`: new functions, the four-case bond table, bond events/errors, and the "Trust and limits" paragraph.
- `docs/spec/offer.md`: the bond row now says the bond is collected when the escrow supports it.
- `packages/core/src/types.ts`: only the `Offer.bond` doc comment changed.

## Trust and limits

The hub's delivery gate decides failure; only the escrow's `arbiter` (the hub's relayer) may call `failDelivery`. A dishonest hub could slash an honest seller's bond. Silence is safer for the seller: after the deadline, anyone can `refund` and the bond returns to the seller. That is the invariant the comparison test pins: a failing seller ends exactly one bond worse off than a silent one, and the buyer ends exactly one bond better off.

## Tests run

From the worktree root:

```
bun install
forge build
forge test
bun run typecheck
bun test packages/rail apps/hub packages/buyer packages/runner
bun test
```

Results:

- `forge test`: 43 passed, 0 failed, 0 skipped (includes the new `Bond.t.sol` suite of 14).
- `bun run typecheck`: clean.
- Targeted `bun test`: 217 passed, 0 failed.
- Full `bun test`: 544 passed, 3 pre-existing skips (the live-only web suite), 0 failed.

## Lease deviations (mechanical, disclosed)

The new fourth constructor argument makes every old three-argument constructor call uncompilable or undeployable. Three files outside the stated lease were changed only for that argument, plus one type union:

- `contracts/script/whitechain/DeployWhitechain.s.sol` — passes `WC_ARBITER_ADDRESS` (default: the first FeeSplit payee, the relayer in the default layout).
- `contracts/script/whitechain/EscrowForkCheck.s.sol` — passes the fork's `relayer`.
- `packages/verify/test/onchain.test.ts` — passes `deployer.address` as arbiter; without this the full `bun test` cannot deploy the escrow.
- `packages/relay/src/escrow-ops.ts` — `JobView["chain"]` now includes `"failed"` so the relay typechecks against the rail's `status` union.

No other out-of-lease changes were made. No deployment, faucet, public RPC or browser was used; all chain tests run on local anvil with fixed keys.
