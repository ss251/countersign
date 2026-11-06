# wc-01 — relay: Whitechain gas relayer and x402 facilitator

## Goal

Build `packages/relay`, the service that lets a buyer pay USDT on Whitechain Sepolia (chain 1874) without ever holding WBT. A buyer, human or agent, signs one EIP-3009 `TransferWithAuthorization`. The relay checks it and submits it, paying the gas from its own WBT. It speaks the x402 v2 facilitator API (`/supported`, `/verify`, `/settle`) for scheme `exact`, network `eip155:1874`, using the `eip3009` transfer method. It also does three more things:

- carries the merchant's signed refund back to the payer, gaslessly;
- keeps a ledger of payments and refunds, with a CSV export for the accountant;
- refuses anything that could drain its WBT.

Everything here is tested offline with fakes. Nothing in this packet touches a live chain.

## Lease

You may create or change only these paths:

- `packages/relay/**` (package.json, src/, test/, a nested `.gitignore`)

Do not touch `bun.lock`, the root `package.json`, or any other package. Run `bun install` after editing `packages/relay/package.json`, but **never commit `bun.lock`**. Before each commit, run `git checkout -- bun.lock` if it shows as modified.

## Context

Read these first:

- `packages/core/src/amount.ts`: `parseAtomic`, `atomicToWire`, `formatUnits`. Amounts are bigint in code and digit strings on the wire. Never use floats for money.
- `tsconfig.json`: strict mode, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`. Use `import type` for types and `.ts` extensions in relative imports.
- `docs/whitechain.md`: chain facts.

Facts, verified on chain 2026-11-06:

- Chain `1874`. RPC `https://rpc.testnet.whitechain.io`. Explorer `https://explorer.testnet.whitechain.io` (tx URL `/tx/<hash>`, address URL `/address/<addr>`). Native token WBT, 18 decimals.
- USDT `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7`, 6 decimals, `TetherTokenV2`. Its EIP-712 domain is `{ name: "Tether USD", version: "1", chainId: 1874, verifyingContract: <USDT> }`. viem's `domainSeparator({ domain })` for that domain must equal `0xcdcfacb6b15c8238b4e5fbb47bdb83b7f83f50a531d264bf9763d2bd1d3d2a25`. Write a test for this.
- EIP-3009 typed data: `TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)`.
- Token functions to put in a minimal ABI:
  - `transferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,uint8 v,bytes32 r,bytes32 s)`
  - `authorizationState(address authorizer,bytes32 nonce) view returns (bool)`
  - `balanceOf(address) view returns (uint256)`
  - events `Transfer(address indexed from,address indexed to,uint256 value)` and `AuthorizationUsed(address indexed authorizer,bytes32 indexed nonce)`

  Split the 65-byte signature with viem's `parseSignature`. Use `yParity + 27` for `v` when `v` is absent.
- x402 v2 shapes:
  - `PaymentRequirements = { scheme, network, amount, asset, payTo, maxTimeoutSeconds, extra? }`
  - `PaymentPayload = { x402Version: 2, resource?, accepted: PaymentRequirements, payload: { signature, authorization: { from, to, value, validAfter, validBefore, nonce } }, extensions? }`. Every authorization number is a digit string.
  - The `/verify` and `/settle` request body is `{ x402Version: 2, paymentPayload, paymentRequirements }`.
  - `VerifyResponse = { isValid, invalidReason?, payer? }`
  - `SettleResponse = { success, errorReason?, payer?, transaction, network, amount? }`. `transaction` is `""` when nothing was broadcast.
  - `GET /supported` returns `{ kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:1874" }], extensions: [], signers: { "eip155:*": [<relayer address>] } }`.

## What to build

Use `viem` `^2.57.16` and `hono` `^4.13.16` as dependencies in `packages/relay/package.json`; both versions are already in the lockfile. Use `bun:sqlite` for storage. Add `"start": "bun run src/server.ts"` and `"merchant": "bun run src/merchant-server.ts"` scripts.

1. **`src/chain.ts`** — `WHITECHAIN_CHAIN_ID = 1874`, `NETWORK = "eip155:1874"`, `whitechainSepolia` (viem `defineChain`), `USDT = { address, name, version, decimals }`, `txUrl(hash)`, `addressUrl(addr)`.

2. **`src/eip3009.ts`**
   - `Authorization`, with bigint numbers and checksummed addresses, and `WireAuthorization`, with digit strings.
   - `authorizationFromWire()`: strict. Addresses go through `getAddress`, numbers through `parseAtomic`, and the nonce must match `/^0x[0-9a-fA-F]{64}$/`. On any bad field it throws `PayloadError`.
   - `authorizationToWire()`.
   - `usdtDomain()`.
   - `signAuthorization(account, auth)`, using `account.signTypedData`.
   - `recoverAuthorizer(auth, signature)`, using `recoverTypedDataAddress`.
   - `tokenAbi`.

3. **`src/ports.ts`** — Narrow interfaces for the chain, so tests can pass fakes. A real viem public client and wallet client must satisfy them structurally.
   - `ChainReader`: `readContract`, `simulateContract`, `estimateContractGas`, `estimateFeesPerGas`, `getBalance`, `waitForTransactionReceipt`.
   - `ChainWriter`: `writeContract`.

4. **`src/ceiling.ts`** — `SpendCeiling(cfg, now = Date.now)`, a rolling window, `cfg = { windowMs, capWei, maxTx, maxTxPerPayer }`.
   - `reserve({ payer, worstCaseWei })` returns `{ ok: true, ticket }` or `{ ok: false, reason: "ceiling_wei" | "ceiling_tx" | "ceiling_payer" }`.
   - `settle(ticket, actualWei)` swaps the reservation for the actual cost. `cancel(ticket)` drops it.
   - `snapshot()` returns `{ windowMs, capWei, usedWei, remainingWei, txCount, maxTx, resetsAt }`.
   - Reserved-but-unsettled entries count. Entries older than the window fall out.

5. **`src/relayer.ts`** — `Relayer(reader, writer, account, policy, ceiling)`, with `policy = { maxFeePerGasWei, minBalanceWei, gasHeadroomPct, receiptTimeoutMs, allowedTokens }`.
   - `RelayCall` is a discriminated union. Today it has one member, `{ kind: "transferWithAuthorization", token, auth, signature }`. It must be easy to add escrow calls later, so switch on `kind` exhaustively.
   - `simulate(call)` returns `{ ok: true, gas }` or `{ ok: false, detail }`. It runs `simulateContract` and then `estimateContractGas`, both with `account` set to the relayer.
   - `submit(call, payer)` returns a `RelayOutcome`:
     - `{ status: "refused", reason, detail? }`: nothing was broadcast and no WBT was spent;
     - `{ status: "confirmed" | "reverted", txHash, blockNumber, gasUsed, costWei }`;
     - `{ status: "pending", txHash }`.
   - `submit` runs these steps in order, and stops at the first refusal:
     1. the token is in `allowedTokens`, else `not_allowed`;
     2. `simulate`, else `simulation_failed`;
     3. fees: `maxFeePerGas > policy.maxFeePerGasWei` gives `fee_too_high`;
     4. `worstCase = gas * (100 + headroom) / 100 * maxFeePerGas`, then `ceiling.reserve`;
     5. `balance - worstCase < minBalanceWei` gives `balance_floor`, and cancels the reservation;
     6. `writeContract` with explicit `gas`, `maxFeePerGas` and `maxPriorityFeePerGas`;
     7. `waitForTransactionReceipt` with `receiptTimeoutMs`. On a timeout, return `pending` and leave the reservation in place. Otherwise call `ceiling.settle` with `gasUsed * effectiveGasPrice`.
   - Submissions run strictly one at a time, through an internal promise-chain mutex, so nonces never race.
   - `status()` returns `{ address, balanceWei, ceiling: snapshot, policy }`.

6. **`src/ledger.ts`** — `Ledger(path)`, on `bun:sqlite`. Use `":memory:"` in tests.
   - Tables `payments` and `refunds`. Store amounts as TEXT digit strings.
   - A payment row has `id` (= settle tx hash), `network`, `payer`, `payTo`, `amount`, `nonce`, `txHash`, `blockNumber`, `settledAt` (ms), `resource` (nullable URL), `status` (`settled | pending`) and `refunded`, which is the sum of its refunds.
   - Methods: `recordPayment`, `recordPending`, `promotePending`, `findByAuthorization(from, nonce)`, `getPayment(id)`, `listPayments({ payTo?, payer? })` (newest first), `recordRefund({ paymentId, amount, txHash, blockNumber, nonce })`, `refundable(paymentId)`, `listRefunds(paymentId)`.
   - `toCsv(payTo)` writes this header: `date_utc,payment_id,payer,merchant,amount_usdt,refunded_usdt,net_usdt,status,settle_tx_url,refund_tx_urls`.
     - Format amounts with `formatUnits(x, 6)`.
     - `status` is `paid`, `partially_refunded` or `refunded`.
     - Join refund URLs with a space.
     - Quote fields per RFC 4180.

7. **`src/exact.ts`** — `verifyExact(body, ctx)` and `settleExact(body, ctx)`, with `ctx = { reader, relayer, ledger, now }`.

   `verifyExact` checks these in order, and the first failure wins:
   1. `x402Version === 2`, else `invalid_payload`;
   2. `scheme === "exact"`, else `invalid_scheme`;
   3. `network === "eip155:1874"`, else `invalid_network`;
   4. the asset is USDT (case-insensitive), else `invalid_payload`;
   5. `extra.assetTransferMethod` is absent or `"eip3009"`, and `extra.name`/`extra.version`, when present, equal `"Tether USD"`/`"1"`, else `invalid_payload`;
   6. `accepted` matches the requirements on scheme, network, amount, asset and payTo, else `invalid_payload`;
   7. the authorization parses, else `invalid_payload`;
   8. `to === payTo`, else `invalid_exact_evm_payload_recipient_mismatch`;
   9. `value === amount`, else `invalid_exact_evm_payload_authorization_value_mismatch`;
   10. `validAfter <= now`, else `invalid_exact_evm_payload_authorization_valid_after`;
   11. `validBefore > now + 6`, else `invalid_exact_evm_payload_authorization_valid_before`;
   12. the signature recovers to `from`, else `invalid_exact_evm_payload_signature`;
   13. `balanceOf(from) >= value`, else `insufficient_funds`;
   14. `authorizationState(from, nonce) === false`, else `invalid_transaction_state`;
   15. `relayer.simulate` succeeds, else `invalid_transaction_state`.

   On success it returns `{ isValid: true, payer: from }`.

   `settleExact` works like this:
   - **Idempotent.** If the ledger already holds `(from, nonce)` as settled, return that settlement again as success. A `(from, nonce)` already in flight returns `invalid_transaction_state`.
   - Otherwise it calls `verifyExact`, then `relayer.submit`, and maps the outcome:

     | Outcome | Ledger | Response |
     |---|---|---|
     | `confirmed` | `recordPayment` | `success: true`, with `amount` |
     | `reverted` | — | `invalid_transaction_state`, with the tx hash |
     | `pending` | `recordPending` | `settlement_pending`, with the tx hash |
     | refused `simulation_failed` | — | `invalid_transaction_state` |
     | refused `ceiling_*` | — | `relay_ceiling_reached` |
     | refused `balance_floor` | — | `relay_balance_low` |
     | refused `fee_too_high` | — | `relay_fee_too_high` |
     | refused `not_allowed` | — | `invalid_payload` |

8. **`src/refund.ts`** — `refundPayment({ paymentId, authorization, signature }, ctx)`.

   A refund is a USDT transfer from the merchant back to the payer, signed by the merchant and relayed gaslessly. Checks, in order:
   1. the payment exists and is settled;
   2. `from === payment.payTo`;
   3. `to === payment.payer`;
   4. `0 < value <= refundable(paymentId)`;
   5. the validity window holds, as in verify;
   6. the signature recovers to `from`;
   7. the nonce is unused on chain;
   8. the call simulates.

   The refundable check and the submit happen inside the relayer's queue, so two concurrent refunds can't both pass. Return `{ ok: true, txHash, txUrl, refunded, remaining }` or `{ ok: false, reason }`. A refund that points at no payment is refused. That is what stops the relay from being a free gas pump.

9. **`src/merchant.ts`** — `signRefund({ merchant: LocalAccount, payment: { payer, payTo, amount, refunded }, amount?, now, validForSeconds = 300 })`. It builds and signs the refund authorization: `from = merchant`, `to = payer`, value defaulting to whatever is still refundable, `validAfter = 0`, `validBefore = now + validForSeconds`, and a random 32-byte nonce. It throws if `merchant.address !== payment.payTo`.

10. **`src/server.ts`** — `createRelayApp({ reader, relayer, ledger, now, config })` returns a Hono app. When run directly (`import.meta.main`), it wires real viem clients from env and serves `Bun.serve` on `RELAY_PORT`, default `8402`.
    - Routes:
      - `GET /healthz`
      - `GET /status`, with balances as wei strings plus formatted WBT
      - `GET /supported`
      - `POST /verify`
      - `POST /settle`
      - `POST /refund`
      - `GET /payments?payTo=&payer=`
      - `GET /payments/:id`, which includes refunds and explorer URLs
      - `GET /payments.csv?payTo=`, served as `text/csv` with a `Content-Disposition` attachment
    - CORS allows `*`.
    - Malformed JSON returns 400 with `invalid_payload`. It never throws a 500 for bad input.
    - bigints are serialised as digit strings.

11. **`src/merchant-server.ts`** — the merchant's own backend. It is a separate process with a separate key.
    - `POST /refund/:paymentId { amount? }`: fetch `GET {RELAY_URL}/payments/:id`, sign with `signRefund`, then POST `{RELAY_URL}/refund`.
    - `GET /payments` and `GET /payments.csv` proxy the relay, filtered to `payTo = merchant`.
    - `GET /me` returns `{ address }`.
    - Port `MERCHANT_PORT`, default `8403`.

12. **`src/config.ts`** — `loadRelayConfig(env)` and `loadMerchantConfig(env)`.
    - `WC_RELAYER_PRIVATE_KEY` and `WC_MERCHANT_PRIVATE_KEY` are required for their servers and must match `/^0x[0-9a-fA-F]{64}$/`. An error message names the variable, never its value.
    - `WHITECHAIN_RPC_URL` defaults to the public RPC.
    - `RELAY_DB` defaults to `packages/relay/.data/relay.sqlite`; create the directory.
    - Ceiling and policy defaults:
      - `RELAY_CAP_WEI_PER_HOUR` 50000000000000000 (0.05 WBT)
      - `RELAY_MAX_TX_PER_HOUR` 200
      - `RELAY_MAX_TX_PER_PAYER_PER_HOUR` 30
      - `RELAY_MAX_FEE_GWEI` 50
      - `RELAY_MIN_BALANCE_WEI` 20000000000000000 (0.02 WBT)
      - `RELAY_URL` `http://localhost:8402`
    - Never log, print or return a private key.

13. **`src/index.ts`** — re-export the public API.

14. **`packages/relay/.gitignore`** — `.data/`

## Tests (`packages/relay/test/`, all offline)

Use `generatePrivateKey()`/`privateKeyToAccount()` for throwaway keys, and an in-memory fake chain implementing `ChainReader`/`ChainWriter`. The fake keeps balances, used nonces, a fee, a WBT balance, and switches to make simulation fail or a receipt time out.

- **domain:** the `domainSeparator` equals the on-chain value above.
- **eip3009:**
  - a sign/recover round trip works;
  - `authorizationFromWire` rejects a non-digit value, a short nonce and a bad address.
- **ceiling:**
  - a reservation past `capWei` is refused;
  - it is accepted again once the window rolls, using an injected clock;
  - per-payer and max-tx limits are enforced;
  - `cancel` frees capacity.
- **relayer:**
  - each refusal reason fires and calls `writeContract` zero times: `not_allowed`, `simulation_failed`, `fee_too_high`, `ceiling_wei`, `balance_floor`;
  - the confirmed path records the actual cost;
  - a receipt timeout gives `pending`;
  - two concurrent submits run sequentially.
- **exact:**
  - one test per verify reason code above, plus the valid case;
  - settle success;
  - settle idempotency returns the same transaction;
  - settle maps `ceiling_wei` to `relay_ceiling_reached`.
- **refund:**
  - a refund to a stranger is refused;
  - an over-refund is refused;
  - a refund from someone other than the merchant is refused;
  - a refund with an unknown payment id is refused;
  - a partial refund followed by the remainder succeeds, then a third is refused;
  - two concurrent refunds of the full amount give exactly one success.
- **ledger:**
  - the CSV has the header, the quoting is correct, and the statuses are `paid`/`partially_refunded`/`refunded`.
- **server:**
  - `app.request` checks the shape of `/supported`, `/status` and `/verify` (happy path);
  - malformed JSON on `/settle` gives 400 `invalid_payload`;
  - the CSV content type is correct.

## Constraints

- No network access in tests. No real keys anywhere, and no `.env` files committed.
- No floats for money. Every bigint crosses JSON as a digit string.
- Small present-tense commit messages, no emoji, no `Co-authored-by`. Commit as you go, at least every hour.
- Keep the code plain and readable. No framework beyond Hono and viem.

## Acceptance

Run from the worktree root:

```
bun install && bun run typecheck && bun test packages/relay && bun test
```

All green. `git diff --stat cs/wc...HEAD` lists only `packages/relay/**` and `.packets/` files. `git status` is clean apart from `bun.lock`.

## Stop conditions

Stop, commit what works, and write the report if any of these happen:

- a fix needs a file outside the lease;
- a test can only pass with network access;
- the same failure survives three different fixes;
- 100 minutes have passed.

## Report

Write `$M/reports/wc-01-relay.md`. If that path is not writable, put the report in your final message instead. It covers:

- what was built;
- the test count;
- anything skipped;
- every deviation from this packet, with the reason.
