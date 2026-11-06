# hd-11-charged-window: the agent answers "was I charged?" only when the chain can, and every mirror attempt has a timeout

## Goal

Build exactly what `/Users/thescoho/Developer/countersign-mumbai/hd/DESIGN-charged-window.md` decides (read it first). This is cs-w1's should-fix and note from the review of 3601229 (`/Users/thescoho/Developer/countersign-mumbai/reports/review-3601229.md`). Tracked by issue #41.

- **The should-fix.** After a hub failure, `charged()` gives up after 12 s of "not on the mirror" and releases the reservation, but the signed transfer can still land until its valid window closes (120 s on production). After this change, the agent releases only once the window has closed, and keeps the reservation when the mirror cannot answer.
- **The note.** Every mirror attempt gets a timeout.

## Lease

- `packages/buyer/src/hedera/signer.ts`: the return values of `signHederaTransfer` and `hederaPayment` only
- `packages/buyer/src/hedera/agent.ts`: `charged`, its two call sites in `buy`, the new constants, and the `sleep` option
- `packages/rail/src/hedera/mirror.ts`: `mirrorFetch`'s attempt, the new option, and the new constant
- New test files:
  - `packages/buyer/src/hedera/test/charged.test.ts`
  - `packages/rail/src/hedera/test/mirror-timeout.test.ts`
- Report: `/Users/thescoho/Developer/countersign-mumbai/reports/hd-11-charged-window.md`

## The decided design

1. **`signer.ts`.**
   - `signHederaTransfer` returns `{ transaction, transactionId, validUntil }`.
   - `validUntil` is computed from the frozen transaction as `Number(tx.transactionId!.validStart!.seconds.toString()) + tx.transactionValidDuration`.
   - `hederaPayment` passes it through as `{ payment, transactionId, validUntil }`.
2. **`agent.ts`, the constants.** Export them, with these values:

   | Constant | Value |
   |---|---|
   | `CHARGE_POLL_MS` | `2_000` |
   | `CHARGE_MARGIN_SECONDS` | `20` |
   | `CHARGE_UNKNOWN_SECONDS` | `60` |
   | `CHARGE_MAX_POLLS` | `300` |

   `HederaAgentOptions` gains `sleep?: (ms: number) => Promise<void>`, defaulting to `(ms) => new Promise((r) => setTimeout(r, ms))`.
3. **`agent.ts`, `charged`.** The signature is `charged(transactionId, req, validUntil)`. Loop at most `CHARGE_MAX_POLLS` times:
   1. **Read.** `let tx: MirrorTransaction | null | undefined;`, then `try { tx = await getTransaction(transactionId, opts.mirror); } catch { tx = undefined; }`.
   2. **A record.** If `tx` is a record, return `tx.result === "SUCCESS" && netFor(tx.tokens[req.asset] ?? [], opts.payer.accountId) === -BigInt(req.amount)`.
   3. **Not charged.** If `tx === null` and `now() >= validUntil + CHARGE_MARGIN_SECONDS`, return `false`.
   4. **Give up.** If `now() >= validUntil + CHARGE_MARGIN_SECONDS + CHARGE_UNKNOWN_SECONDS`, leave the loop.
   5. **Wait.** Otherwise `await sleep(CHARGE_POLL_MS)`.

   After the loop, `throw new Error(\`Unknown whether ${transactionId} was charged: the mirror did not answer after the transfer's valid window closed.\`)`.
4. **`agent.ts`, `buy`.**
   - Take `validUntil` from `hederaPayment` next to `payment` and `transactionId`, and pass it to both `charged` calls.
   - Change no other line of `buy`.
   - If `charged` throws, the error propagates out of `buy`, and the reservation stays held: no `release`, no `settleReservation`, no log entry. Both call sites already behave this way when `charged` throws; check that they still do.
5. **`mirror.ts`.**
   - Export `MIRROR_ATTEMPT_TIMEOUT_MS = 5_000`.
   - `MirrorOptions` gains `attemptTimeoutMs?: number`.
   - The attempt in `mirrorFetch` becomes `(opts.fetch ?? fetch)(url, { signal: AbortSignal.timeout(opts.attemptTimeoutMs ?? MIRROR_ATTEMPT_TIMEOUT_MS) })`.
   - Nothing else in `mirrorFetch` changes. A timed-out attempt throws, and is retried as transient.

## Tests (offline; no network, no RPC)

**Fixture.** Build the agent and the in-process fake hub the way `packages/buyer/src/hedera/test/agent.test.ts` does (`withHub`, `agentFor`, `afterPayment` returning a 500).

- Use a fake clock: `let t = Math.floor(Date.now() / 1000)`, with `now: () => t` and `sleep: async (ms) => { t += Math.ceil(ms / 1000); sleeps++; }`.
- The fake mirror reads `validStart` from the transaction id in the URL (mirror form `0.0.X-<seconds>-<nanos>`). It reads the valid duration from the requirements the fake hub issued, so `validUntil` matches the signer's.

`packages/buyer/src/hedera/test/charged.test.ts`:

- **The signer's `validUntil`.** `signHederaTransfer` returns `validUntil` equal to the decoded transaction's `validStart` seconds plus `transactionValidDuration`.
  - With `maxTimeoutSeconds: 120`, that is validStart + 120.
  - With `maxTimeoutSeconds: 300`, it is validStart + 180.
- **A late landing.**
  - Set-up: the hub answers 500 after payment. The mirror answers 404 until `t >= validUntil - 10`, then answers the SUCCESS record with the exact debit.
  - Expect `{ kind: "failed", status: 500, charged: true }`, one `spend` entry with the transaction id, and `spent.total` equal to the amount.
  - Today's code returns `charged: false` here.
- **It never lands.**
  - Set-up: the mirror answers 404 every time.
  - Expect `charged: false`. When `buy` returns, `t >= validUntil + CHARGE_MARGIN_SECONDS`.
  - Expect `spent.total` of `"0"`, and a second buy that fits the cap only if the first was released, to pay.
- **The mirror is down.**
  - Set-up: the mirror answers 500 every time, and the agent's mirror options set `retryDelaysMs: []`.
  - Expect `buy` to reject with a message containing `Unknown whether`.
  - A second buy that fits the cap only if the first was released must be refused `over-cap`, because the reservation is held.
- **A FAILED record.** It gives `charged: false` with zero `sleep` calls.

`packages/rail/src/hedera/test/mirror-timeout.test.ts`:

- **The defaults.** `MIRROR_ATTEMPT_TIMEOUT_MS` is `5000`, and every attempt receives an `init.signal` that is an `AbortSignal`.
- **A timeout is retried.** A fake fetch never answers, except by rejecting with `signal.reason` when its `init.signal` aborts. With `attemptTimeoutMs: 20` and `retryDelaysMs: [0]`, `mirrorFetch` rejects after 2 calls.
- **A hang, then an answer.** A fetch that hangs as above on the first call and answers 200 on the second returns the 200 after 2 calls.

Every existing test passes unedited.

## Constraints

- **No browser** of any kind on this machine: no headless Chrome, Playwright, Puppeteer or screenshot tools. UI checks go back to the lane, which raises NEEDS-BROWSER.
- **Never run a script under `scripts/hedera/`.** They spend real testnet funds.
- **No network** in tests. **No keys:** never read an env file, a config directory or the keychain.
- **Scope.** Change nothing outside the lease. Never stage `bun.lock`. No new dependencies. TypeScript strict, no `any`.

## Acceptance

```
set -o pipefail; bun install && bun run typecheck && bun test packages/rail/src/hedera packages/buyer && bun test && forge test
```

Every command passes, with no new skips. Commit on `cs/hd-11` with short present-tense messages ending `refs #41`, and no trailers. Write the report. Do not push, merge or deploy.
