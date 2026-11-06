# cs-07b-slip-commit-fix — corrective: chain binding, check name, pinned escrows, honest offline verdict (refs #37)

## Setup

You continue on the cs-07 branch, in the same worktree. Run `bun install` at the root first.

Read the reviewer's report at `$M/reports/review-slip-hash-a4edb7b.md`. Then read the reviewer's tests, now in your worktree: `packages/verify/test/w1-attacks.test.ts` and `packages/rail/test/w1-attacks.test.ts`.

## Goal

Make every test in both `w1-attacks.test.ts` files pass **without editing those two files**, and keep every other test passing.

## Lease

You may create or change only these paths:

- `packages/verify/src/verify.ts` and `packages/verify/src/cli.ts`
- `packages/verify/src/known-escrows.ts` (new)
- `packages/verify/test/onchain.test.ts` and `packages/verify/test/verify.test.ts`, to update them for the renamed check and the new behaviour
- `.packets/reports/cs-07b-slip-commit-fix.md`

Never edit `packages/verify/test/w1-attacks.test.ts`, `packages/rail/test/w1-attacks.test.ts`, any `package.json`, `bun.lock` or anything else.

## What to change

1. **The check name goes back to `onchain`.** The finding that compares `Released.slipHash` and `jobOf(jobId).slipHash` with `slipCommitHash(body)` must be named `"onchain"`, because the reviewer's tests and the web slip view look for that name. Keep the passing detail text starting `the chain holds this slip's hash:`.
2. **B7, chain binding.** Before any log or `jobOf` read, call `getChainId()` on the RPC client. If it differs from `body.chainId`, the `onchain` finding fails with `the RPC answers as chain <n>, the slip names chain <m>`, and nothing else is read from that client. Give the client a `defineChain` whose id is `body.chainId`, so viem never infers the chain.
3. **Pinned escrows (should-fix 2).** `packages/verify/src/known-escrows.ts` exports `KNOWN_ESCROWS: Array<{chainId: number; escrow: Address; name: string}>` with exactly these three entries:
   - `{chainId: 5042002, escrow: "0x19c27d770969291e6a0a305dc1be1a845e7c1b76", name: "Arc testnet, deployed through Arc Studio"}`
   - `{chainId: 5042002, escrow: "0x44d11b8909485e3f575F6628b689383E4420f54a", name: "Arc testnet, forge deployment"}`
   - `{chainId: 1874, escrow: "0x9279D3edeef4c3738a0b200D762e2985Ff3B7eb4", name: "Whitechain Sepolia"}`

   `verifySlip` takes an optional `knownEscrows` in its options, defaulting to `KNOWN_ESCROWS`, so tests can pass anvil's deployment. When `body.escrow` is set, add a finding `"escrow"`. It is ok when (`chainId`, `escrow`) matches an entry, compared case-insensitively, with detail `known escrow: <name>`. Otherwise it fails with `unknown escrow <addr> on chain <n>: not a countersign deployment this verifier knows`.
4. **An honest offline verdict (should-fix 1).** In `cli.ts`:
   - when the verdict is valid but the `skipped` list is non-empty, print `VALID (offline: the chain was not read)` instead of `VALID`;
   - the exit code stays 0;
   - with `--rpc` and every check ok, print `VALID`;
   - the exit code is 1 when invalid, as now.
5. Keep the rest of the cs-07 behaviour: zero guards, `slipCommitHash`, the jobId-topic log fetch, and the `jobOf` cross-check.

## Acceptance

From the worktree root:

```
bun install && bun run typecheck && bun test packages/verify packages/rail && bun test && forge test
```

Every command passes, with no skipped tests. Every test in both `w1-attacks.test.ts` files must pass unedited.

## Constraints

- **Never launch a browser of any kind on this machine**: no Chrome or Chromium, headless or not, no Playwright, Puppeteer or screenshot tools. UI checks go back to the lane, which raises NEEDS-BROWSER.
- No view code. Use only anvil in tests, never a public RPC. Use only the fixed anvil test keys.
- TypeScript strict, no `any`.

## Stop conditions

- You need to edit outside the lease: stop and write the report.
- One problem has blocked you for more than 20 minutes: stop, commit what passes, and write the report.

## Finish

Commit with small present-tense messages ending `(refs #37)`, and no trailers. Write `.packets/reports/cs-07b-slip-commit-fix.md`. Do not push, merge or deploy.
