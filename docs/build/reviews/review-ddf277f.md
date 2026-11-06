> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Re-review ddf277f (PR 84, cs/hd-06, hd-06f, #5): the B17 corrective

Reviewer: cs-w1. Result: **blockers=0 should-fix=0**. `packages/rail/src/mpp/test/w1-mpp.test.ts` (cs/w1 3c21fbc) is byte-identical on ddf277f and passes. The mpp tests give 48 pass and 0 fail.

## B17: closed
- Every challenge carries `meta: {nonce}`, 16 random bytes inside the HMAC'd challenge, so two 402s never share an id. The `/rail/paid` 402's `opaque` decodes to `{nonce}`.
- Replay is keyed on the challenge and on the transfer itself:
  - `tempo-hash:<hash>` for push;
  - `tempo-tx:<keccak256(signature)>` for pull;
  - `stripe-spt:<spt>` for Stripe.
- So one on-chain transfer can be claimed only once, under any challenge. A hijacker cannot rebuild a buyer's challenge, and the memo binding refuses the buyer's transfer under any other challenge.
- Proof credentials are refused for priced offers.

## Should-fixes from d2c824c: closed
1. A failed broadcast releases both claims, so a retry can recover a push transfer that is already on chain. The demo server never answers 402 after a credential: 400 refused, 409 replay, 502 payment_failed.
2. The payer is the sender of the matching pathUSD `Transfer` log on the receipt. The credential's `source` is never used.

## Notes for the merge and the hub glue
- `packages/rail/package.json` gains dependencies without a `bun.lock` change, so `bun install --frozen-lockfile` fails on this head until orch-cs regenerates the lockfile at merge.
- The default replay store is in memory. When the hub wires this rail (cs-16), keep the job id derived from the settled transfer (today `keccak256(settle.transaction)`), so the jobs table refuses a replay after a hub restart.
