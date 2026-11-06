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
depositBond(address payee, uint256 amount, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)
withdrawBond(uint256 amount)
release(bytes32 jobId, bytes32 slipHash, bytes sellerSig)
refund(bytes32 jobId)
cancel(bytes32 jobId, bytes sellerSig)
failDelivery(bytes32 jobId)
```

- **fund**: derives `jobId` from the terms, checks the buyer's signature, then pulls `amount` from the buyer with the token's EIP-3009 `receiveWithAuthorization`. Anyone may submit it: the hub, a relayer, or the buyer. The buyer pays no gas. It locks no bond.
- **fundBonded**: the same path as `fund`, plus it moves `bond` from the payee's free bond into the job. It reverts `BondMissing(payee, bond, available)` when the free bond is short.
- **depositBond**: credits a payee's free bond from an EIP-3009 authorisation signed by that payee. Anyone may submit it; the escrow checks the exact balance delta. A zero amount reverts `ZeroAmount`.
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
