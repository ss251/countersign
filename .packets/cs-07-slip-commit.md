# cs-07-slip-commit — the on-chain slip hash: never zero, one commit rule, the verifier proves it (refs #37)

## Setup

Run `bun install` at the worktree root before anything else.

## Goal

The escrow already commits the slip on chain: `release(jobId, slipHash, sellerSig)` stores `job.slipHash` and emits `Released(bytes32 indexed jobId, bytes32 indexed slipHash, address indexed payee, uint256 paid, uint256 toll)`. Make that commitment a proof.

- The release path can never send `bytes32(0)`.
- The hash released is exactly the hash of the slip the buyer receives.
- core defines the commit hash in one place.
- The verifier fetches the job's `Released` event from the chain and checks it against the hash it recomputes.

The contract does not change, and nothing is redeployed. The rule is in `docs/decisions.md` D9. Read it first.

## Lease

You may create or change only these paths:

- `packages/core/src/slip.ts` and `packages/core/test/slip-commit.test.ts` (new)
- `packages/rail/src/escrow/index.ts`: the zero guard in `escrow.release` only
- `packages/rail/test/escrow.test.ts`: add tests only
- `apps/hub/src/call.ts`: the guard right before `rail.escrow.release` only
- `apps/hub/test/call.test.ts`: add tests only
- `packages/verify/src/verify.ts` and `packages/verify/src/cli.ts`
- `packages/verify/test/**`
- `.packets/reports/cs-07-slip-commit.md`

Do not edit any `package.json`, `bun.lock`, `contracts/**` or anything else.

## What to build

1. **core** (`packages/core/src/slip.ts`):
   - `export function slipCommitHash(body: SlipBody): Hex`. It returns `keccak256(canonicalJson(body))`, the same value as `slipHash(body)`, and its doc comment states the D9 rule.
   - Keep `slipHash` as is.
   - `export const ZERO_HASH: Hex = "0x" + "00".repeat(32)`, typed as `` `0x${string}` ``.
2. **rail** (`packages/rail/src/escrow/index.ts`): in `escrow.release`, if `slipHash` is `ZERO_HASH` (case-insensitive), return `{success: false, errorReason: "Refused. A release must commit a slip hash.", transaction: "", network}` without sending.
3. **hub** (`apps/hub/src/call.ts`): before calling `rail.escrow.release`, require both of these:
   - `slip.hash.toLowerCase() === slipCommitHash(slip.body).toLowerCase()`;
   - `slip.hash` is not `ZERO_HASH`.

   On failure, use the same 502 `failed-delivery` path as other slip failures. The value passed to `release` must be `slip.hash`, the same variable the stored slip and the 200 response carry.
4. **verifier** (`packages/verify/src/verify.ts`). With `rpcUrl` and `body.escrow` both set, replace the current receipt-scan `onchain` check with a check named `slip hash`:
   1. Compute `commit = slipCommitHash(slip.body)`.
   2. Fetch the event: `getLogs({ address: body.escrow, event: Released, args: { jobId: body.jobId }, fromBlock, toBlock })`.
      - If `slip.settlement.transaction` is a 32-byte hex, read its receipt and use its block for both `fromBlock` and `toBlock`.
      - Otherwise, scan back from the latest block in windows of 10,000 blocks, at most 50 windows, stopping at the first hit.
   3. Require exactly one event, and `event.args.slipHash.toLowerCase() === commit.toLowerCase()`.
   4. Also `readContract` `jobOf(body.jobId)` on `body.escrow` and require status `2` (Released) and `job.slipHash === commit`. For the ABI, use a minimal inline ABI with `jobOf(bytes32) returns ((address buyer,uint64 deadline,uint8 status,address payee,uint256 amount,bytes32 offerHash,bytes32 slipHash))`.
   5. The passing detail reads `the chain holds this slip's hash: Released(jobId, slipHash) in block <n>, tx <hash>`. A failing one names what differs: event missing, the event hash differs from the recomputed hash, or `jobOf` disagrees.

   Without `rpcUrl`, keep the existing `skipped` line. Keep the other checks unchanged.
5. **cli** (`packages/verify/src/cli.ts`): no change in behaviour beyond the new check's name and detail.

## Tests

- `packages/core/test/slip-commit.test.ts`:
  - `slipCommitHash` equals `slipHash`;
  - changing `settlement.transaction`, `settlement.receipt` or `payment` on a `Slip` does not change `slipCommitHash(slip.body)`;
  - changing any one of `amount`, `outputHash` or `children` does change it.
- `packages/rail/test/escrow.test.ts`: `escrow.release(jobId, ZERO_HASH, sig)` returns `success: false` and no tx is sent. Check that `status(jobId)` stays `funded` on anvil.
- `apps/hub/test/call.test.ts`: on the happy path, the `slipHash` the FakeRail's `release` received equals `slipCommitHash(response.slip.body)` and is not `ZERO_HASH`.
- `packages/verify/test/onchain.test.ts`, a new test on anvil, following the pattern in `packages/rail/test/escrow.test.ts`:
  1. Build with `forge build`, start anvil on a random port, deploy `MockEIP3009` and `CountersignedEscrow` from `contracts/out`, mint to the buyer.
  2. Fund a job through `escrowRail(...).settle`, build a slip body with `slipBodyFor`, sign `slipTypedData(body)` with the seller key, and release with `slipCommitHash(body)`.
  3. Write a full `Slip` with `settlement.transaction` = the release tx.
  4. `verifySlip(slip, {rpcUrl})` returns valid, and the `slip hash` check passes.
  5. **Negative:** copy the slip, change `body.amount`, set `hash = slipCommitHash(tamperedBody)` so the slip is internally consistent, and verify. The `slip hash` check must fail and the verdict must be invalid. Assert on the `slip hash` finding itself, not only on the overall verdict.
  6. A slip whose job was never released (fund only) fails `slip hash` with "event missing".

## Constraints

- **Never launch a browser of any kind on this machine**: no Chrome or Chromium, headless or not, no Playwright, Puppeteer or screenshot tools. UI checks go back to the lane, which raises NEEDS-BROWSER.
- Never call a faucet. Never use a private key except the fixed anvil test keys. Tests use only anvil, never a public RPC.
- TypeScript strict, no `any`. Do not change the contract or any deployment.

## Acceptance

From the worktree root:

```
bun install && bun run typecheck && bun test packages/core packages/rail packages/verify apps/hub && bun test && forge test
```

Every command passes, with no skipped tests.

## Stop conditions

- You need to edit outside the lease: stop and write the report.
- One problem has blocked you for more than 20 minutes: stop, commit what passes, and write the report.

## Finish

Commit on your branch with small present-tense messages that end with `(refs #37)`, and no trailers. Write `.packets/reports/cs-07-slip-commit.md`. Do not push, merge or deploy.
