# cs-24-runner-funding-check

Status: done. Refs #98, #93.

## What changed

- **`packages/runner/src/funding.ts`** (new). The runner's funding check:
  - the order's own terms are checked first: the rail is in `offer.rails`, `order.amount === offer.price`, and `order.payTo` is the offer's payee for that rail;
  - an escrow order (`escrow`, `whitechain`) must name a pinned `(chainId, escrow)` in the caller's known list, and `jobOf(order.jobId)` must show `Funded`, the offer's payee, at least `offer.price`, `order.offerHash`, and a deadline ahead;
  - a job not seen yet (status None or a failed read) is read up to 4 more times, 750 ms apart;
  - non-escrow rails (`gateway`, `hedera`, `mpp`, `eip3009`) stop at the terms check;
  - refusals use the phone's sentences with "this runner" for "this phone";
  - `rpcJobReader` does one `eth_call` per read and `--rpc`/`ARC_RPC_URL`/`WC_RPC_URL` resolution lives in the CLI. A chain with no RPC fails the read, which becomes the "could not read the job on chain" refusal.
- **`packages/runner/src/daemon.ts`**. `startRunner` takes an optional `funding` config. When present, `handleJob` runs the check after the input-schema check and before `runInChild`; a refusal sends `fail` and never starts the child. Without `funding`, behaviour is unchanged.
- **`packages/runner/src/cli.ts`**. `serve` turns the check on by default with `KNOWN_ESCROWS` and Arc's default RPC (`https://rpc.testnet.arc.network`, or `ARC_RPC_URL`). `--known-escrow <chainId>=<address>` and `--rpc <chainId>=<url>` are repeatable and add to those defaults. `WC_RPC_URL` supplies chain 1874 when set.
- **`packages/runner/src/index.ts`**. Exports the funding types and helpers for library callers.
- **`packages/runner/package.json` / `bun.lock`**. Added `@countersign/verify` as a workspace dependency.
- **`packages/runner/test/funding.test.ts`** (new). 19 tests.

No wire messages or typed data were added. The payee bond-lock signature is cancelled by STEER-1940, so the check reads only `jobOf`; there is no `bondOf` read in this packet.

`docs/spec/runner.md` does not exist in this tree, so no spec note was added.

## Tests

```
bun run typecheck          # pass
bun test packages/runner   # 52 pass, 0 fail
bun test                   # 918 pass, 3 skip, 0 fail (one unrelated apps/hub frontdoor test flaked once under the full parallel run; it passed alone and the full suite passed on rerun)
forge test                 # 47 pass, 0 fail
```

The funding tests cover: a pinned, funded job passes; unpinned escrow, a job unseen after the retries, payee mismatch (including an offer `payTo` override), short amount, another offer hash, a passed deadline, and an unreadable chain each refuse with their sentence; the third read may be the Funded one; a gateway order skips the chain; whitechain is treated as an escrow order; the terms refusals; the CLI defaults and flag/environment merging; and the daemon sending `fail` without spawning the child.

No network, browser, contract, `apps/**` or `packages/core` changes were made.
