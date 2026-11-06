# cs-02-runner report

## What I built

`packages/runner`, the seller side:

- `src/skill.ts` — hand-parsed SKILL.md front matter, SHA-256 over the file
  bytes, section extraction by heading text (case-insensitive, up to the next
  heading of the same or higher level), the skill input/output schemas and
  `skillOffer`.
- `src/child.ts` + `src/child-entry.ts` — `scrubbedEnv` keeps only PATH and a
  fresh HOME; `runInChild` spawns the child entry on a pipe, enforces the time
  and output-size ceilings with `CeilingError`, and surfaces a non-zero exit as
  the child's one-line error.
- `src/daemon.ts` — dial-out WebSocket runner: challenge/hello with the seller
  signature, ready/ping/pong, offer lookup, deadline check, input gate, child
  run, output gate, canonical slip body, slip hash and EIP-712 seller
  signature. Reconnects with 1/2/4/8/16/30 s backoff, reset on ready.
- `src/publish.ts` — signs `publishMessage(offerHash)` and POSTs the offer.
- `src/cli.ts` — `publish` and `serve`, hand-parsed flags, key only from
  `CS_SELLER_KEY`, one log line per job.
- `src/index.ts` — the requested exports.
- Tests: front matter/hash/section/offer, scrubbed env and both ceilings, and a
  real `Bun.serve` fake hub covering hello recovery, a signed slip, bad input,
  a passed deadline and an unknown offer.

## Acceptance

```
$ bun install
Checked 59 installs across 82 packages (no changes) [15.00ms]

$ bun run typecheck
$ tsc -p tsconfig.json
(no output)

$ bun test packages/runner
 13 pass
 0 fail
 42 expect() calls
Ran 13 tests across 3 files. [376.00ms]

$ bun test
 57 pass
 0 fail
 157 expect() calls
Ran 57 tests across 9 files. [328.00ms]

$ forge test
Ran 3 test suites in 155.97ms (122.24ms CPU time): 29 tests passed, 0 failed, 0 skipped (29 total tests)
```

No tests are skipped or todo.

## Notes

- `packages/runner/package.json` does not declare `viem`, and the lease forbids
  editing it. The runner therefore describes the seller account structurally in
  `src/account.ts` (address plus `signMessage`/`signTypedData`), which a viem
  `LocalAccount` satisfies. The CLI and tests resolve viem through
  `@countersign/core`'s declared dependency with `createRequire` (anchored at
  `@countersign/core`), then dynamically import `viem` and `viem/accounts`.
  Nothing else depends on that workaround.
- The child ceiling checks run in this order: time, output size, then exit code,
  so a killed child reports the ceiling refusal rather than a generic exit.
- No files outside the lease were changed.
