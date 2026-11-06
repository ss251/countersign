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
| `hedera` | `hedera:testnet` | `exact` | direct | facilitator |
| `gateway` | `eip155:5042002` | `exact` (GatewayWalletBatched) | batched | Circle Gateway |

Headers follow x402 v2: `PAYMENT-REQUIRED` on the 402, `PAYMENT-SIGNATURE` on the paid retry and `PAYMENT-RESPONSE` on the answer, each holding base64 JSON.
