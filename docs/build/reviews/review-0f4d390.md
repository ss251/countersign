> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review 0f4d390 (cs/cs-07, Closes #37) — on-chain slip hash

Reviewer: cs-w1. Result: **blockers=0 should-fix=2**. B7 and B8 pass, and `bun test packages/verify packages/rail apps/hub` is 42/42.

## Against the five attack fronts
- **Zero or reused slipHash:** the rail refuses `bytes32(0)` before sending; the hub refuses a release unless `slip.hash == slipCommitHash(body)` and it is non-zero. A hash cannot be reused across jobs: the jobId is inside the hashed body, and the verifier requires exactly one `Released` event for the job whose hash equals the recomputed one.
- **Commit-body definition differing between hub and verifier:** one function, `slipCommitHash(body) = canonicalHash(body)`, in core, used by the hub, the rail guard and the verifier. The verifier compares the event with the hash it recomputes from the body, not with the slip's claimed `hash` field.
- **Settlement data leaking into the committed hash:** the body has no settlement, payment or receipt field, so release never waits on its own transaction; my receipt-independence test passes.
- **Cross-chain domain (Arc versus 1874):** the verifier reads the RPC's chain id and fails unless it equals `body.chainId` (B7); `(chainId, escrow)` must be in the pinned list, so a seller's own contract or a same-address contract on another chain verifies as unknown, not as proof. `jobOf` is cross-checked: status must be Released and its `slipHash` must equal the commit.
- **Tampered body with a self-consistent hash:** the `hash` finding passes, the `onchain` finding fails because the chain holds the original hash. Passes.
- The offline CLI now prints `VALID (offline: the chain was not read)`.

## Should-fix
1. **The `jobOf` cross-check is skipped on a zero-data answer.** The `catch` swallows `ContractFunctionZeroDataError` so stub nodes work. Against a real pinned escrow a zero-data answer cannot happen, but the code cannot tell a stub from a lying node: a node that returns empty data for `jobOf` and a forged `Released` log still passes. The RPC is trusted by definition, so this is not a forgery path, but gate the leniency behind a test-only option rather than the default.
2. **`slip.settlement.transaction` is outside the hash and chooses the block.** A buyer holding a genuine slip can swap that tx for another and make the receipt path find no event (the verifier then falls back only if the tx is not a 32-byte hex). Not a forgery, but a false INVALID; fall back to the windowed `getLogs` scan when the receipt path finds nothing, not only when the field is malformed.

The slip view's fifth check is cs-ui's and not in this range.
