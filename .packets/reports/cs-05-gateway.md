# cs-05-gateway report

## What was built

`packages/rail/src/gateway` adds the `gateway` rail for Circle Gateway nanopayments on Arc testnet.

- `index.ts`: `gatewayRail(cfg)` fetches the facilitator's supported kinds once and finds the Arc testnet `exact` / `GatewayWalletBatched` kind. It keeps the kind's signing domain (`name`, `version`, `verifyingContract`), `minValiditySeconds`, and the USDC address from `extra.assets`. The declaration is `id: "gateway"`, `kind: "batched"`, `gasPaidBy: "gateway"` with the required finality sentence and `https://testnet.arcscan.app/tx/{tx}`.
- `challenge` returns the price, USDC asset, `offer.payTo.gateway ?? offer.seller`, a 60-second timeout floor, and only the signing-domain fields from the supported kind (`assets` and `minValiditySeconds` are stripped).
- `verify` refuses a mismatched `payment.accepted` locally before touching the facilitator: scheme, network, amount, asset and payTo must match, with addresses compared case-insensitively. Facilitator refusals are prefixed `Refused. `.
- `settle` maps the facilitator result onto `SettleResult` and turns a thrown facilitator error into `success: false` with a one-line reason, an empty transaction and the rail's network. It never throws.
- No `escrow` property is attached.
- `payer.ts`: `gatewayPayment(signer, requirements)` adapts a viem `LocalAccount` to `BatchEvmSigner` and uses `BatchEvmScheme.createPaymentPayload(2, requirements)` to return `{x402Version: 2, accepted: requirements, payload}`. `isGatewayRequirement` checks `scheme === "exact"` and `extra.name === "GatewayWalletBatched"`.
- `client.ts`: a tiny internal re-export of `GatewayClient` so the root `scripts/gateway` files can resolve the rail package's dependency. The scripts cannot resolve `@circle-fin/x402-batching` from the repo root, and the packet forbids editing `package.json`.

Ops scripts:

- `scripts/gateway/deposit.ts <usdc>` deposits from `CS_BUYER_KEY` on `arcTestnet` and prints approval/deposit hashes plus wallet and Gateway balances. The key is never printed.
- `scripts/gateway/balance.ts [address]` prints wallet and Gateway balances for that address (default: the buyer key's address).

## Tests

`packages/rail/test/gateway.test.ts` (8 tests, no network) uses an injected fake facilitator whose `getSupported` reports the live Arc testnet kind and whose `verify`/`settle` record calls. It covers:

- declaration, challenge shape, verifying contract, USDC, price, seller, timeout floor and `payTo` override;
- a real `gatewayPayment` signed with the fixed anvil key, with `accepted` equal to the requirement and a non-empty authorization/signature payload;
- local refusal of a moved amount with zero facilitator calls, then a matching payment passed through;
- a facilitator refusal prefixed `Refused. `;
- settle success mapping and a thrown settle mapped to `success: false` without throwing;
- `gatewayRail` throwing when no Arc batched kind is advertised.

## Acceptance output

```
$ bun install
bun install v1.3.14 (0d9b296a)
Checked 70 installs across 92 packages (no changes) [6.00ms]

$ bun run typecheck
$ tsc -p tsconfig.json
(no output; exit 0)

$ bun test packages/rail
 14 pass
 0 fail
 46 expect() calls
Ran 14 tests across 3 files. [843.00ms]

$ bun test
 94 pass
 0 fail
 317 expect() calls
Ran 94 tests across 17 files. [1155.00ms]

$ forge test
Ran 3 test suites in 143.12ms (110.31ms CPU time): 29 tests passed, 0 failed, 0 skipped (29 total tests)
```

## Not done

Nothing in the packet was left undone. No browser, faucet or live Gateway call was used. No push, merge or deploy.
