# cs-33-runner-hub-lock: the seller's runner signs Lock(jobId) before the hub funds a bonded job

Branch `cs/33-runner-hub-lock`, from `cs/32-v21-fleet-abi`.

## Diff summary

### `packages/core/src/wire.ts`

- Added the hub-to-runner frame `{ t: "lock"; jobId; offerHash; escrow; chainId; bond }`.
- Added the runner-to-hub frames `{ t: "locked"; jobId; sig }` and
  `{ t: "lock-refused"; jobId; reason }`, each with a one-line doc comment.

### `packages/runner/src/daemon.ts`

- Added `handleLock`, selected by `case "lock"` in the message switch.
- It finds the served entry by `offerHash` as `handleJob` does and refuses an unknown offer with
  "Refused. This runner does not serve that offer.".
- It refuses when the served offer's bond is zero or differs from the frame's bond, with
  "Refused. The bond does not match this offer.".
- Otherwise it signs `lockTypedData(chainId, escrow, jobId)` with `cfg.account.signTypedData`
  and replies `locked`; a signing error replies `lock-refused` with
  "Refused. The runner could not sign.".
- The account's `signTypedData` type is narrowed to the slip's typed data, so the lock payload is
  structurally cast at the call site; no runtime change and no `any`.

### `apps/hub/src/runners.ts`

- Added `RunnerLink.lock(req, timeoutMs)`, using the same `find(offerHash)` lookup as `dispatch`.
- It keeps a per-connection `locks` map keyed by jobId, sends the `lock` frame, and resolves on
  `locked` (`{ sig }`) or `lock-refused` (`{ refused: reason }`) for that jobId.
- It answers `{ refused: "offline" }` when no runner serves the offer and `{ refused: "timeout" }`
  after `timeoutMs`; a closed connection or hub stop also resolves refused.
- `locked` accepts only `/^0x[0-9a-fA-F]+$/`; anything else counts as refused.
- Pending locks are drained wherever pending dispatches already were: stop, close, pong timeout
  and a failed ping.

### `apps/hub/src/call.ts`

- After the duplicate-payment check and the Privy ownership check, before settle, `paidCall` now
  derives `bondOfTerms(payment)`. A v2 payment with a positive bond on an escrow rail asks the
  runner for a lock with `jobId = nonce`, the stored offer hash, the rail's escrow and chain, and
  the bond, with a 10 s timeout.
- A refusal answers 409 `seller-declined` with
  "Refused. The seller did not accept this job, so nothing was charged."
- Settle is now `match.rail.settle(payment, match.entry, lockSig ? { lockSig } : undefined)`.
- Added `bondOfTerms` beside `termsReviewWindow`; it reads only v2 terms and returns the positive
  bond as a decimal string, otherwise null.
- Added a local `eip155ChainId` beside those helpers (`review.ts` has the same private helper, but
  that file is outside this packet's lease).

### New tests

- `packages/runner/test/lock.test.ts`: a fake hub socket runs the real runner daemon with a bond
  `"100"` offer and a bond `"0"` offer.
- `apps/hub/test/lock.test.ts`: a `RecordingRail` extends `FakeRail` and records settle's third
  argument; a fake WebSocket runner signs hello, answers `lock` and answers jobs with a valid slip.

No existing test was edited.

## Test names

`packages/runner/test/lock.test.ts`:

- the runner's lock handler > signs Lock(jobId) for a served bonded offer
- the runner's lock handler > refuses a bond that is not the served offer's
- the runner's lock handler > refuses a lock on a served offer with no bond
- the runner's lock handler > refuses an offer it does not serve

`apps/hub/test/lock.test.ts`:

- the hub's lock step > a bonded v2 payment settles with the seller's lock signature
- the hub's lock step > a refused lock answers 409 seller-declined and never settles
- the hub's lock step > a lock that finds no runner answers 409 seller-declined and never settles
- the hub's lock step > an unbonded v2 payment never asks for a lock and settles with no opts
- the hub's lock step > a v1 payment never asks for a lock and settles with no opts

## Final counts

From the worktree root:

- `bun install --linker hoisted`: checked 870 installs across 668 packages, no changes.
- `bun run typecheck`: passed with no diagnostics.
- `bun test`: 1209 passed, 3 skipped, 0 failed; 1212 tests across 142 files.
- `forge test`: 47 passed, 0 failed, 0 skipped across 5 suites.
