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
| `erc8183` | `eip155:5042002` (Arc testnet) | `countersign` | escrow | hub |
| `whitechain` | `eip155:1874` (Whitechain Sepolia) | `countersign` | escrow | relayer |
| `eip3009` | `eip155:5042002` (Arc testnet) | `exact` | direct | hub |
| `hedera` | `hedera:testnet` | `exact` | direct | facilitator |
| `gateway` | `eip155:5042002` | `exact` (GatewayWalletBatched) | batched | Circle Gateway |

Headers follow x402 v2: `PAYMENT-REQUIRED` on the 402, `PAYMENT-SIGNATURE` on the paid retry and `PAYMENT-RESPONSE` on the answer, each holding base64 JSON.

## erc8183

An ERC-8183 job escrow on Arc testnet, declared beside the `escrow` rail. Same interface. Code: `packages/rail/src/erc8183/`, contract: `contracts/src/erc8183/ERC8183Escrow.sol`. The constants for Arc testnet (chain 5042002, USDC `0x3600000000000000000000000000000000000000`, explorer `https://explorer.testnet.arc.io/tx/{tx}`) live on `ARC_ERC8183`. The escrow address and its hook are arguments, because neither contract is deployed. The hub does not load this rail.

`challenge` offers scheme `countersign`. The 402's `extra` names the rail, the escrow, the hook, the chain and the offer hash. `verify` checks the countersignature the way the escrow rail does, and refuses a bond, escrow v2 terms, or a hook other than this rail's. `settle` calls `fund`, which opens one job and pulls the budget with the buyer's EIP-3009 authorisation. That one transaction is this contract's form of `createJob`, `setBudget` and `fund`: the buyer pays no gas. The client is the buyer, the provider is the payee, the budget is the amount, and the expiry is the deadline. The evaluator is fixed when the contract is deployed, and it is the address that must submit settlement.

`escrow.release` calls `complete`. The provider's EIP-712 `Release(jobId, slipHash)` is required, and only the evaluator may submit it. `complete` moves the job from Funded through Submitted to Completed, pays the provider less the toll, and calls the job hook around both steps. The hook is `SlipHook`, deployed by the escrow's constructor. Its `afterAction` on `complete` emits `SlipCommitted(acpJobId, jobId, slipHash)`. That event is the slip commitment. A zero slip hash is refused before a transaction is sent.

`escrow.refund` is `claimRefund` after the deadline. It is not hooked, so a hook cannot block the expiry refund. `escrow.cancel` is `reject` with the provider's `Cancel(jobId)` signature, and it returns the budget to the buyer.

The hook interface is `IJobHook`: `beforeAction` and `afterAction`. This is a minimal ERC-8183, not the upgradeable reference contract. Every job uses the escrow's own `SlipHook`. There is no bond and no separate `submit` transaction.

## eip3009

A direct USDC transfer on Arc testnet, under the token's own EIP-712 domain: `{name: "USDC", version: "2", chainId: 5042002, verifyingContract: 0x3600000000000000000000000000000000000000}`. The buyer signs `TransferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce)` straight to the seller, in x402's `exact` payload shape.

The hub checks the signature recovers to `from`, that `to` is the offered payee, `value` is the price, the validity window is current and inside this rail's window (`now + 6 <= validBefore <= now + maxTimeoutSeconds + 30`), the nonce is unused on chain, and the payer's balance covers the amount. It then submits `transferWithAuthorization` with its relayer account, so the buyer pays no gas.

Settlement is final in the Arc block that includes the transfer, before the work is dispatched. A failed delivery is therefore not refunded automatically; the slip records the failure. This is the same finality as the gateway rail and unlike escrow.

## Router

`chooseRail(offer, caps, declarations, health, now)` in `packages/rail/src/router.ts` is the pure selection policy. It returns every rail in `offer.rails` with a trace entry, the eligible candidates in order, the chosen rail and one plain sentence saying why.

A rail is eligible when the hub declares it, the buyer's `rails` cap (if any) names it, and its `finalitySeconds` is within the buyer's `maxFinalitySeconds` (if any). A missing finality is rejected by a cap; an undeclared cost counts as `{tollBps: 0, fixed: "0"}`. Cost is `floor(price * tollBps / 10000) + fixed`, as an atomic string. A rail is **protected** when its declaration `kind` is `escrow`; every other kind is unprotected. A rail is degraded when it has at least two failures and the last one was at most ten minutes ago. The health record is per rail and offer: the caller passes only this offer's record.

Candidates sort healthy before degraded. Without an opt-in they then sort protected before unprotected, then by cost, then by `finalitySeconds` (undeclared last), then by rail id. A buyer opts in with `allowUnprotected` (`X-Countersign-Allow-Unprotected: 1`) or by naming at least one unprotected rail in `X-Countersign-Rails`; cost then competes across both kinds. Unprotected rails stay eligible and listed either way. The chosen rail is the first candidate. The trace gives each eligible rail its rank (`chosen`, `fallback 1`, ...) or the reason it was refused; an unprotected fallback pushed down by protection says it does not refund the buyer and is listed after the escrow rails. The reason names protection, or the degraded or demoted rail that forced the fallback.

The hub reads buyer caps only from `X-Countersign-Rails` (comma-separated ids), `X-Countersign-Max-Finality` (a positive integer) and `X-Countersign-Allow-Unprotected` (`1`); malformed values are ignored. It keeps failures in memory per rail and offer, records `challenge-failed`, `settle-failed` and `settled` attempts for ten minutes with at most twenty per key, and puts `{chosen, reason, trace}` on the 402's `extensions.route`. A failed settle demotes that rail for the next 402. On success the slip's `settlement.route` is `{chosen, reason, attempts}`, carrying at most the last five attempts; like `settlement.receipt`, it sits outside `SlipBody`, so `slipCommitHash` is unchanged. `/healthz` reports the policy, health grouped by rail as a count of degraded offers, and the last twenty decisions.

## Who pays, and from which wallet

The person's wallet on EVM, the agent's account on Hedera, one envelope over both.

| Class of user | Wallet | Rails | Status |
|---|---|---|---|
| Wants an embedded wallet | Privy, signing in with email or a passkey | Arc; Whitechain | `IN PROGRESS`. Being built for Arc, with no production purchase yet. Whitechain is not configured yet |
| Holds their own Hedera wallet | HashPack, Blade or Kabila through WalletConnect | Hedera | `IN PROGRESS` until its proof lands. It will be a direct payment, so a failed delivery is not returned |
| Does not want a wallet | The agent's own Hedera account `0.0.11337064`, funded and bounded by the human's envelope; the human never holds a Hedera key | Hedera | Live on the production hub, held by default |

Privy has no Hedera, and none of these is one wallet for every rail.

Two things are true today and differ from the table's end state:
- The EVM rails are paid by the buyer agent's own key (`CS_BUYER_KEY`).
- The EVM buyer and the Hedera agent apply the same envelope rules but keep separate budgets. One shared budget is not built yet.

Each status, with its evidence: [status.md](../status.md).
