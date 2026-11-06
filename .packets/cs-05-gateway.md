# cs-05-gateway — the gateway rail: Circle Gateway nanopayments on Arc testnet

## Setup

Run `bun install` at the worktree root before anything else.

## Goal

Add the `gateway` rail. The buyer pays from a Circle Gateway deposit by signing an x402 v2 `exact` payment under the `GatewayWalletBatched` scheme. Circle Gateway verifies it and debits the buyer at once, and credits the seller in a later batch. The hub never holds the money and never pays gas. Also add a buyer-side helper that signs such a payment, and two ops scripts for the buyer's Gateway deposit and balance.

## Facts, verified live on 06 Nov

- The `@circle-fin/x402-batching@4.0.0` package is installed. Read `node_modules/@circle-fin/x402-batching/dist/server/index.d.ts` and `dist/client/index.d.ts` for the exact signatures.
- `new BatchFacilitatorClient({ url: "https://gateway-api-testnet.circle.com" }).getSupported()` returns, for Arc testnet, this kind: `{"x402Version":2,"scheme":"exact","network":"eip155:5042002","extra":{"name":"GatewayWalletBatched","version":"1","verifyingContract":"0x0077777d7eba4688bdef3e311b846f25870a19b9","minValiditySeconds":604800,"assets":[{"symbol":"USDC","address":"0x3600000000000000000000000000000000000000","decimals":6,"authorizationVersions":["1","2"]}, ...]}}`
- Buyer signing: `new BatchEvmScheme(signer).createPaymentPayload(2, requirements)` returns `{x402Version, payload}`.
- Buyer deposit: `new GatewayClient({ chain: "arcTestnet", privateKey }).deposit("<usdc decimal>")`; the client also has `getBalances()`.
- Circle Gateway credits the seller in batches. Say so in the declaration's `finality` text, and never imply instant credit.

## Lease

You may create or change only these paths:

- `packages/rail/src/gateway/**`
- `packages/rail/test/gateway.test.ts`
- `scripts/gateway/**`
- `.packets/reports/cs-05-gateway.md`

Do not edit any `package.json`, `bun.lock`, other rails, `packages/core`, `apps/**` or anything else. Every dependency you need is installed.

## Read first

- `packages/rail/src/rail.ts`: `Rail`, `RailDeclaration` and `ChallengeContext`.
- `packages/rail/src/escrow/index.ts`: an example rail, for style.
- `packages/core/src/types.ts`: `Offer`, `PaymentRequirements`, `PaymentPayload`, `VerifyResult` and `SettleResult`.

## What to build

1. `packages/rail/src/gateway/index.ts`:
   - The config is `{ facilitatorUrl?: string /* default https://gateway-api-testnet.circle.com */; network?: "eip155:5042002"; facilitator?: FacilitatorLike /* injected in tests */ }`.
   - `FacilitatorLike = { getSupported(): Promise<{kinds: Array<{scheme: string; network: string; extra?: Record<string, unknown>}>}>; verify(payload, requirements): Promise<{isValid: boolean; invalidReason?: string; payer?: string}>; settle(payload, requirements): Promise<{success: boolean; errorReason?: string; payer?: string; transaction: string; network: string}> }`. By default it is a `BatchFacilitatorClient`.
   - `export async function gatewayRail(cfg): Promise<Rail>` fetches `getSupported()` once. It finds the kind with `scheme === "exact"`, the configured network and `extra.name === "GatewayWalletBatched"`, and throws a clear error if there is none. It keeps that kind's `extra` (name, version, verifyingContract, minValiditySeconds) and the USDC asset address from `extra.assets`.
   - `declaration`:
     - `id: "gateway"`, `network`, `scheme: "exact"`, `kind: "batched"`, `gasPaidBy: "gateway"`;
     - `asset: {network, address: <USDC>, symbol: "USDC", decimals: 6}`;
     - `finality: "The buyer's Gateway balance is debited at once; Circle Gateway credits the seller in its next batch."`;
     - `explorerTx: "https://testnet.arcscan.app/tx/{tx}"`.
   - `challenge(offer)` returns `{scheme: "exact", network, amount: offer.price, asset: <USDC>, payTo: offer.payTo?.gateway ?? offer.seller, maxTimeoutSeconds: Math.max(offer.deadline, 60), extra: {name, version, verifyingContract}}`. Pass through exactly the `extra` fields the supported kind gave you, minus `assets` and `minValiditySeconds`.
   - `verify(payment, req)`:
     - before any network call, refuse locally when `payment.accepted` differs from `req` in scheme, network, amount, asset or payTo: `{isValid: false, invalidReason: "Refused. The payment does not match this offer."}`;
     - then return `facilitator.verify(payment, req)` mapped onto `VerifyResult`, with an invalid reason prefixed "Refused. ".
   - `settle(payment, req)` returns `facilitator.settle(...)` mapped onto `SettleResult`. If the facilitator throws, return `{success: false, errorReason: <one-line message>, transaction: "", network}` and never throw.
   - No `escrow` property: this rail has no escrow.
2. `packages/rail/src/gateway/payer.ts` exports `async function gatewayPayment(signer, requirements: PaymentRequirements): Promise<PaymentPayload>`. It uses `BatchEvmScheme` to build `{x402Version: 2, accepted: requirements, payload}`. `signer` is a viem `LocalAccount`, or whatever `BatchEvmSigner` requires; adapt it in this file. Also `export function isGatewayRequirement(req)`, true when `scheme === "exact"` and `extra.name === "GatewayWalletBatched"`.
3. Export both files from `packages/rail/src/gateway/index.ts`. Do not edit `packages/rail/src/index.ts`; the integrator adds the export.
4. `scripts/gateway/deposit.ts`: `bun scripts/gateway/deposit.ts <usdc>` deposits into Gateway from the key in env `CS_BUYER_KEY`, on `arcTestnet`, and prints the deposit tx hash and the new balances. `scripts/gateway/balance.ts [address]` prints the Gateway balances. Never print the key.

## Tests (`packages/rail/test/gateway.test.ts`), with no network

- Inject a fake facilitator whose `getSupported` returns the Arc testnet kind above, and whose `verify` and `settle` record their calls.
- `challenge` carries `GatewayWalletBatched`, the verifying contract, USDC, the price and the seller.
- A real `gatewayPayment` signed with a fixed test key (anvil key `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d`) produces a payload whose `accepted` equals the requirement and whose `payload` is non-empty.
- `verify` refuses a mismatched amount without calling the facilitator, and passes a matching one through.
- `settle` maps success, and maps a thrown error to `success: false` without throwing.
- `gatewayRail` throws when the supported list has no Arc testnet batched kind.

## Constraints

- **Never launch a browser of any kind on this machine**: no Chrome or Chromium, headless or not, no Playwright, Puppeteer or screenshot tools. UI checks go back to the lane, which raises NEEDS-BROWSER.
- Never call a faucet. Never make a live Gateway call in tests. Never use a private key except the fixed test key above.
- TypeScript strict, no `any`. Keep files under about 200 lines.

## Acceptance

From the worktree root:

```
bun install && bun run typecheck && bun test packages/rail && bun test && forge test
```

Every command passes, with no skipped tests.

## Stop conditions

- You need to edit outside the lease: stop and write the report.
- One problem has blocked you for more than 20 minutes: stop, commit what passes, and write the report.

## Finish

Commit on your branch with small present-tense messages and no trailers. Write `.packets/reports/cs-05-gateway.md`. Do not push, merge or deploy.
