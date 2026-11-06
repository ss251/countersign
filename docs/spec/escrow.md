# Escrow

`contracts/src/CountersignedEscrow.sol`. One file, no owner, no pause, no proxy. The token, treasury, toll and arbiter are fixed at deployment.

| Deployment | Chain | Escrow | Token |
|---|---|---|---|
| Arc testnet, deployed through Arc Studio (the hub's rail) | 5042002 | `0x19c27d770969291e6a0a305dc1be1a845e7c1b76` | USDC `0x3600000000000000000000000000000000000000` |
| Arc testnet, deployed with `forge script` (first deployment) | 5042002 | `0x44d11b8909485e3f575F6628b689383E4420f54a` | USDC `0x3600000000000000000000000000000000000000` |
| Whitechain Sepolia | 1874 | `0x9279D3edeef4c3738a0b200D762e2985Ff3B7eb4` | USDT `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7` |

## Functions

```solidity
fund(bytes32 offerHash, Countersignature cs) returns (bytes32 jobId)
fundBonded(bytes32 offerHash, Countersignature cs, uint256 bond) returns (bytes32 jobId)
depositBond(address payee, uint256 amount, uint256 validAfter, uint256 validBefore, bytes32 salt, uint8 v, bytes32 r, bytes32 s)
withdrawBond(uint256 amount)
release(bytes32 jobId, bytes32 slipHash, bytes sellerSig)
refund(bytes32 jobId)
cancel(bytes32 jobId, bytes sellerSig)
failDelivery(bytes32 jobId)
```

- **fund**: derives `jobId` from the terms, checks the buyer's signature, then pulls `amount` from the buyer with the token's EIP-3009 `receiveWithAuthorization`. Anyone may submit it: the hub, a relayer, or the buyer. The buyer pays no gas. It locks no bond.
- **fundBonded**: arbiter-only. The same path as `fund`, plus it moves `bond` from the payee's free bond into the job. It reverts `NotArbiter()` for any other caller and `BondMissing(payee, bond, available)` when the free bond is short.
- **depositBond**: credits a payee's free bond from an EIP-3009 authorisation signed by that payee. The token nonce is not caller-supplied: the escrow derives it as `keccak256(abi.encode(BOND_DEPOSIT_TYPEHASH, payee, amount, salt))`, with `BondDeposit(address payee,uint256 amount,bytes32 salt)`. A jobId is an EIP-712 digest, so it can never equal a deposit nonce, and a buyer's countersignature can never be spent as a deposit. Anyone may submit a deposit; the escrow checks the exact balance delta. A zero amount reverts `ZeroAmount`.
- **withdrawBond**: the caller takes back from its own free bond, and only that. Asking for more reverts `BondMissing(payee, amount, available)`.
- **release**: allowed until the deadline, inclusive. It needs the payee's EIP-712 `Release(jobId, slipHash)` signature, through ECDSA or ERC-1271, and anyone may submit it. It pays `amount - toll` to the payee and `toll` to the treasury, and returns the job's bond to the payee's free bond.
- **refund**: allowed only after the deadline, and anyone may call it. It returns the full amount to the buyer and the job's bond to the payee's free bond.
- **cancel**: the payee's early refund. The payee calls it directly, or anyone submits it with the payee's `Cancel(jobId)` signature. It returns the full amount to the buyer and the job's bond to the payee's free bond.
- **failDelivery**: only the `arbiter` may call it, and only on a funded job before the deadline. It sets status `Failed` and pays the buyer `amount + bond` with no toll. The seller's free bond is not credited.

Each job closes once: release, refund, cancel and failDelivery all require status `Funded`.

## The countersignature

`jobId` is the EIP-712 hash, under the escrow's domain `{name: "Countersign", version: "1", chainId, verifyingContract: escrow}`, of:

```
Countersign(bytes32 offerHash,address buyer,address payee,uint256 amount,uint64 deadline,uint256 salt)
```

The buyer signs exactly one message: the token's EIP-3009

```
ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)
```

with `to = escrow`, `value = amount` and `nonce = jobId`. Changing the offer, payee, amount, deadline, salt, chain or escrow changes `jobId`, and with it the nonce the buyer signed. The escrow checks the signature before the token does, so a moved price reverts with `CountersignatureMismatch(jobId)` rather than a token error. The token burns the nonce, so one countersignature funds one job, once.

`receiveWithAuthorization` is used rather than `transferWithAuthorization` because only the escrow can submit it. With `transferWithAuthorization`, a front-runner could move the buyer's funds into the escrow without opening a job.

## The seller bond

This section and the next describe the bond as the contract on `main` holds it today. No escrow is deployed with it, and the captain's audit blocks deploying it as it is. C1 and C2 change who may lock a bond and where a silent seller's bond goes; see [Escrow v2](#escrow-v2-seller-bond-delivery-review-and-dispute-design-06-nov-audit-fixes-1945-ist) below.

An offer's `bond` becomes real on a rail whose escrow supports it. The payee deposits it as a free bond, and funding a bonded job locks that much of it on the job. The job's bond is separate from the `Job` struct, so `jobOf` decodes the same way on old and new deployments.

| Case | Payment | Bond |
|---|---|---|
| **Delivering seller**: release by the deadline | to the seller, minus the toll | back to the seller's free bond |
| **Failing seller**: delivery is made by the deadline but fails the hub's delivery gate, so the hub's arbiter calls `failDelivery` | back to the buyer, no toll | **to the buyer** |
| **Silent seller**: nothing is delivered; anyone calls `refund` after the deadline | back to the buyer | back to the seller's free bond |
| **Payee cancels early** (`cancel`) | back to the buyer | back to the seller's free bond |

## Trust and limits

The hub's delivery gate decides whether a delivery failed, and only the escrow's `arbiter` — the hub's relayer — may call `failDelivery`. A dishonest hub could therefore slash a bond by failing an honest delivery; the bond is only as strong as that gate. The seller keeps the stronger protection for silence: when no delivery is made, `refund` after the deadline is permissionless and returns the bond to the seller, so a failing seller is worse off than a silent one by exactly the bond. The escrow never pays a toll on `failDelivery`, and a bond is locked at funding, not at the buyer's word.

The arbiter is also the only caller that can fund a bonded job, so a leaked hub key can lock and slash any seller's free bond. The bond is exactly as safe as the hub's key: keep bonds small. Seller-signed locks are a later revision.

## Events

```solidity
event Funded(bytes32 indexed jobId, bytes32 indexed offerHash, address indexed buyer, address payee, uint256 amount, uint64 deadline);
event Released(bytes32 indexed jobId, bytes32 indexed slipHash, address indexed payee, uint256 paid, uint256 toll);
event Refunded(bytes32 indexed jobId, address indexed buyer, uint256 amount, bool byPayee);
event BondDeposited(address indexed payee, uint256 amount);
event BondWithdrawn(address indexed payee, uint256 amount);
event BondLocked(bytes32 indexed jobId, address indexed payee, uint256 bond);
event BondReturned(bytes32 indexed jobId, address indexed payee, uint256 bond);
event DeliveryFailed(bytes32 indexed jobId, address indexed buyer, uint256 amount, uint256 bond);
```

## Errors

`ZeroAddress`, `ZeroAmount`, `TollTooHigh`, `DeadlineInPast`, `JobExists`, `CountersignatureMismatch`, `TransferShortfall`, `NotFunded`, `DeadlinePassed`, `DeadlineNotReached`, `NotPayee`, `NotArbiter`, `BondMissing`.

## Toll

`toll = amount * tollBps / 10_000`, rounded down. `tollBps` is at most 1,000 and 100 on both deployments. The treasury is a `FeeSplit` that pays its balance to fixed payees by fixed shares when anyone calls `distribute(token)`.

## Known limits

- If the token blocklists the treasury, every release reverts until the deadline, and then buyers recover by refund. Both deployments use a fresh `FeeSplit` as treasury.
- If the token blocklists a buyer, refund and cancel to that buyer revert. This is inherent to any design that pays the buyer back in the same token.
- Buyers sign with EOAs. The escrow's pre-check uses ECDSA over `v, r, s`.

## Tests

`forge test` runs the escrow and bond suites: the eight refusals PLAN §6 requires, plus payee-swap, offer-swap, deadline-extension, expired authorisation, cancel paths, the constructor guards, a toll fuzz, and a vector shared with `packages/core/test/countersign.test.ts` that proves the TypeScript and Solidity `jobId` agree. `contracts/test/Bond.t.sol` covers the four bond paths, the deposit and withdrawal rules, the `failDelivery` refusals, and the comparison that proves a failing seller ends exactly one bond worse off than a silent one.

## Escrow v2: seller bond, delivery review and dispute (design, 06 Nov; audit fixes 19:45 IST)

This section is a design, and none of it is deployed. Its parts stand as follows:

- **The bond is merged, but not deployable.** It came in with PR [#118](https://github.com/ss251/countersign/pull/118) for [#93](https://github.com/ss251/countersign/issues/93), and `contracts/src/CountersignedEscrow.sol` holds it. The captain's audit of that contract on `main` (06 Nov 19:45 IST) found four deploy blockers, C1, C2, H1 and M1, plus three lows. No escrow is redeployed until the fixes below and their regression tests pass.
- **Review and dispute have no contract code yet** ([#98](https://github.com/ss251/countersign/issues/98)).
- **Who builds what.**
  - Rajdeep writes the contract half (`contracts/**`): review, dispute and the audit fixes. He shows each regression test red before green.
  - The fleet wires the hub, the CLI, the runner, the rail ABI and the pins.
- **One deployment.** It is one contract and one testnet deployment, on Arc (through Studio) and on Whitechain (forge), from the merged commit, after the captain re-runs the audit.

The v1 deployments in the table above stay listed, so slips minted on them still verify. v2 keeps these exactly as they are, so the verifier and every client read both versions the same way:

- the `Job` struct and `jobOf`;
- `jobIdFor` and the `Countersign` typehash;
- the EIP-712 domain;
- the `Released` event.

### The audit's findings and their fixes

| Finding | What is wrong on `main` | Fix |
|---|---|---|
| **C1, critical** | `fundBonded` debits `bondOf[payee]` with only the buyer's signature. The arbiter, with a buyer key it controls, can open a job naming any bonded payee, then `failDelivery` it and take amount plus bond. The payee signed nothing. | The payee signs `LockBond(bytes32 jobId,uint256 bond,uint64 reviewWindow)` under the escrow's domain. `fundBonded` checks that signature (ECDSA or ERC-1271) before it debits anything. The bond is capped at the job's amount. |
| **C2, critical** | `_refund` returns the bond to the payee, so a seller who never delivers keeps it, and silence is the cheapest strategy. | A deadline default pays the bond to the buyer. The bond goes back to the payee only on the payee's own cancel by the deadline, a buyer's dispute, or a release. |
| **H1, high** | `failDelivery` reverts after the deadline, so the arbiter loses jurisdiction exactly when a default becomes provable. | Add `DISPUTE_WINDOW` (the audit's name): a constant 600 seconds after the deadline. `failDelivery` and `release` may land until `settleBy = deadline + DISPUTE_WINDOW`, and `refund` opens only after it. |
| **M1, medium** | The bond is not in the countersigned terms, and `fund` is permissionless. Anyone can front-run `fundBonded` with `fund` and open the same `jobId` with bond 0. | `fund` becomes arbiter-only, like `fundBonded`. Today only the would-be arbiters submit `fund` (see below), so nothing in production breaks. Binding bond and window into `Countersign` would change `jobId` and every client's derivation, so it waits for a later revision. |
| **L1** | A token that blocklists the treasury bricks every release. | The toll accrues in `tollAccrued`, and anyone may call `sweepToll()` to pay it to the treasury. A blocklisted treasury then stalls only the sweep. |
| **L2** | `payee == address(this)` can never withdraw. | `fund`, `fundBonded` and `depositBond` reject it with `BadPayee(payee)`. |
| **L3** | The deadline comparisons differ from call to call. | One rule for every boundary, below. |

**Who submits `fund` today (M1).** Only the two keys that become the arbiters:

- the hub's relayer on Arc, `0xA7C448C92aB52Cf4F14c75F0439033232E938380`, through the escrow rail's `settle` (`packages/rail/src/escrow/index.ts`);
- the Whitechain relay's key on 1874 (`packages/relay/src/relayer.ts`).

No buyer, runner, phone or production script submits it. Two other places name it, and neither is in production:

- `e2e/flows/arc-wrong-amount.flow.ts` simulates a stranger's `fund` with `eth_call` to show the moved-price revert. On v2 that simulation reads `NotArbiter`, so the flow stays on v1 or changes its expectation.
- `contracts/script/whitechain/EscrowForkCheck.s.sol` funds from a fork account.

### Terms of a job

| Term | Comes from | Bound by |
|---|---|---|
| `offerHash`, `buyer`, `payee`, `amount`, `deadline`, `salt` | the buyer's countersignature | `jobId`, the token nonce the buyer signed |
| `bond` | `offer.bond` (atomic), at most `amount` | the payee's `LockBond` signature (C1); readable as `bondOfJob(jobId)` |
| `reviewWindow` | `offer.reviewWindow` (seconds, 0 to 86400) | the arbiter at funding, plus the payee's `LockBond` signature when there is a bond; readable as `reviewOf(jobId)` |
| `arbiter` | constructor, immutable | the hub's relayer on Arc; the relay's key on Whitechain |

Only the arbiter funds (M1), so no one can open a job from a countersignature seen in the mempool. The buyer's countersignature does not cover bond or window:

- the buyer checks `extra.bond` and `extra.reviewWindow` in the 402 against the offer before it countersigns;
- it reads `bondOfJob` and `reviewOf` right after funding;
- it disputes at once if either differs, and a dispute before delivery refunds in full.

### Time boundaries (L3)

Every comparison follows one rule. An act allowed **until** T needs `now <= T`; an act allowed **after** T needs `now > T`.

| Boundary | Until it | After it |
|---|---|---|
| `deadline` | the payee may `cancel` an undelivered job; the buyer may `dispute` an undelivered job | the job is in default: no cancel, no dispute before delivery |
| `settleBy = deadline + DISPUTE_WINDOW` (H1) | `release` and `failDelivery` may land | `refund` opens |
| `endsAt = deliveredAt + reviewWindow` | the buyer may `dispute` a delivered job | `releaseAfterWindow` opens |

`release` keeps the same window as `failDelivery` on purpose. Once silence costs the bond (C2), an honest release mined a few seconds after the deadline must not forfeit it.

### States

| # | Status | Meaning | Final |
|---|---|---|---|
| 0 | None | no such job | |
| 1 | Funded | the payment is held, and the bond is locked if there is one | |
| 2 | Released | the seller is paid | yes |
| 3 | Refunded | the buyer has the payment back: the payee cancelled, or nothing was released by `settleBy` and the bond, if any, went to the buyer | yes |
| 4 | Failed | the hub's gate failed the delivery: the buyer has the payment and the bond | yes |
| 5 | Delivered | the slip hash is on chain and the review window is running | |
| 6 | Disputed | the buyer disputed: the buyer has the payment back, and the bond went back to the payee | yes |

### Transitions

| From | Call | Who | When | To | Money | Bond | Events |
|---|---|---|---|---|---|---|---|
| None | `fund(offerHash, cs)` | arbiter (M1) | `deadline > now`; payee is neither zero nor the escrow (L2) | Funded | pulled from the buyer | none | `Funded` |
| None | `fundBonded(offerHash, cs, bond, reviewWindow, payeeSig)` | arbiter (M1) | as `fund`; `bond <= amount` (C1); `reviewWindow <= 86400`; when `bond > 0`, the payee's `LockBond(jobId, bond, reviewWindow)` signature (C1) and `bondOf[payee] >= bond` | Funded | pulled from the buyer | locked from the payee's free bond | `Funded`, `BondLocked` |
| Funded | `release(jobId, slipHash, sellerSig)`, window 0 | anyone, with the payee's `Release(jobId, slipHash)` signature | until `settleBy` (H1) | Released | `amount - toll` to the payee; `toll` added to `tollAccrued` (L1) | returned to the payee | `Released`, `BondReturned` |
| Funded | `release(jobId, slipHash, sellerSig)`, window > 0 | the same | until `settleBy` | Delivered | held | held | `Delivered(jobId, slipHash, deliveredAt, endsAt)` |
| Delivered | `accept(jobId, buyerSig)` | the buyer, or anyone with the buyer's `Accept(jobId, slipHash)` signature | any time while Delivered | Released | paid as above | returned | `Accepted`, `Released`, `BondReturned` |
| Delivered | `releaseAfterWindow(jobId)` | anyone | after `endsAt` | Released | paid as above | returned | `WindowElapsed`, `Released`, `BondReturned` |
| Funded | `dispute(jobId, buyerSig)` | the buyer, or anyone with the buyer's `Dispute(jobId)` signature | until `deadline` | Disputed | refunded to the buyer at once | returned | `Disputed`, `Refunded(false)`, `BondReturned` |
| Delivered | `dispute(jobId, buyerSig)` | the same | until `endsAt` | Disputed | refunded to the buyer at once | returned | the same |
| Funded | `failDelivery(jobId)` | arbiter | until `settleBy` (H1) | Failed | refunded to the buyer | **paid to the buyer** | `DeliveryFailed(jobId, buyer, amount, bond)` |
| Funded | `refund(jobId)` | anyone | after `settleBy` (H1) | Refunded | refunded to the buyer | **paid to the buyer** (C2) | `Refunded(false)`, `BondForfeited` |
| Funded | `cancel(jobId, sellerSig)` | the payee, or anyone with the payee's `Cancel(jobId)` signature | until `deadline` (C2) | Refunded | refunded to the buyer | returned to the payee | `Refunded(true)`, `BondReturned` |
| Delivered | `cancel(jobId, sellerSig)` | the same | any time while Delivered | Refunded | refunded to the buyer | returned to the payee | the same |
| any | `sweepToll()` | anyone | `tollAccrued > 0` | unchanged | `tollAccrued` to the treasury (L1) | none | `TollSwept` |

**Disputes and the deadline.**

- **Before delivery,** a dispute is allowed until the deadline.
- **After delivery,** a dispute is allowed until `endsAt`, even when that falls past the deadline. The deadline governs delivery; the window governs review.
- **A dispute refunds at once.** Release is already blocked, and there is no arbitration to wait for.

**A delivered job is never refunded by the deadline.** It is released after its window unless the buyer disputes within it or the payee cancels.

### Bond outcomes

| Case | Payment | Bond |
|---|---|---|
| **Delivering seller**: release by `settleBy` (window 0), or accepted, or the window elapses | to the seller, minus the toll | back to the seller's free bond |
| **Failing seller**: the hub's gate fails the delivery and the arbiter calls `failDelivery` by `settleBy` | back to the buyer, no toll | **to the buyer** |
| **Silent seller**: nothing released by `settleBy`; anyone calls `refund` after it (C2) | back to the buyer | **to the buyer** |
| **Payee cancels** by the deadline, or a delivered job at any time | back to the buyer | back to the seller's free bond |
| **Buyer disputes**, before delivery by the deadline or after delivery by `endsAt` | back to the buyer | back to the seller's free bond |

A failing seller and a silent seller now end the same: one bond worse off than a seller who cancels. The v1 rule that silence was cheaper than failing is withdrawn (C2).

### Who does what

- **The hub, the arbiter on Arc,** funds every job:
  - with `fund` when bond and window are both 0;
  - otherwise with `fundBonded`.
- **The bond handshake (C1).** Before it funds a bonded job, the hub asks the online runner to sign the lock.
  - The hub sends `{t: "lock", order}`, and the runner answers `{t: "locked", jobId, sig}` or a refusal.
  - With no lock signature, the hub does not fund, and the buyer's countersignature is never spent.
- **After dispatch,** the hub runs its delivery gate.
  - **Gate passes:** it submits `release`. The job closes as Released, or opens as Delivered.
  - **Gate fails:** it submits `failDelivery`, until `settleBy`.
- **The hub's janitor:**
  - `releaseAfterWindow` for Delivered jobs past `endsAt`;
  - `refund` for Funded jobs past `settleBy`;
  - `sweepToll` from time to time.
- **The runner (the payee)** checks before it signs a lock.
  - The order must be for its own offer, with `bond == offer.bond <= amount`, `reviewWindow == offer.reviewWindow`, `amount == price`, the payee its own address, and a deadline within its limit.
  - Its free bond must cover the bond.
  - It re-derives `jobId` from the order's terms under its pinned escrow's domain.
- **After signing a lock, the runner protects its bond,** because the deadline now costs the bond (C2):
  - **The order never arrives, or it cannot deliver:** it cancels by the deadline. It submits the cancel itself, or hands its `Cancel(jobId)` signature to any relayer.
  - **It delivered but the hub has not released by the deadline:** it submits its own `release`. A bonded seller therefore needs a little gas, or a relayer other than the hub.
- **The buyer agent:**
  - signs `Accept(jobId, slipHash)` or `Dispute(jobId)` under its pinned escrow's domain;
  - checks `bondOfJob` and `reviewOf` after funding;
  - disputes at once on a mismatch.
  - The hub relays these signatures. If the hub does not, the agent submits them itself (cs-w1 on #130).
- **The phone** shows the review countdown. Its offers carry bond 0 and sign no locks.

### Slip and hash

- **The committed hash.** The slip body is complete at delivery. `release` commits its hash, and the `Delivered` and `Released` events carry the same `slipHash`.
- **Where the review record lives.** The review outcome does not exist when the hash is computed, so it sits outside the committed body: `slip.settlement.review = {window, deliveredAt, endsAt, outcome?, tx?}`, beside `settlement.receipt`. The outcome is `accepted`, `disputed` or `window-elapsed`.
- **The verifier:**
  - a `Released` event proves the slip and the payment, as in v1;
  - a `Delivered` event without `Released` proves the slip is committed and in review;
  - a `Disputed` event means the slip was delivered and then refunded, so it is not proof of payment.

### Events added in v2

```solidity
event BondDeposited(address indexed payee, uint256 amount);
event BondWithdrawn(address indexed payee, uint256 amount);
event BondLocked(bytes32 indexed jobId, address indexed payee, uint256 bond);
event BondReturned(bytes32 indexed jobId, address indexed payee, uint256 bond);
event BondForfeited(bytes32 indexed jobId, address indexed buyer, uint256 bond);
event DeliveryFailed(bytes32 indexed jobId, address indexed buyer, uint256 amount, uint256 bond);
event Delivered(bytes32 indexed jobId, bytes32 indexed slipHash, uint64 deliveredAt, uint64 reviewEndsAt);
event Accepted(bytes32 indexed jobId, address indexed buyer);
event WindowElapsed(bytes32 indexed jobId);
event Disputed(bytes32 indexed jobId, address indexed buyer);
event TollSwept(address indexed treasury, uint256 amount);
```

`BondReturned` and `BondForfeited` are emitted only when the bond is non-zero. `Released` keeps its fields; its `toll` is the amount added to `tollAccrued`.

### Errors added in v2

| Error | When |
|---|---|
| `NotArbiter()` | `fund`, `fundBonded` or `failDelivery` by anyone but the arbiter (M1) |
| `BondNotAuthorised(bytes32 jobId)` | `fundBonded` with a bond and no valid `LockBond` signature from the payee (C1) |
| `BondTooHigh(uint256 bond, uint256 amount)` | a bond above the job's amount (C1) |
| `BondMissing(address payee, uint256 needed, uint256 available)` | locking or withdrawing more than the free bond |
| `BadPayee(address payee)` | a payee that is the escrow itself (L2) |
| `ReviewTooLong(uint64 reviewWindow)` | a window above 86400 seconds |
| `SettleWindowClosed(bytes32 jobId, uint256 settleBy)` | `release` or `failDelivery` after `settleBy` (H1) |
| `SettleWindowOpen(bytes32 jobId, uint256 settleBy)` | `refund` until `settleBy` (H1) |
| `NotBuyer(bytes32 jobId)` | `accept` or `dispute` without the buyer as sender or signer |
| `NotDelivered(bytes32 jobId)` | `accept` or `releaseAfterWindow` on a job that is not Delivered |
| `ReviewOpen(bytes32 jobId, uint64 endsAt)` | `releaseAfterWindow` until `endsAt` |
| `ReviewClosed(bytes32 jobId, uint64 endsAt)` | `dispute` on a Delivered job after `endsAt` |
| `NotOpen(bytes32 jobId)` | `dispute` or `cancel` on a job that is neither Funded nor Delivered |

`DeadlinePassed(jobId, deadline)` also covers `cancel` and `dispute` on a Funded job after the deadline. The other v1 errors keep their meaning.

### Trust and limits

1. **The bond is the payee's to commit (C1).** The payee signs each lock, capped at the job's amount, so the arbiter cannot lock a bond the payee did not put on that job.
   - The arbiter can still fail a delivery the payee made honestly and take that job's bond.
   - So the bond is as strong as the hub's delivery gate, and no larger than the job's amount.
2. **Only the arbiter funds (M1).** If its key is lost, no new job can be funded on that deployment. Open jobs still close: by release, cancel, dispute, or refund after `settleBy`.
3. **The buyer's countersignature does not cover bond or window.** The arbiter sets them at funding, and the payee signs them with a bond.
   - The buyer verifies them on chain right after funding, and disputes at once on a mismatch.
   - Binding them into `Countersign` changes `jobId`, so it is a later revision.
4. **Silence costs the bond (C2).** A bonded runner that cannot deliver must cancel by the deadline. A runner that goes offline after signing a lock loses that job's bond.
5. **A payee watching the mempool can still dodge a slash.** It can cancel ahead of a pending `failDelivery` and keep its bond. The buyer is refunded at once either way.
6. **On a window-0 offer, the payee's own `Release` signature moves the payment, as in v1.**
   - The escrow protects the buyer from silence, and from deliveries the hub's gate catches first.
   - It does not protect the buyer from a payee that releases without delivering. A review window does.
7. **Disputes.** A buyer can dispute any delivery inside the window and take the payment back.
   - There is no arbitration, and a dispute never slashes.
   - Disputes are public events, so a buyer's dispute rate is visible to sellers.
8. **Junk that passes the schema** is stopped only by a dispute within the window.
9. **The toll accrues in the escrow (L1),** so a blocklisted treasury delays only `sweepToll`.

### Regression tests

Each forge test below fails on the contract as it stands on `main` before the fix, and passes after. Rajdeep shows red before green. They live in `contracts/test/AuditFixes.t.sol`, and each test is named for its finding.

**C1**

1. `test_C1_arbiter_and_buyer_cannot_take_an_unsigned_bond`
   - The audit's sequence: a payee deposits a bond, then the arbiter funds a job naming that payee, with a buyer the arbiter controls, the payee's whole bond, and no payee signature.
   - Expect `BondNotAuthorised`. The free bond is unchanged, and there is no job to fail.
2. `test_C1_lock_signature_binds_job_bond_and_window`: a valid lock for job A is refused for job B, for `bond + 1`, for another `reviewWindow`, and under another escrow's domain.
3. `test_C1_bond_is_capped_at_the_amount`: `bond = amount + 1` with a valid lock reverts `BondTooHigh`, and `bond = amount` funds.
4. `test_C1_a_signed_lock_locks_exactly_the_bond`: `bondOf` drops by the bond and `bondOfJob` equals it. It also passes for an ERC-1271 payee.

**C2**

5. `test_C2_a_silent_seller_forfeits_the_bond_to_the_buyer`: no release, refund after `settleBy`. The buyer receives `amount + bond`, `bondOf[payee]` does not grow back, and `BondForfeited` is emitted.
6. `test_C2_cancel_by_the_deadline_returns_the_bond`.
7. `test_C2_cancel_after_the_deadline_reverts`: at `deadline + 1` and at `settleBy`, cancel reverts `DeadlinePassed`. The bond stays locked until the refund pays it to the buyer.
8. `test_C2_a_dispute_before_delivery_returns_the_bond`.
9. `test_C2_failing_and_silent_sellers_both_lose_the_bond`: replaces the v1 comparison that a failing seller ends one bond worse off than a silent one.
10. `test_C2_an_unbonded_refund_is_unchanged`: the buyer gets `amount`, and there is no `BondForfeited`.

**H1**

11. `test_H1_failDelivery_lands_inside_the_dispute_window`: it succeeds at `deadline + 1` and at `settleBy`, and reverts `SettleWindowClosed` at `settleBy + 1`.
12. `test_H1_release_lands_inside_the_dispute_window`: it succeeds at `settleBy`, and reverts at `settleBy + 1`.
13. `test_H1_refund_waits_for_the_dispute_window`: it reverts `SettleWindowOpen` at `deadline + 1` and at `settleBy`, and succeeds at `settleBy + 1`.

**L3**

14. `testFuzz_L3_one_rule_for_every_boundary`: for any time `t`, each of these holds:
    - `release` and `failDelivery` are allowed if and only if `t <= settleBy`;
    - `refund` is allowed if and only if `t > settleBy`;
    - `cancel` and `dispute` on a Funded job are allowed if and only if `t <= deadline`;
    - `dispute` on a Delivered job is allowed if and only if `t <= endsAt`;
    - `releaseAfterWindow` is allowed if and only if `t > endsAt`.

**M1**

15. `test_M1_a_stranger_cannot_front_run_with_fund`: a stranger submits `fund` with a fresh countersignature that names a bonded offer's payee, and it reverts `NotArbiter`. The arbiter's `fundBonded` then locks the bond.
16. `test_M1_a_stranger_cannot_fundBonded`: it reverts `NotArbiter`.

**L1 and L2**

17. `test_L1_a_blocklisted_treasury_does_not_block_release`: use a token mock that blocklists the treasury.
    - The release succeeds, and `tollAccrued` grows.
    - `sweepToll` reverts while the treasury is blocklisted, and pays out after it is unblocked.
18. `test_L2_the_payee_cannot_be_the_escrow`: `fund`, `fundBonded` and `depositBond` revert `BadPayee`.

**Conservation**

19. `invariant_conservation`: under random sequences of every call, the token balance equals the sum of these:
    - the amounts held in Funded and Delivered jobs;
    - every free bond;
    - every locked bond;
    - `tollAccrued`.

**Kept green**

- `W1Bond.t.sol`: B16, and the deploy gate, which now holds through the payee's lock.
- `W1Attacks.t.sol`.
- `Bond.t.sol`, changed only where C2 changes the silent seller's outcome.
- #130's `Acceptance.t.sol`, the review and dispute tests.

**The fleet's tests, with the wiring:**

- **Runner:**
  - it signs a lock only for its own offer's terms;
  - it refuses a mismatched bond, window, amount, payee or deadline;
  - it re-derives `jobId`;
  - it cancels before the deadline when no order follows a signed lock.
- **Hub:**
  - with no runner lock, there is no funding, and the countersignature is not spent;
  - `failDelivery` is sent only until `settleBy`;
  - the janitor refunds only after `settleBy`.
- **Buyer:**
  - a `bondOfJob` or `reviewOf` mismatch after funding disputes at once;
  - Failed (4) and Disputed (6) return the budget, like Refunded (3).
