# hd-15-wallet-paid: the hedera rail accepts a payment the buyer's own wallet already executed, checked on the mirror before the seller runs

## Goal

Build W1 and W2 of `/Users/thescoho/Developer/countersign-mumbai/hd/DESIGN-hedera-wallet.md` exactly. Read it first.

This is the hub half of user-held Hedera wallets (STEER-2113). A person's wallet (HashPack or Kabila over WalletConnect) signs **and executes** a USDC transfer to the offer's payee, with memo `cs1:<offerHash>`. The hub checks it on the mirror node before the seller runs, and accepts one transaction for one job only.

W2 adds the shared, browser-safe builder that the web connector (hd-16) and the headless test wallet run (hd-17) both use. Tracked by issue #41.

## Lease

- `packages/rail/src/hedera/wallet-paid.ts` (new).
- `packages/rail/src/hedera/rail.ts`: the wallet branch in `verify` and `settle`, and two options. The exact path is unchanged.
- `packages/rail/src/hedera/index.ts`: one `export *` line.
- `packages/rail/src/hedera/test/wallet-paid.test.ts` (new).
- Report: `/Users/thescoho/Developer/countersign-mumbai/reports/hd-15-wallet-paid.md`

## The decided design

### 1. `wallet-paid.ts`

It exports:

- `WALLET_TX_ID = /^0\.0\.\d+@\d+\.\d+$/` and `ACCOUNT = /^0\.0\.\d+$/`.
- `interface WalletPayload { walletTransactionId: string; payer: string }`.
- `walletPayloadOf(payload: unknown): WalletPayload | null`. It returns the payload when `payload.walletTransactionId` is a string; `payer` may still be malformed, because `verify` checks the shape. Otherwise it returns null.
- `checkWalletPayment(record: MirrorTransaction, req: PaymentRequirements, payer: string, nowSeconds: number): { ok: true } | { ok: false; reason: string }`. It applies these in order:
  1. `record.result === "SUCCESS"` and `record.name === "CRYPTOTRANSFER"`, otherwise `payment_failed`.
  2. `offerHashFromMemo(record.memo)?.toLowerCase() === String(req.extra?.offerHash).toLowerCase()`, otherwise `memo_mismatch`.
  3. On `record.tokens[req.asset] ?? []`, summed per account: `payTo` nets exactly `+BigInt(req.amount)`, `payer` nets exactly `-BigInt(req.amount)`, and every other account nets 0. Otherwise `amount_mismatch`.
  4. `Number(record.consensusTimestamp.split(".")[0]) >= nowSeconds - (req.maxTimeoutSeconds + 300)`, otherwise `stale_payment`.
- `findHederaExact(accepts: PaymentRequirements[]): PaymentRequirements | null`: the first entry with `network === "hedera:testnet"` and `scheme === "exact"`.
- `buildWalletTransfer(req, payer, opts: { nodeAccountIds?: string[] } = {}): TransferTransaction`:
  - `addTokenTransfer(TokenId.fromString(req.asset), AccountId.fromString(payer), -amount)`, then the same to `req.payTo` with `+amount`;
  - `setTransactionMemo(offerMemo(String(req.extra?.offerHash)))`;
  - `setTransactionId(TransactionId.generate(AccountId.fromString(payer)))`;
  - `setTransactionValidDuration(120)`;
  - freeze it with `opts.nodeAccountIds` (`setNodeAccountIds` then `freeze()`, as `packages/buyer/src/hedera/signer.ts` does), or else with `freezeWith(Client.forTestnet())`, closing that client after.
- `walletTransactionList(tx): string`, the base64 of `tx.toBytes()`.
- `signAndExecuteParams(payer, tx)`: `{ signerAccountId: \`hedera:testnet:${payer}\`, transactionList: walletTransactionList(tx) }`.
- `walletPaymentPayload(req, transactionId, payer): PaymentPayload`: `{ x402Version: 2, accepted: req, payload: { walletTransactionId: transactionId, payer } }`.

### 2. `rail.ts`

**Options.** `HederaRailOptions` gains:

| Option | Default | Meaning |
|---|---|---|
| `walletWaitMs?: number` | `20_000` | How long `verify` polls the mirror for a wallet payment. |
| `walletPollMs?: number` | `1_500` | The interval between those polls. |

**`verify`.** At its very start: `const w = walletPayloadOf(payment.payload); if (w) return verifyWallet(w, requirements);`. `verifyWallet` runs these steps in order:

1. **Shape** (`malformed`). The id matches `WALLET_TX_ID`, `payer` matches `ACCOUNT`, and the id's part before `@` equals `payer`.
2. **Replay** (`replay`). `await seen.has(id)` must be false.
3. **On the mirror** (`payment_not_found`). Poll `getTransaction(id, opts.mirror)` every `walletPollMs` until a record appears or `walletWaitMs` has passed. Count a thrown read as not yet seen.
4. **The payment.** Run `checkWalletPayment(record, requirements, payer, now())`. A refusal gives `{ isValid: false, invalidReason: reason, payer }`.

On success, return `{ isValid: true, payer }`.

**`settle`.** At its very start: `const w = walletPayloadOf(payment.payload); if (w)`, run the shape check from step 1 (`malformed`). Then:
- if `!(await seen.claim(id))`, return `replay`;
- otherwise return `{ success: true, payer, transaction: id, network: HEDERA_TESTNET }`.

Never call a facilitator on this branch.

Every other payload follows the existing exact path, unchanged.

## Tests (`wallet-paid.test.ts`; offline, with a fake mirror `fetch` and a recording fake facilitator, as `rail.test.ts` builds them)

- **`checkWalletPayment`.** Each reason is hit, and a good record passes.
- **`buildWalletTransfer`** with `nodeAccountIds: ["0.0.3"]`. `TransferTransaction.fromBytes` of `walletTransactionList(tx)` shows:
  - the two token transfers;
  - the memo `cs1:` plus the hash;
  - a transaction id account equal to the payer;
  - a valid duration of 120.

  `signAndExecuteParams` has the `hedera:testnet:` prefix.
- **`findHederaExact`** picks the exact hedera entry out of a mixed list.
- **Rail, happy path.** A wallet payment gives `verify` `{ isValid: true, payer }`, then `settle` `{ success: true, transaction: <id> }`, with **zero** facilitator calls.
- **Rail, refusals.** Each is refused with its reason:
  - three malformed shapes;
  - `replay` after a settle;
  - `payment_not_found` with `walletWaitMs: 0`;
  - a FAILED record;
  - another memo;
  - 29999;
  - another payee;
  - a third party moving USDC;
  - a stale consensus time.
- **The exact path is unchanged.** Every existing test passes unedited.

## Constraints

- **No browser.** **No network** in tests. **No keys.**
- **Never run a script under `scripts/hedera/`.**
- **Scope.** Change nothing outside the lease. Never stage `bun.lock`. No new dependencies. TypeScript strict, no `any`.

## Acceptance

```
set -o pipefail; bun install && bun run typecheck && bun test packages/rail/src/hedera && bun test && forge test
```

Every command passes, with no new skips. Commit on `cs/hd-15` with short present-tense messages ending `refs #41`, and no trailers. Write the report. Do not push, merge or deploy.
