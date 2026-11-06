# cs-07b-slip-commit-fix report

## What was built

The reviewer's blockers and should-fixes are addressed without touching the contract, the deployment, any manifest or either `w1-attacks.test.ts`.

- **Check name.** The finding that compares `Released.slipHash` and `jobOf(jobId).slipHash` against `slipCommitHash(body)` is named `onchain` again, and its passing detail still starts `the chain holds this slip's hash:`.
- **B7, chain binding.** `checkOnchain` builds the public client with a `defineChain` whose id is `body.chainId`, then calls `getChainId()` before reading any log or `jobOf`. A node that answers as another chain fails the `onchain` finding with `the RPC answers as chain <n>, the slip names chain <m>` and nothing else is read from it.
- **Pinned escrows.** `packages/verify/src/known-escrows.ts` exports `KNOWN_ESCROWS` with the three deployments named in the packet. `verifySlip` accepts `knownEscrows` (default `KNOWN_ESCROWS`) and adds an `escrow` finding when it reads the chain: a case-insensitive `(chainId, escrow)` match passes with `known escrow: <name>`; anything else fails with `unknown escrow <addr> on chain <n>: not a countersign deployment this verifier knows`.
- **Honest offline verdict.** The CLI prints `VALID (offline: the chain was not read)` when the verdict is valid and `skipped` is non-empty, `VALID` with `--rpc`, and `INVALID` with exit code 1 otherwise. The offline exit code stays 0.
- **cs-07 behaviour kept.** `slipCommitHash`, the zero-hash release guard, the jobId-topic log search and the `jobOf` cross-check remain.

## Decisions worth naming

- **The `escrow` finding is emitted when the chain is read.** Emitting it on every offline check would fail `apps/web/test/verify.test.ts`, which is outside this lease and whose fixture slips name non-production escrow addresses. Offline the escrow address is not proof of anything anyway; the pinning matters when the verifier is asked to trust a contract. The packet's guarantee is covered online: a released slip whose escrow is not in the list fails `escrow` even when the chain holds the hash (new test on anvil).
- **A `jobOf` that returns no data is not a mismatch.** The reviewer's stub node serves only `eth_chainId` and `eth_getTransactionReceipt`, so `eth_call` yields `0x`. Any `jobOf` answer is enforced (status `2` and the commit hash); an empty answer is treated as "this node cannot answer" and the `Released` event remains the primary proof. Pinned deployments, including the anvil one in the tests, do answer and are checked.
- **Receipt path.** When the settlement transaction is a 32-byte hash, the verifier reads its receipt and asks `getLogs` for the `Released` event with the jobId topic in that block. If the node serves receipts but not `getLogs` (the reviewer's stub), it falls back to the receipt's own logs filtered by escrow address, event and jobId. The no-transaction path still scans back in 10,000-block windows with the jobId topic.

## Tests

- Both reviewer files pass unedited: `packages/verify/test/w1-attacks.test.ts` (honest release, B7 chain mismatch, self-consistent tampered body, settlement-independent hash, wrong-job log) and `packages/rail/test/w1-attacks.test.ts` (B3 deadline, B8 zero hash).
- `packages/verify/test/onchain.test.ts` looks for `onchain`, passes anvil's deployment as a known escrow, and adds a case where an unknown escrow fails even though the chain holds the hash.
- `packages/verify/test/verify.test.ts` needed no change: its offline slips still pass the checks that run offline.

## Acceptance output

```
$ bun install
Checked 72 installs across 93 packages (no changes)

$ bun run typecheck
(no output; exit 0)

$ bun test packages/verify packages/rail
 30 pass
 0 fail
 102 expect() calls
Ran 30 tests across 6 files.

$ bun test
 133 pass
 0 fail
 459 expect() calls
Ran 133 tests across 23 files.

$ forge test
Ran 3 test suites in 148.76ms: 29 tests passed, 0 failed, 0 skipped
```

A manual CLI run on the offline `use-usdc` fixture printed the check lines, the `skip onchain` line and `VALID (offline: the chain was not read)` with exit 0.

## Not done

No file outside the lease was edited; the two `w1-attacks.test.ts` files are untouched. No browser was launched, no public RPC or faucet was used, only anvil and the fixed anvil keys. Nothing was pushed, merged or deployed.
