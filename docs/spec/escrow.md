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

This section and the next describe the bond as the contract on `main` holds it today. No escrow is deployed with it, and the captain's audit blocks deploying it as it is. The captain's 19:40 decisions change who may lock a bond, which terms bind it, and where a silent seller's bond goes; see [Escrow v2](#escrow-v2-seller-bond-delivery-review-and-dispute-design-06-nov-the-captains-1940-decisions) below.

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

## Escrow v2: seller bond, delivery review and dispute (design, 06 Nov; the captain's 19:40 decisions)

This section is a design, and none of it is deployed. Where things stand:

- **The bond is merged** (PR [#118](https://github.com/ss251/countersign/pull/118), [#93](https://github.com/ss251/countersign/issues/93)), but the captain's audit of that contract on `main` (06 Nov, 19:45 IST) found four deploy blockers: C1, C2, H1 and M1, plus three lows.
- **The captain decided the fixes at 19:40 IST** (STEER-1940). This section is that decision written as an interface.
- **Who does what.** Rajdeep writes the contract half (`contracts/**`), with every regression test shown red before green. The fleet wires the hub, the CLI and the runner.
- **One deployment.**
  - Arc goes through Studio by the `arc-studio` CLI, or by forge if Studio would push it past 22:45.
  - Whitechain 1874 goes by forge.
  - Both come from the merged commit, after the captain re-runs the audit.

The v1 deployments in the table above stay listed, so slips minted on them still verify. The `Job` struct, `jobOf`, the EIP-712 domain and the `Released` event are unchanged. **`Countersign` changes:** it gains `bond` and `reviewWindow`, so a v2 `jobId` is derived differently from a v1 one, and clients choose the derivation by the pinned escrow's version.

### v2.1: the independent audit's fixes, and "bond implies window" (06 Nov, 22:05 to 23:25 IST)

An independent audit of the option-(d) head (STEER-2205; its text is in `docs/audits/2026-11-06-grok-escrow-v2.md`) confirmed C1, C2, H1 and M1 fixed, and found two highs, a medium and a low. The project lead adopted its fixes. **They replace option (d)**, the arbiter-only bonded fund, and the 19:40 "no payee lock" decision. Where this subsection and the sections below differ, this subsection wins.

**The interface.** The fleet's runner, hub, rail and Whitechain relay build against exactly this:

| Finding | The fix |
|---|---|
| **High: the arbiter could lock a bond the payee never accepted.** | `fund` is open again: no arbiter check. It becomes `fund(bytes32 offerHash, Countersignature cs, bytes lockSig)`. A bonded job (`cs.bond != 0`) needs the payee's EIP-712 `Lock(bytes32 jobId)` signature, under the escrow's own domain and checked before `bondOf` is debited, or it reverts `LockMissing(jobId)`. An unbonded job ignores `lockSig`, and callers pass `0x`. `failDelivery` stays the arbiter's only power. |
| **High: an online seller could keep its bond.** | `cancel` unwinds only a **Funded** job, by its deadline. On a Delivered job it reverts `NotOpen(jobId)`, so release-then-cancel can no longer dodge a dispute or a forfeit. |
| **Medium: one Dispute signature had two bond outcomes.** | The typehash is `Dispute(bytes32 jobId,uint8 status)`, and `dispute(bytes32 jobId, uint8 status, bytes buyerSig)` requires the signed status to equal the job's (Funded 1 or Delivered 5), else `StatusMismatch(jobId, status)`. |
| **Low: zero bond and zero window skipped the registry.** | `fund`'s terms check also runs when `termsOf[payee][offerHash].price != 0`, so a registered offer is funded only on its terms. |

**The invariant: a bond implies a review window** (the project lead's decision, 23:25 IST).

- **Why.** A bond is compensation for a buyer who can refuse a delivery. With review window 0, the seller releases on any receipt and takes the payment plus its whole bond back. The bond would be decoration that reads as protection.
- **This is a deliberate constraint, not a limitation.** It is enforced in three places:
  1. **The contract.** `setTerms` reverts `BondNeedsWindow()` on a nonzero bond with window 0, so no bonded job can have window 0, because a bonded fund must match registered terms.
  2. **The hub and the runner.** Offer validation refuses a positive bond with `reviewWindow` absent or 0, so the hub will not publish such an offer and the runner will not sign it.
  3. **The seller wizard** cannot express the combination.
- **No migration.** No v2 offer exists yet, and the phone's offers carry no bond.

**How the fleet carries the Lock.** Before settling a bonded v2 escrow payment, the hub asks the seller's runner for `Lock(jobId)` over the runner link. The runner signs only for an offer it serves, at exactly that offer's bond.

- A refusal or a timeout answers 409 `seller-declined` before anything is charged.
- The signature travels into `fund` as `lockSig`. On Whitechain it goes through the relay's `/settle`.

### The decisions

1. **The terms come from signatures, never from the arbiter.**
   - `bond` and `reviewWindow` come from the offer the seller published, and the buyer countersigns them inside `jobId`.
   - `fund` stays open to anyone holding the countersignature. A front-runner cannot strip or change the bond or the window: any other value is another `jobId`, and the token nonce the buyer signed no longer matches. **This kills M1.**
2. **The arbiter keeps exactly one job:** `failDelivery` on a gate failure.
   - It cannot fund on other terms, set a bond or set a window.
   - On Arc it is the production hub's relayer, the signer that runs the gate (`0xE37F64A73225f5eA06BABcb1cc5440F01446C267`), checked on chain from the hub's own fund and release transactions.
   - On Whitechain 1874 it is the relay's signer (`0xa2EEfc657138eE5367291F8e2Ac45BAC28486006`).
3. **The contract binds the bond it locks to what the payee registered (C1).** This is the part the captain's re-audit checks; see the next section.
4. **The bond economics (C2 and the review window).**
   - **A deadline default pays the buyer `amount + bond`,** so not delivering costs the seller.
   - **A dispute inside the review window pays the buyer `amount + bond`,** so junk costs the same as no delivery.
   - **A dispute before delivery refunds the amount and returns the bond to the payee.**
     - Otherwise any buyer could buy a bonded offer and dispute at once, before the seller had any chance to deliver, and take the bond for nothing.
     - This is a deliberate line, for the re-audit to confirm.
   - **A voluntary cancel by the payee returns the bond:** until the deadline on a Funded job, or at any time on a Delivered one.
   - **A gate failure** (`failDelivery`, until `settleBy`) pays the buyer `amount + bond`.
   - **A release, an accept or an elapsed window** pays the payee `amount - toll` and returns the bond.
   - **Aggressive disputes are the accepted trade tonight,** held in check by short windows and by reputation.
5. **H1.** `settleBy = deadline + DISPUTE_WINDOW`, the audit's name, with `DISPUTE_WINDOW` a constant 600 seconds.
   - `release` and `failDelivery` may land until `settleBy`, and `refund` opens only after it.
   - The release shares that window so that an honest release mined a few seconds late does not forfeit the bond.
6. **The lows.**
   - **L1.** The toll accrues in `tollAccrued`, and anyone may call `sweepToll()`. A blocklisted treasury then stalls only the sweep.
   - **L2.** A payee that is the escrow itself is refused: `BadPayee`.
   - **L3.** Every boundary follows one rule. "Until T" means `now <= T`; "after T" means `now > T`.

### How the contract binds the locked bond to the payee (C1, for the re-audit)

The buyer chooses every value in `Countersign`, including `bond`, `reviewWindow`, `amount` and `deadline`, and `fund` is open. If funding locked whatever bond the countersignature names, C1 would come back in a new form, and the new economics make it worse:

- **Any buyer could name any bonded payee.** It could lock that payee's whole free bond on an offer the payee never bonded, or at a price the payee never asked, or with a deadline already about to pass.
- **Then it collects.** It waits for the default, or disputes after a delivery, and takes `amount + bond`. No arbiter is needed.

**The binding is an on-chain registry that only the payee writes.**

```solidity
struct BondTerms { uint256 price; uint256 bond; uint64 reviewWindow; uint64 minDuration; }
mapping(address payee => mapping(bytes32 offerHash => BondTerms)) public termsOf;

/// The payee states, for one of its offers, the only bond and window any job on that offer may carry.
/// msg.sender is the payee. One transaction per offer, at publish; calling it again replaces the terms
/// for jobs funded afterwards and never touches a job already funded.
function setTerms(bytes32 offerHash, uint256 price, uint256 bond, uint64 reviewWindow, uint64 minDuration) external;
```

`setTerms` reverts on any of these:

- `bond > price` (`BondTooHigh`), which caps the bond at the job's amount, per the audit;
- `reviewWindow > 86400` (`ReviewTooLong`);
- `msg.sender == address(this)` (`BadPayee`).

**At funding.** When `cs.bond > 0` or `cs.reviewWindow > 0`, `fund` requires `t = termsOf[cs.payee][offerHash]` to match exactly, and reverts `TermsMismatch(jobId)` otherwise:

- `cs.bond == t.bond`;
- `cs.reviewWindow == t.reviewWindow`;
- `cs.amount == t.price`;
- `cs.deadline >= block.timestamp + t.minDuration`.

Only then does it move `cs.bond` from `bondOf[cs.payee]` into the job, and it reverts `BondMissing` when the free bond is short. A job with bond 0 and window 0 needs no registered terms, exactly as in v1.

**Why this closes C1:**

- **A bond moves only on a job that matches, field for field, terms the payee registered itself.** That means one of the payee's offers, the payee's own price, its bond, its window, and a deadline at least `minDuration` away.
- **The deadline cannot be a trap.** The minimum duration means a buyer cannot fund a bonded job whose deadline is about to pass, so the payee always has time to deliver or to cancel and keep its bond.
- **The arbiter gains nothing over any other caller,** because it cannot fund on other terms either.
- **Any change to bond, window, amount or deadline also changes `jobId`,** so the buyer's own token signature stops matching. Nobody but the buyer can change them.

**What the registry does not stop: the accepted trade.**

- A buyer can still buy a registered, windowed offer at its real terms, take a delivery, dispute inside the window and receive `amount + bond`.
- A seller who registers a bond on a windowed offer accepts that any buyer can claim it by disputing. That is the captain's accepted trade, held in check by short windows, small bonds and the public `Disputed` record.

**The rejected alternative: verify the seller's publish signature on chain.** That needs `offerHash` to commit to price, bond and window in a form the contract can recompute, so every offer's hash would change. A one-line registry is smaller to build and to audit tonight.

### Terms of a job

| Term | Comes from | Bound by |
|---|---|---|
| `offerHash`, `buyer`, `payee`, `amount`, `deadline`, `salt` | the buyer's countersignature | `jobId`, which is the token nonce the buyer signed |
| `bond`, `reviewWindow` | the published offer (`offer.bond`, `offer.reviewWindow`) | `jobId`, and the payee's registered `termsOf[payee][offerHash]` when either is non-zero |
| `arbiter` | constructor, immutable | the production hub's relayer on Arc (`0xE37F…C267`), and the relay key on 1874 (`0xa2EE…6006`) |

The v2 countersignature:

```
Countersign(bytes32 offerHash,address buyer,address payee,uint256 amount,uint64 deadline,uint256 salt,uint256 bond,uint64 reviewWindow)
```

It is signed under the same domain `{name: "Countersign", version: "1", chainId, verifyingContract: escrow}`. `jobIdFor` takes the two extra arguments. The buyer signs one message, as in v1: the token's `ReceiveWithAuthorization` with `nonce = jobId`. The `Countersignature` calldata struct gains `bond` and `reviewWindow`.

### Time boundaries (L3)

| Boundary | Until it | After it |
|---|---|---|
| `deadline` | the payee may `cancel` an undelivered job; the buyer may `dispute` an undelivered job | an undelivered job is in default |
| `settleBy = deadline + DISPUTE_WINDOW` (H1) | `release` and `failDelivery` may land | `refund` opens |
| `endsAt = deliveredAt + reviewWindow` | the buyer may `dispute` a delivered job | `releaseAfterWindow` opens |

### States

| # | Status | Meaning | Final |
|---|---|---|---|
| 0 | None | no such job | |
| 1 | Funded | the payment is held, and the bond is locked if there is one | |
| 2 | Released | the seller is paid, and the bond is back | yes |
| 3 | Refunded | the buyer has the payment back: by the payee's cancel (bond back to the payee), or by default after `settleBy` (bond to the buyer) | yes |
| 4 | Failed | the hub's gate failed the delivery: the buyer has the payment and the bond | yes |
| 5 | Delivered | the slip hash is on chain and the review window is running | |
| 6 | Disputed | the buyer disputed: the payment back, plus the bond if the dispute came inside the window | yes |

### Transitions

| From | Call | Who | When | To | Money | Bond | Events |
|---|---|---|---|---|---|---|---|
| None | `fund(offerHash, cs)` | anyone, with the buyer's countersignature | `deadline > now`; payee is neither zero nor the escrow; a non-zero bond or window matches `termsOf` (C1) | Funded | pulled from the buyer | locked from the payee's free bond | `Funded`, `BondLocked` |
| Funded | `release(jobId, slipHash, sellerSig)`, window 0 | anyone, with the payee's `Release(jobId, slipHash)` signature | until `settleBy` | Released | `amount - toll` to the payee; the toll accrues | returned to the payee | `Released`, `BondReturned` |
| Funded | `release(jobId, slipHash, sellerSig)`, window > 0 | the same | until `settleBy` | Delivered | held | held | `Delivered(jobId, slipHash, deliveredAt, endsAt)` |
| Delivered | `accept(jobId, buyerSig)` | the buyer, or anyone with the buyer's `Accept(jobId, slipHash)` signature | any time while Delivered | Released | paid as above | returned | `Accepted`, `Released`, `BondReturned` |
| Delivered | `releaseAfterWindow(jobId)` | anyone | after `endsAt` | Released | paid as above | returned | `WindowElapsed`, `Released`, `BondReturned` |
| Delivered | `dispute(jobId, buyerSig)` | the buyer, or anyone with the buyer's `Dispute(jobId)` signature | until `endsAt` | Disputed | refunded to the buyer at once | **paid to the buyer** | `Disputed`, `Refunded(false)`, `BondForfeited` |
| Funded | `dispute(jobId, buyerSig)` | the same | until `deadline` | Disputed | refunded to the buyer at once | returned to the payee | `Disputed`, `Refunded(false)`, `BondReturned` |
| Funded | `failDelivery(jobId)` | arbiter only | until `settleBy` | Failed | refunded to the buyer | **paid to the buyer** | `DeliveryFailed(jobId, buyer, amount, bond)` |
| Funded | `refund(jobId)` | anyone | after `settleBy` | Refunded | refunded to the buyer | **paid to the buyer** (C2) | `Refunded(false)`, `BondForfeited` |
| Funded | `cancel(jobId, sellerSig)` | the payee, or anyone with the payee's `Cancel(jobId)` signature | until `deadline` | Refunded | refunded to the buyer | returned to the payee | `Refunded(true)`, `BondReturned` |
| Delivered | `cancel(jobId, sellerSig)` | the same | any time while Delivered | Refunded | refunded to the buyer | returned to the payee | the same |
| any | `setTerms(offerHash, price, bond, reviewWindow, minDuration)` | the payee itself | any time | unchanged | none | none | `TermsSet(payee, offerHash, price, bond, reviewWindow, minDuration)` |
| any | `sweepToll()` | anyone | `tollAccrued > 0` | unchanged | `tollAccrued` to the treasury | none | `TollSwept` |

A cancel after the deadline on a Funded job reverts `DeadlinePassed`. Otherwise a defaulting seller could cancel late and keep its bond.

### Who does what

- **The seller,** when it publishes an offer with a bond or a window on a v2 escrow:
  - calls `setTerms` once with the offer's price, bond, window and `minDuration`;
  - keeps enough free bond (`depositBond`).
  - The runner's `bond` command gains `terms`.
- **The hub:**
  - quotes `extra.bond` and `extra.reviewWindow` from the offer, plus `extra.escrowVersion: 2`;
  - funds with `fund(offerHash, cs)`;
  - runs its gate after delivery. If it passes, it submits `release`. If it fails, it submits `failDelivery` until `settleBy`.
  - Its janitor calls `releaseAfterWindow` after `endsAt` and `refund` after `settleBy`, and sweeps the toll.
  - It relays the buyer's `Accept` and `Dispute` signatures (`POST /jobs/:id/accept` and `/dispute`).
- **The buyer agent:**
  - checks the 402's bond and window against the offer;
  - derives the v2 `jobId` only for a pinned v2 escrow;
  - signs `Accept` or `Dispute`, and submits them itself when the hub does not relay them (cs-w1 on #130).
- **The runner:**
  - checks the job on chain before it works (`jobOf`, plus `bondOfJob` and `reviewOf` on v2);
  - cancels by the deadline any job it will not serve, so it keeps the bond.

### Events added in v2

```solidity
event BondDeposited(address indexed payee, uint256 amount);
event BondWithdrawn(address indexed payee, uint256 amount);
event BondLocked(bytes32 indexed jobId, address indexed payee, uint256 bond);
event BondReturned(bytes32 indexed jobId, address indexed payee, uint256 bond);
event BondForfeited(bytes32 indexed jobId, address indexed buyer, uint256 bond);
event TermsSet(address indexed payee, bytes32 indexed offerHash, uint256 price, uint256 bond, uint64 reviewWindow, uint64 minDuration);
event DeliveryFailed(bytes32 indexed jobId, address indexed buyer, uint256 amount, uint256 bond);
event Delivered(bytes32 indexed jobId, bytes32 indexed slipHash, uint64 deliveredAt, uint64 reviewEndsAt);
event Accepted(bytes32 indexed jobId, address indexed buyer);
event WindowElapsed(bytes32 indexed jobId);
event Disputed(bytes32 indexed jobId, address indexed buyer);
event TollSwept(address indexed treasury, uint256 amount);
```

`BondReturned` and `BondForfeited` are emitted only for a non-zero bond.

### Errors added in v2

| Error | When |
|---|---|
| `NotArbiter()` | `failDelivery` by anyone but the arbiter |
| `TermsMismatch(bytes32 jobId)` | a non-zero bond or window that is not exactly the payee's registered terms, or a deadline sooner than `minDuration` (C1) |
| `BondTooHigh(uint256 bond, uint256 price)` | `setTerms` with a bond above the price |
| `BondMissing(address payee, uint256 needed, uint256 available)` | locking or withdrawing more than the free bond |
| `BadPayee(address payee)` | a payee that is the escrow itself (L2) |
| `ReviewTooLong(uint64 reviewWindow)` | a window above 86400 seconds |
| `SettleWindowClosed(bytes32 jobId, uint256 settleBy)` | `release` or `failDelivery` after `settleBy` |
| `SettleWindowOpen(bytes32 jobId, uint256 settleBy)` | `refund` until `settleBy` |
| `NotBuyer(bytes32 jobId)` | `accept` or `dispute` without the buyer as sender or signer |
| `NotDelivered(bytes32 jobId)` | `accept` or `releaseAfterWindow` on a job that is not Delivered |
| `ReviewOpen(bytes32 jobId, uint64 endsAt)` | `releaseAfterWindow` until `endsAt` |
| `ReviewClosed(bytes32 jobId, uint64 endsAt)` | `dispute` on a Delivered job after `endsAt` |
| `NotOpen(bytes32 jobId)` | `dispute` or `cancel` on a job that is neither Funded nor Delivered |

`DeadlinePassed` also covers `cancel` and `dispute` on a Funded job after the deadline.

### Trust and limits

1. **The bond is the payee's to offer (C1).** It moves only on a job that matches the payee's own registered terms, and it is capped at the price.
   - **The arbiter can still fail an honest delivery** and pay the bond to the buyer. The bond is as strong as the hub's gate, and no larger than the price.
   - **A buyer can dispute any windowed delivery and take the bond.** That is the accepted trade.
2. **The arbiter cannot fund on its own terms, and holds no other power.** If its key is lost, gate failures fall back to the default refund after `settleBy`, which also pays the bond to the buyer.
3. **Silence costs the bond (C2).** A seller that will not serve a job must cancel it by the deadline. A seller whose runner goes offline after a bonded job is funded loses that job's bond.
4. **A payee watching the mempool can cancel ahead of a pending `failDelivery`** and keep its bond. The buyer is refunded at once either way.
5. **On a window-0 offer, the payee's own `Release` signature moves the payment, as in v1.** A review window is the buyer's protection against a payee that releases without delivering.
6. **The toll accrues in the escrow (L1),** so a blocklisted treasury delays only `sweepToll`.

### Regression tests

Each forge test below fails on the contract as it stands on `main` before the fix, and passes after. Rajdeep shows red before green. Each test is named for its finding.

**C1: the binding**

1. `test_C1_no_bond_without_registered_terms`: the audit's sequence. A buyer the attacker controls funds a job naming a bonded payee, with that payee's whole bond, on an offer the payee never registered. Expect `TermsMismatch`, with the free bond unchanged.
2. `test_C1_each_term_must_match`: against the payee's registered terms, each of these reverts `TermsMismatch`:
   - `bond + 1`;
   - another window;
   - another price;
   - a deadline sooner than `minDuration`;
   - another `offerHash`.
3. `test_C1_only_the_payee_sets_its_terms`: `setTerms` from any other address writes only that address's own entry, and moves nothing of the payee's.
4. `test_C1_bond_capped_at_the_price`: `setTerms` with `bond > price` reverts `BondTooHigh`.
5. `test_C1_registered_terms_lock_exactly_the_bond`.

**M1**

6. `test_M1_front_run_with_other_terms_fails`: the same signature with another bond or window reverts `CountersignatureMismatch`.
7. `test_M1_front_run_with_the_same_terms_is_harmless`: the exact calldata from a stranger opens exactly the signed job, and the second submission reverts `JobExists`.

**C2 and the economics**

8. `test_C2_default_pays_amount_plus_bond`: refund after `settleBy` pays the buyer `amount + bond`, and emits `BondForfeited`.
9. `test_C2_cancel_by_the_deadline_returns_the_bond`.
10. `test_C2_cancel_after_the_deadline_reverts`.
11. `test_dispute_inside_the_window_pays_amount_plus_bond`.
12. `test_dispute_before_delivery_returns_the_bond_to_the_payee`.
13. `test_failDelivery_pays_amount_plus_bond`, and `failDelivery` by a non-arbiter reverts `NotArbiter`.

**H1 and L3**

14. `test_H1_failDelivery_and_release_land_until_settleBy`.
15. `test_H1_refund_waits_for_settleBy`.
16. `testFuzz_L3_one_rule_for_every_boundary`.

**L1 and L2**

17. `test_L1_blocklisted_treasury_does_not_block_release`.
18. `test_L2_the_payee_cannot_be_the_escrow`.

**Conservation**

19. `invariant_conservation`: the token balance equals the sum of these:
    - the amounts held in Funded and Delivered jobs;
    - every free bond;
    - every locked bond;
    - `tollAccrued`.

**Kept or flipped**

- `W1Bond.t.sol`'s B16 stays green. The deploy gate holds through the registry.
- `W1Attacks.t.sol` stays green.
- `Bond.t.sol` changes where C2 changes the silent seller's outcome.
- #130's `Acceptance.t.sol` flips where the economics change:
  - test 4: a silent seller now forfeits the bond;
  - test 2: a dispute inside the window now pays `amount + bond`;
  - `_fund` now registers terms and countersigns bond and window.
- A shared vector proves the TypeScript and Solidity v2 `jobId` agree.
