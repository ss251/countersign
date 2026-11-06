# hd-06f-mpp-replay: every MPP challenge is unique, replay is keyed on the transfer, and no buyer is asked to pay twice

## Goal

This is the single corrective for PR #84, the mpp rail, after review of d2c824c (`/Users/thescoho/Developer/countersign-mumbai/reports/review-d2c824c.md`). It fixes blocker B17 and should-fixes 1 and 2, exactly as decided below. Tracked by issue #5.

- **B17.** `challenge()` adds no nonce, so two 402s for one offer in one second are the same HMAC'd challenge, and replay is keyed on that id. Two buyers collide (the second has paid and is refused), and anyone holding that second's 402 can redeem another buyer's push-mode transfer.
- **Should-fix 1.** `settle` claims before mppx confirms and never releases, and the demo server answers a failed settle with a fresh 402, which makes mppx's client pay again.
- **Should-fix 2.** The reported payer is the credential's own unverified `source`.

The failing test is `packages/rail/src/mpp/test/w1-mpp.test.ts`, already on this branch. It must pass unedited.

## Lease

- `packages/rail/src/mpp/rail.ts`, `packages/rail/src/mpp/types.ts`, `packages/rail/src/mpp/index.ts` (exports only), `packages/rail/src/mpp/test/rail.test.ts`, and a new test file `packages/rail/src/mpp/test/replay.test.ts`
- `scripts/mpp/server.ts`: the `/rail/paid` responses only
- Report: `/Users/thescoho/Developer/countersign-mumbai/reports/hd-06f-mpp-replay.md`

Never edit `w1-mpp.test.ts` or any other `w1-*` test.

## The decided design

1. **A nonce per issuance.**
   - `challenge()` passes `meta: { nonce: <randomBytes(16) as 32 lowercase hex characters> }` to `Challenge.fromMethod`, for the Tempo challenge and the Stripe challenge alike.
   - In mppx 0.17.1 the challenge id is an HMAC over `realm|method|intent|request|expires|digest|opaque`, and `opaque` is the serialized `meta`, so the nonce is bound. Nothing else about the challenge changes.
2. **Replay keys.** The `seen` store holds two kinds of key per payment:
   - **`challenge:<challenge.id>`**;
   - **the transfer key:**
     - Tempo push credentials (`payload.type === "hash"`): `tempo-hash:<payload.hash lowercased>`;
     - Tempo pull credentials (`payload.type === "transaction"`): `tempo-tx:<keccak256(payload.signature)>`, with viem's `keccak256` on the hex string;
     - Tempo `proof` credentials: refused as `malformed`, since every offer costs at least 0.01;
     - Stripe: `stripe-spt:<payload.spt>`.
   - **`verify`** refuses `replay` when either key is already claimed (`seen.has`).
   - **`settle`:**
     1. `claim(challengeKey)`; if false, refuse `replay`;
     2. `claim(transferKey)`; if false, `release(challengeKey)` and refuse `replay`;
     3. call `broadcastCredential`;
     4. if it throws, `release` both keys and return `payment_failed`.
3. **`SettledStore`** (in `types.ts`, or wherever it is declared) gains `release(id: string): void | Promise<void>`. The in-memory default implements it.
4. **The payer comes from the chain.**
   - `verify` returns **no** `payer` for Tempo. Delete every use of the credential's `source` as a payer, and the helper that parsed it.
   - `MppRailOptions.payerOf?: (txHash: Hex, expect: { recipient: string; amount: bigint }) => Promise<string | undefined>`.
   - The default reads `getTransactionReceipt({ hash })` from a viem public client on `tempoModerato` (`viem/chains`) over `http()`, then calls `payerFromReceipt`. Any thrown error yields `undefined`.
   - Export a pure `payerFromReceipt(receipt: { logs: readonly Log[] }, expect: { currency: string; recipient: string; amount: bigint }): string | undefined`:
     1. decode with `parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs })`;
     2. pick the first log whose `address` equals `currency`, whose `args.to` equals `recipient` (both compared case-insensitively) and whose `args.value` equals `amount`;
     3. return `getAddress(args.from)`, or `undefined` when no log matches.
   - On a successful Tempo settle, `payer = await payerOf(receipt.reference, { recipient: challenge recipient, amount: atomic amount })`. Include `payer` only when it is defined.
5. **The demo server never sends a 402 after a credential.** In `scripts/mpp/server.ts` `/rail/paid`, a request carrying `Authorization: Payment …` gets:

   | Outcome | Response |
   |---|---|
   | `verify` refused as `replay` | 409 `{ error: "refused", reason }` |
   | any other `verify` refusal | 400 `{ error: "refused", reason }` |
   | `settle` returns `replay` | 409 |
   | `settle` returns `payment_failed` | 502 `{ error: "payment outcome unknown; retry with the same credential", reason }` |
   | any other `settle` failure | 400 |
   | success | 200, as today |

   Only a request with **no** credential gets the 402 challenge. `/paid` and `/paid-card` are unchanged.

## Tests (offline; inject `tempoMppx` and `payerOf`; no network, no RPC)

- `w1-mpp.test.ts` passes unedited.
- **Nonce.** Two challenges for one offer issued with the same `now` have different ids and different `meta.nonce` values. A credential whose challenge `meta.nonce` was changed is refused as `challenge_not_ours`.
- **Transfer replay.** Two different challenges, each with a push credential carrying the **same** tx hash. The first settles through a fake `tempoMppx`; the second's `verify` and `settle` return `replay`.
- **Claim release.**
  1. The fake `broadcastCredential` throws on its first call, so settle returns `payment_failed`.
  2. The same credential settles successfully on the second call, and the fake was called twice.
- **Payer.**
  - Settle with `payerOf` returning `0x…ab` reports that payer, and `verify` reports none.
  - `payerOf` returning `undefined` gives no `payer` key.
  - `payerFromReceipt`, on a synthetic receipt with three logs:
    - a Transfer of another token;
    - a Transfer to another recipient;
    - the matching Transfer;

    returns the checksummed `from` of the matching log. A receipt with none of them returns `undefined`.
- **Proof.** A `proof` credential for a priced offer is refused as `malformed`.
- Every existing mpp test, and the mainnet guard test, passes. Update the existing assertions that expected a `payer` from `verify` or from `source`; that behaviour is removed on purpose. Say which tests in the report.

## Constraints

- **No browser** of any kind on this machine: no headless Chrome, Playwright, Puppeteer or screenshot tools. UI checks go back to the lane, which raises NEEDS-BROWSER.
- **Never run `mppx`** in any form. Never call an RPC. No keys.
- **Scope.** Change nothing outside the lease. Never stage `bun.lock`. No new dependencies; viem is already one. TypeScript strict, no `any`.

## Acceptance

```
bun install && bun run typecheck && bun test packages/rail/src/mpp && bun test && forge test
```

Every command passes, with no new skips. Commit on `cs/hd-06` with short present-tense messages ending `refs #5`, and no trailers. Write the report. Do not push, merge or deploy.
