# Countersignature

The buyer's one signature. It binds the offer hash, the payee, the amount, the delivery deadline, the chain and the escrow. Code: `packages/core/src/countersign.ts`. Contract side: [escrow.md](escrow.md).

On escrow rails (scheme `countersign`) the buyer signs the token's EIP-3009 `ReceiveWithAuthorization`. `to` is the escrow, `value` is the amount, and `nonce` is the `jobId` derived from these terms:

```
Countersign(bytes32 offerHash,address buyer,address payee,uint256 amount,uint64 deadline,uint256 salt)
```

The hash is taken under the escrow's EIP-712 domain `{Countersign, 1, chainId, escrow}`. The wire form, `CountersignPayload`, carries the terms, the authorisation fields and the 65-byte signature.

Checks, in order, wherever a countersignature is accepted (`checkCountersign`, the escrow rail's `verify`, and the contract itself):

1. The authorisation's `from`, `to`, `value` and `nonce` equal the buyer, the escrow, the amount and the derived `jobId`.
2. The signature is inside its `validAfter`/`validBefore` window. The contract and the token check the same strict inequalities.
3. The signature recovers to the buyer.
4. On the hub's rail only: the countersigned deadline is no shorter than the offer promises (15 s skew) and no more than 300 s longer, the buyer's balance covers the amount, the nonce is unused, and no job exists.

The buyer agent signs only what the offer it fetched says. Before signing it compares the hub's 402 entry with that offer (payee, amount, offer hash, delivery window) and with a pinned table of known rails (chain, escrow, token, token domain). A hub that names another escrow or payee gets a refusal, not a signature (`packages/buyer/src/terms.ts`).

Token domains used live: Arc testnet USDC is `{name: "USDC", version: "2"}`, and Whitechain Sepolia USDT is `{name: "Tether USD", version: "1"}`. Both were read from each token's `DOMAIN_SEPARATOR()` on 06 Nov.
