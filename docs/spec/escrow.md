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

## Escrow v2: seller bond, delivery review and dispute (design, 06 Nov)

This section is a design, not deployed code. The bond is built on a branch ([#93](https://github.com/ss251/countersign/issues/93)) and not merged. Review and dispute have no code yet ([#98](https://github.com/ss251/countersign/issues/98)). The plan is to ship both as one contract and one testnet deployment on Arc (through Studio) and Whitechain (forge). The v1 deployments in the table above stay listed, so slips minted on them still verify. v2 keeps the `Job` struct, `jobOf` and the `Released` event exactly as they are, so the verifier reads both versions the same way.

### Terms of a job

| Term | Comes from | Bound by |
|---|---|---|
| `offerHash`, `buyer`, `payee`, `amount`, `deadline`, `salt` | the buyer's countersignature | `jobId`, which is the token nonce the buyer signed |
| `bond` | `offer.bond` (atomic) | fixed at funding by the arbiter; readable as `bondOfJob(jobId)` |
| `reviewWindow` | `offer.reviewWindow` (seconds, 0 to 86400, default 0) | fixed at funding by the arbiter; readable as `reviewOf(jobId)` |
| `arbiter` | constructor, immutable | the hub's relayer on Arc; the relay's key on Whitechain |

The buyer checks `extra.bond` and `extra.reviewWindow` in the 402 against the offer before countersigning. `fundBonded`, the only way to set a non-zero bond or window, is restricted to the arbiter, so no third party can fund a job on other terms with a countersignature it observed. `fund` stays permissionless and means bond 0 and window 0, exactly as in v1.

### States

| # | Status | Meaning | Final |
|---|---|---|---|
| 0 | None | no such job | |
| 1 | Funded | the payment is held, and the bond is locked if there is one | |
| 2 | Released | the seller is paid | yes |
| 3 | Refunded | the buyer has the payment back: the deadline passed with no delivery, or the payee cancelled | yes |
| 4 | Failed | the hub's gate failed the delivery: the buyer has the payment and the bond | yes |
| 5 | Delivered | the slip hash is on chain and the review window is running | |
| 6 | Disputed | the buyer disputed: the buyer has the payment back | yes |

### Transitions

| From | Call | Who | When | To | Money | Bond | Events |
|---|---|---|---|---|---|---|---|
| None | `fund(offerHash, cs)` | anyone, with the buyer's countersignature | `deadline` in the future | Funded | pulled from the buyer | none | `Funded` |
| None | `fundBonded(offerHash, cs, bond, reviewWindow)` | arbiter | `deadline` in the future; `bondOf[payee] >= bond` | Funded | pulled from the buyer | locked from the payee's free bond | `Funded`, `BondLocked` |
| Funded | `release(jobId, slipHash, sellerSig)`, window 0 | anyone, with the payee's `Release(jobId, slipHash)` signature | `now <= deadline` | Released | paid: `amount - toll` to the payee, `toll` to the treasury | returned to the payee | `Released`, `BondReturned` |
| Funded | `release(jobId, slipHash, sellerSig)`, window > 0 | the same | `now <= deadline` | Delivered | held | held | `Delivered(jobId, slipHash, deliveredAt, reviewEndsAt)` |
| Delivered | `accept(jobId, buyerSig)` | the buyer, or anyone with the buyer's `Accept(jobId, slipHash)` signature | any time while Delivered | Released | paid as above | returned | `Accepted`, `Released`, `BondReturned` |
| Delivered | `releaseAfterWindow(jobId)` | anyone | `now >= deliveredAt + reviewWindow` | Released | paid as above | returned | `WindowElapsed`, `Released`, `BondReturned` |
| Funded | `dispute(jobId, buyerSig)` | the buyer, or anyone with the buyer's `Dispute(jobId)` signature | `now <= deadline` | Disputed | refunded to the buyer at once | returned | `Disputed`, `Refunded(byPayee = false)`, `BondReturned` |
| Delivered | `dispute(jobId, buyerSig)` | the same | `now < deliveredAt + reviewWindow` | Disputed | refunded to the buyer at once | returned | the same |
| Funded | `refund(jobId)` | anyone | `now > deadline` | Refunded | refunded to the buyer | returned | `Refunded(false)`, `BondReturned` |
| Funded or Delivered | `cancel(jobId, sellerSig)` | the payee, or anyone with the payee's `Cancel(jobId)` signature | any time while open | Refunded | refunded to the buyer | returned | `Refunded(true)`, `BondReturned` |
| Funded | `failDelivery(jobId)` | arbiter | `now <= deadline` | Failed | refunded to the buyer | **paid to the buyer** | `DeliveryFailed(jobId, buyer, amount, bond)` |

**Disputes and the deadline.**

- **Before delivery,** a dispute is allowed up to the deadline, because after it the job is refundable by anyone.
- **After delivery,** a dispute is allowed for the whole review window, even when the window runs past the deadline. The deadline governs delivery; the window governs review.
- **A dispute refunds at once.** Waiting for the deadline would protect no one: release is already blocked, and there is no arbitration to wait for.

**A delivered job is never refunded by the deadline.** The seller delivered in time, so it is released after its window unless the buyer disputes within it or the payee cancels.

### Who does what

- **The hub, the arbiter on Arc,** funds every job:
  - with `fundBonded`, carrying the offer's `bond` and `reviewWindow`;
  - with `fund`, when both are zero.
- **After dispatch,** the hub runs its delivery gate:
  - **gate passes:** it submits `release`. The job closes as Released, or opens as Delivered;
  - **gate fails:** it submits `failDelivery`. The buyer gets the payment back now, and the bond if there is one.
  - A runner error or a timeout is not a gate failure: the deadline refund handles it, and the bond goes back to the seller.
- **The hub's janitor** calls `releaseAfterWindow` for Delivered jobs whose window has ended, and `refund` for Funded jobs past the deadline.
- **The buyer agent** signs `Accept(jobId, slipHash)` or `Dispute(jobId)` with its own key, under the escrow's domain from its pinned rail. The hub relays them, so the buyer pays no gas, or the buyer submits them itself.
- **The seller** may call `releaseAfterWindow` itself once the window ends, and may cancel at any time while the job is open.
- **The phone** shows the review countdown. Acting from the phone needs a relay to the agent, signed by the envelope's approver as in D10. That is a follow-up, so until then the phone names the agent's command.

### Slip and hash

- **The committed hash.** The slip body is complete at delivery. `release` commits its hash, and the `Delivered` and `Released` events carry the same `slipHash`.
- **Where the review record lives.** The review outcome does not exist when the hash is computed, so it sits outside the committed body: `slip.settlement.review = {window, deliveredAt, endsAt, outcome?, tx?}`, beside `settlement.receipt`. The outcome is `accepted`, `disputed` or `window-elapsed`.
  - A slip handed over at delivery says it is in review until `endsAt`.
  - The hub updates its stored copy when the outcome lands.
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
event DeliveryFailed(bytes32 indexed jobId, address indexed buyer, uint256 amount, uint256 bond);
event Delivered(bytes32 indexed jobId, bytes32 indexed slipHash, uint64 deliveredAt, uint64 reviewEndsAt);
event Accepted(bytes32 indexed jobId, address indexed buyer);
event WindowElapsed(bytes32 indexed jobId);
event Disputed(bytes32 indexed jobId, address indexed buyer);
```

`BondReturned` is emitted only when the bond is non-zero.

### Errors added in v2

| Error | When |
|---|---|
| `NotArbiter()` | `fundBonded` or `failDelivery` by anyone but the arbiter |
| `BondMissing(address payee, uint256 needed, uint256 available)` | funding or withdrawing more than the free bond |
| `NotBuyer(bytes32 jobId)` | `accept` or `dispute` without the buyer as sender or signer |
| `NotDelivered(bytes32 jobId)` | `accept` or `releaseAfterWindow` on a job that is not Delivered |
| `ReviewOpen(bytes32 jobId, uint64 endsAt)` | `releaseAfterWindow` before the window ends |
| `ReviewClosed(bytes32 jobId, uint64 endsAt)` | `dispute` on a Delivered job at or after the window's end |
| `NotOpen(bytes32 jobId)` | `dispute` or `cancel` on a job that is neither Funded nor Delivered |

The v1 errors keep their meaning.

### Trust and limits

1. **Bond and window.** The arbiter sets them at funding, from the offer. The buyer's countersignature does not cover them.
   - The buyer checks them in the 402, and anyone can audit them on chain with `bondOfJob` and `reviewOf`.
   - Binding them into `Countersign` is a later revision. It changes `jobId`, so it waits for a deployment of its own.
2. **Gate failure.** The arbiter decides it and so can slash a bond. The bond is exactly as strong as the hub's delivery gate.
3. **Disputes.** A buyer can dispute any delivery inside the window and take the payment back.
   - There is no arbitration, and a dispute never slashes.
   - Disputes are public events, so a buyer's dispute rate is visible to sellers.
   - A seller who does not accept that risk publishes with `reviewWindow` 0 and relies on the gate alone.
4. **Junk that passes the schema.** A seller who delivers it is stopped only by a dispute within the window. Before v2, nothing stopped it.
