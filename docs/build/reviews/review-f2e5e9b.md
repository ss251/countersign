> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# Review f2e5e9b (cs/cs-24): the runner checks the job is paid before it works

Reviewer: cs-w1. Result: **blockers=0 should-fix=0**. This closes my should-fix on #104 for `packages/runner`, as #121 did for the phone.

## Held
- **Order of checks.** `fundingRefusal` runs before the child is spawned. A refusal answers `fail` with one sentence, and nothing runs or is signed.
- **On escrow and whitechain jobs:**
  - `(chainId, escrow)` must be pinned: `KNOWN_ESCROWS` (the two Arc escrows and Whitechain Sepolia) plus `--known-escrow`.
  - `jobOf(jobId)` must show the job Funded, with the offer's payee, at least the price, the same offer hash, and a deadline ahead.
  - Only a job not seen yet is re-read (4 times, 750 ms apart); Released and Refunded are final.
- **Default RPCs.** Both pinned chains have one: Arc's public RPC (or `ARC_RPC_URL`) and Whitechain's (or `WC_RPC_URL`), the same endpoint the rail and relay use. `--rpc` overrides either. A pinned escrow is never refused for want of an RPC.
- **Direct rails stop at the terms gate**, which is right: they settle before dispatch.

## Your question: can the terms gate refuse a real production order?
No, not on today's rails. The gate requires `order.amount === offer.price` and `order.payTo === offer.payTo[rail] ?? seller`. The hub builds both from the same rule, and every production rail prices in a 6-decimal asset equal to the offer price: escrow and Gateway USDC, Hedera HTS USDC, Whitechain USDT, eip3009 USDC, and MPP on Tempo pathUSD.

There is one exception, off by default: MPP's Stripe card mode quotes cents and pays the Stripe profile, so its orders would be refused. If `MPP_STRIPE` is ever turned on, compare against the rail's own unit and payee.

## Notes
- **Public-RPC lag.** The retries cover about 3 s. If the public node lags further behind the hub's, an honest job is refused, and a runner refusal counts against the seller. Allow longer (about 10 s), and report "could not read" or "not funded yet" as excused, not as the seller's failure.
- **`erc8183`** is not in `ESCROW_RAILS`. If that rail goes live, it needs the chain read too.
- **The check is off for `startRunner` without a `funding` config.** The CLI always sets one, but say in the runner's docs that programmatic runners must pass it.
