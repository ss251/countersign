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

## Router

`chooseRail(offer, caps, declarations, health, now)` in `packages/rail/src/router.ts` is the pure selection policy. It returns every rail in `offer.rails` with a trace entry, the eligible candidates in order, the chosen rail and one plain sentence saying why.

A rail is eligible when the hub declares it, the buyer's `rails` cap (if any) names it, and its `finalitySeconds` is within the buyer's `maxFinalitySeconds` (if any). A missing finality is rejected by a cap; an undeclared cost counts as `{tollBps: 0, fixed: "0"}`. Cost is `floor(price * tollBps / 10000) + fixed`, as an atomic string. A rail is degraded when it has at least two failures and the last one was at most ten minutes ago.

Candidates sort healthy before degraded, then by cost, then by `finalitySeconds` (undeclared last), then by rail id. The chosen rail is the first candidate. The trace gives each eligible rail its rank (`chosen`, `fallback 1`, ...) or the reason it was refused.

The hub reads buyer caps only from `X-Countersign-Rails` (comma-separated ids) and `X-Countersign-Max-Finality` (a positive integer); malformed values are ignored. It keeps failures in memory, records `challenge-failed`, `settle-failed` and `settled` attempts for ten minutes, and puts `{chosen, reason, trace}` on the 402's `extensions.route`. A failed settle demotes that rail for the next 402. On success the slip's `settlement.route` is `{chosen, reason, attempts}`; like `settlement.receipt`, it sits outside `SlipBody`, so `slipCommitHash` is unchanged. `/healthz` reports the policy, the health record and the last twenty decisions.
