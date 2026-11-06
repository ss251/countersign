# cs-07-slip-commit report

## What was built

D9 is now enforced end to end without changing the contract or redeploying anything.

- `packages/core/src/slip.ts`: `slipCommitHash(body)` returns the commit hash, with the D9 rule in its doc comment. It delegates to the existing `slipHash`, so core still computes the body hash in one place. `ZERO_HASH` is exported as a `Hex` (`0x` plus 32 zero bytes).
- `packages/rail/src/escrow/index.ts`: `escrow.release` refuses `ZERO_HASH` case-insensitively before it builds or sends a transaction. The refusal is `{success: false, errorReason: "Refused. A release must commit a slip hash.", transaction: "", network}`.
- `apps/hub/src/call.ts`: before `rail.escrow.release`, the hub requires `slip.hash.toLowerCase() === slipCommitHash(slip.body).toLowerCase()` and a non-zero `slip.hash`. A failure takes the existing 502 `failed-delivery` path. The hash passed to `release`, stored in the slip and returned in the 200 body is one `slipHash` variable.
- `packages/verify/src/verify.ts`: with an RPC and an escrow address, the old receipt scan is replaced by a `slip hash` check. It recomputes the commit, reads the job's `Released` event (receipt block when the settlement transaction is a 32-byte hex, otherwise up to 50 backward windows of 10,000 blocks), requires exactly one event whose `slipHash` equals the commit, then reads `jobOf` and requires status `2` (Released) and the same `slipHash`. Passing detail: `the chain holds this slip's hash: Released(jobId, slipHash) in block <n>, tx <hash>`. Failures name a missing event, a differing event hash, or a `jobOf` disagreement. Without an RPC the existing skipped line remains; rails without an escrow keep the old `onchain` line.

No ABI, contract, deployment, `package.json` or `bun.lock` changed.

## Tests

- `packages/core/test/slip-commit.test.ts`: the commit equals `slipHash`; changing the settlement transaction, receipt or payment leaves it unchanged; changing `amount`, `outputHash` or `children` changes it; `ZERO_HASH` is 32 zero bytes.
- `packages/rail/test/escrow.test.ts`: a funded job released with `ZERO_HASH` returns the refusal, sends no transaction (sender nonce unchanged) and stays `funded` on anvil.
- `apps/hub/test/call.test.ts`: on the happy path the FakeRail receives `slipCommitHash(response.slip.body)`, not `ZERO_HASH`.
- `packages/verify/test/onchain.test.ts` (anvil, real bytecode): a released slip passes `slip hash`; a tampered body with a recomputed hash fails that finding and the verdict; a funded but unreleased job fails with `event missing`.

The verify test imports the rail source by relative path because `packages/verify/package.json` does not declare `@countersign/rail` and the packet forbids editing manifests.

## Acceptance output

```
$ bun install
Checked 72 installs across 93 packages (no changes)

$ bun run typecheck
(no output; exit 0)

$ bun test packages/core packages/rail packages/verify apps/hub
 83 pass
 0 fail
 285 expect() calls
Ran 83 tests across 15 files.

$ bun test
 126 pass
 0 fail
 441 expect() calls
Ran 126 tests across 22 files.

$ forge test
Ran 3 test suites: 29 tests passed, 0 failed, 0 skipped
```

## Not done

Nothing in the packet was left undone. No browser was launched, no faucet was called, no public RPC or non-anvil key was used, and nothing was pushed, merged or deployed.
