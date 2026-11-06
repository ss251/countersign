# Rail

One interface, three methods, one slip shape. Nothing above a rail knows which chain it is on. Code: `packages/rail/src/rail.ts`.

```ts
interface Rail {
  declaration: RailDeclaration;
  challenge(offer, ctx): PaymentRequirements;
  verify(payment, requirements): Promise<VerifyResult>;
  settle(payment, requirements): Promise<SettleResult>;
  escrow?: { release; refund; cancel; status };
}
```

The three methods are the x402 v2 facilitator trio: `challenge` builds one entry of a 402's `accepts`, `verify` checks a payment without moving money, and `settle` moves it. On an escrow rail, `settle` funds the escrow, and the job then closes through `escrow.release`, `escrow.refund` or `escrow.cancel`.

`RailDeclaration` is published on `/rails` and named on every slip. It holds the rail id, the CAIP-2 network, the scheme, the asset, the kind (`escrow`, `direct` or `batched`), the escrow address, who pays gas, one plain sentence on finality, and an explorer template.

| Rail | Network | Scheme | Kind | Gas paid by |
|---|---|---|---|---|
| `escrow` | `eip155:5042002` (Arc testnet) | `countersign` | escrow | hub |
| `whitechain` | `eip155:1874` (Whitechain Sepolia) | `countersign` | escrow | relayer |
| `eip3009` | `eip155:5042002` (Arc testnet) | `exact` | direct | hub |
| `hedera` | `hedera:testnet` | `exact` | direct | facilitator |
| `gateway` | `eip155:5042002` | `exact` (GatewayWalletBatched) | batched | Circle Gateway |

Headers follow x402 v2: `PAYMENT-REQUIRED` on the 402, `PAYMENT-SIGNATURE` on the paid retry and `PAYMENT-RESPONSE` on the answer, each holding base64 JSON.

## eip3009

A direct USDC transfer on Arc testnet, under the token's own EIP-712 domain: `{name: "USDC", version: "2", chainId: 5042002, verifyingContract: 0x3600000000000000000000000000000000000000}`. The buyer signs `TransferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce)` straight to the seller, in x402's `exact` payload shape.

The hub checks the signature recovers to `from`, that `to` is the offered payee, `value` is the price, the validity window is current and inside this rail's window (`now + 6 <= validBefore <= now + maxTimeoutSeconds + 30`), the nonce is unused on chain, and the payer's balance covers the amount. It then submits `transferWithAuthorization` with its relayer account, so the buyer pays no gas.

Settlement is final in the Arc block that includes the transfer, before the work is dispatched. A failed delivery is therefore not refunded automatically; the slip records the failure. This is the same finality as the gateway rail and unlike escrow.
