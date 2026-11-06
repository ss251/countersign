# Escrow

`contracts/src/CountersignedEscrow.sol`. One file, no owner, no pause, no proxy. The token, treasury and toll are fixed at deployment.

| Deployment | Chain | Escrow | Token |
|---|---|---|---|
| Arc testnet | 5042002 | `0x44d11b8909485e3f575F6628b689383E4420f54a` | USDC `0x3600000000000000000000000000000000000000` |
| Whitechain Sepolia | 1874 | `0x9279D3edeef4c3738a0b200D762e2985Ff3B7eb4` | USDT `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7` |

## Functions

```solidity
fund(bytes32 offerHash, Countersignature cs) returns (bytes32 jobId)
release(bytes32 jobId, bytes32 slipHash, bytes sellerSig)
refund(bytes32 jobId)
cancel(bytes32 jobId, bytes sellerSig)
```

- **fund**: derives `jobId` from the terms, checks the buyer's signature, then pulls `amount` from the buyer with the token's EIP-3009 `receiveWithAuthorization`. Anyone may submit it: the hub, a relayer, or the buyer. The buyer pays no gas.
- **release**: allowed until the deadline, inclusive. It needs the payee's EIP-712 `Release(jobId, slipHash)` signature, through ECDSA or ERC-1271, and anyone may submit it. It pays `amount - toll` to the payee and `toll` to the treasury.
- **refund**: allowed only after the deadline, and anyone may call it. It returns the full amount to the buyer.
- **cancel**: the payee's early refund. The payee calls it directly, or anyone submits it with the payee's `Cancel(jobId)` signature. It returns the full amount to the buyer.

Each job closes once: release, refund and cancel all require status `Funded`.

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

## Events

```solidity
event Funded(bytes32 indexed jobId, bytes32 indexed offerHash, address indexed buyer, address payee, uint256 amount, uint64 deadline);
event Released(bytes32 indexed jobId, bytes32 indexed slipHash, address indexed payee, uint256 paid, uint256 toll);
event Refunded(bytes32 indexed jobId, address indexed buyer, uint256 amount, bool byPayee);
```

## Errors

`ZeroAddress`, `ZeroAmount`, `TollTooHigh`, `DeadlineInPast`, `JobExists`, `CountersignatureMismatch`, `TransferShortfall`, `NotFunded`, `DeadlinePassed`, `DeadlineNotReached`, `NotPayee`.

## Toll

`toll = amount * tollBps / 10_000`, rounded down. `tollBps` is at most 1,000 and 100 on both deployments. The treasury is a `FeeSplit` that pays its balance to fixed payees by fixed shares when anyone calls `distribute(token)`.

## Known limits

- If the token blocklists the treasury, every release reverts until the deadline, and then buyers recover by refund. Both deployments use a fresh `FeeSplit` as treasury.
- If the token blocklists a buyer, refund and cancel to that buyer revert. This is inherent to any design that pays the buyer back in the same token.
- Buyers sign with EOAs. The escrow's pre-check uses ECDSA over `v, r, s`.

## Tests

`forge test` runs 29 tests: the eight refusals PLAN §6 requires, plus payee-swap, offer-swap, deadline-extension, expired authorisation, cancel paths, the constructor guards, a toll fuzz, and a vector shared with `packages/core/test/countersign.test.ts` that proves the TypeScript and Solidity `jobId` agree.
