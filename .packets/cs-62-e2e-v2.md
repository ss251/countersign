# cs-62-e2e-v2: the e2e suite on escrow v2 (Arc), phase 1

Lane: cs-e2e. Base: `cs/int` at `108cb4b`, which has PR #164 (escrow v2, 52b7c7c) and #198 merged and
whose tree equals `cs/e2e` at 3b1d81e. Branch: `cs/cs-62`.

Checked on this base before launch, so you need not rediscover them:

- `apps/hub/src/rails.ts` reads `ARC_ESCROW_VERSION` ("2" means v2).
- `packages/runner/src/cli.ts` takes `--known-escrow <chainId>=<address>`.
- `packages/buyer` loads `KNOWN_RAILS` plus `state.loadRails()`.
- `packages/rail/src/escrow/index.ts` exports `fundArgsV2`.
- The v2 contract has `tollAccrued()` and `error SettleWindowOpen(bytes32 jobId, uint256 settleBy)`.
  `refund` reverts with it until `deadline + DISPUTE_WINDOW` (600).
- The 60 s floors and the seller's `Lock` apply only to bonded jobs.
- `packages/verify/src/cli.ts` has no pin flag, so the verifier case below is "change nothing".

Phase 1 uses bond 0 and window 0, so none of the bonded rules apply. Project lead, STEER-1950 answers: production Arc switches to v2 with one env change back to v1
as the fallback, and the full e2e suite runs on v2.

Phase 1 runs the claims the suite already proves on the v2 contract, with offers of review window 0 and
bond 0. On v2 a window of 0 releases at once, as on v1. New v2 claims (accept, dispute, release after
the window, bonded failDelivery) are phase 2, a later packet, once the runner can publish a window and
a bond.

Whitechain stays on v1 in this packet. Its relay handles v1 only on every branch, and cs-wc's wc-09
builds v2 there.

## The switch

- `E2E_ESCROW_VERSION`: `"2"` means v2 for Arc; anything else, including unset, means v1. Read it once,
  in `e2e/lib/chains.ts`, as `export const ESCROW_VERSION: 1 | 2`.
- `E2E_ARC_ESCROW_V2`: the v2 Arc escrow address, required when the version is 2. If it is missing,
  importing `chains.ts` throws `E2E_ESCROW_VERSION=2 needs E2E_ARC_ESCROW_V2`.
- `ARC.escrow` is the v2 address when the version is 2, else the v1 address it has today. Every user of
  `ARC.escrow` follows automatically. Add `ARC.escrowVersion` (`1 | 2`).
- The run report's header gains a row `escrow` with the version and the Arc escrow address. Change
  `e2e/lib/report.ts` and the meta built in `e2e/run.ts`, and nothing else in `run.ts`.

## `e2e/lib/chains.ts`

- Contract facts for v2 come only from `contracts/src/ICountersignedEscrow.sol` and
  `contracts/src/CountersignedEscrow.sol` on your base. Copy each event and error signature verbatim,
  indexed flags included, into a `parseAbi([...])` constant `ESCROW_V2_EXTRA`. That covers the events
  `Delivered`, `Accepted`, `WindowElapsed`, `Disputed`, `DeliveryFailed`, `BondForfeited`, `TollSwept`
  and `TermsSet`, and every custom error of v2. `Funded`, `Released` and `Refunded` are unchanged, so
  keep decoding them with the v1 ABI.
- `escrowEvents(net, rcpt)` additionally decodes the v2 events when `net.escrowVersion === 2`, under
  the same keys pattern it uses now (lower-camel event name, an array of decoded args).
- `JOB` gains `Failed: 4, Delivered: 5, Disputed: 6`. The v1 contract never returns them.
- `revertOf` decodes errors with the v1 ABI on v1, and with v1 plus `ESCROW_V2_EXTRA` plus the
  functions in `packages/rail/src/escrow/abi-v2.ts` on v2. On v2 it accepts the v2 function names it
  is asked about (`fund`, `refund`, `release`, `cancel`).
- `jobOf` on v2: read the v2 `jobOf` exactly as the interface declares it, and map it onto the same
  `JobRecord` fields the flows use today.
- New `tollAccruedOf(net): Promise<bigint>`: `tollAccrued()` on v2. On v1 it throws "v1 has no accrual".

## `e2e/lib/actors.ts`

- `startHub` with `arc`: when the version is 2, also pass `ARC_ESCROW_VERSION=2`. `ARC_ESCROW` is
  already `ARC.escrow`. The health check against `ARC.escrow` stays.
- `startSkillSeller`: when the version is 2, add `--known-escrow 5042002=<ARC.escrow>` to `runner serve`.
- Buyer pin: when the version is 2, every buyer state directory the suite creates gets a `rails.json`
  before the first `buyerCli` call. It is an array with one entry, built from the Arc entry of
  `KNOWN_RAILS` (`packages/buyer/src/known-rails.ts`), with `escrow: ARC.escrow` and `version: 2`. The
  buyer reads it through `state.loadRails()` and pins it. Write it from one helper,
  `pinArcV2(stateDir)`, called wherever the suite creates a buyer state.
- `verifyCli`: if `packages/verify/src/cli.ts` takes a pin flag for extra escrows, pass the v2 Arc
  address with it. If it takes none, change nothing: the verifier then refuses the v2 escrow until
  orch-cs promotes it into `KNOWN_ESCROWS`, and that red is correct. Say which case applies in your
  report.

## Flows (v1 behaviour stays byte-for-byte; each change is `if (ARC.escrowVersion === 2)`)

- `arc-spine`: on v2, toll accrues instead of moving at release. Replace the "toll transfer to the
  treasury in the release tx" check with: `tollAccruedOf(ARC)` after the release equals before plus
  `Released.toll`, and no token transfer to the treasury happens in the release tx. Every other check
  stays.
- `arc-wrong-amount`: on v2, build the fund arguments with `fundArgsV2` from
  `packages/rail/src/escrow/index.ts`, and the job id with the v2 derivation that core exports for
  v2 countersignatures. Bond and window are 0. The expected revert stays `CountersignatureMismatch`.
- `arc-deadline-refund`: on v2, the stranger's early refund must revert `SettleWindowOpen`, not
  `DeadlineNotReached`. The wait before the real refund is until chain time passes
  `deadline + 600` (the contract's `DISPUTE_WINDOW`; read it from the contract if it exposes it,
  else 600). The near-deadline guard uses the same target. On v2 the flow also sets
  `onDemand: "on escrow v2 it waits the 600 s settle window; run it with --with arc-deadline-refund"`.
  The money checks are unchanged.
- `ratings`: on v2, any wait for the hub's janitor to refund a job waits until `deadline + 600`. On v2
  it is `onDemand` with the same wording, naming itself.
- `slip-onchain-arc`, `public-spine`, `discovery`, `refusals`, `runner-restart`, `arc-gateway`: no
  change. If one needs a change to pass on v2 with window 0, stop and report it rather than change an
  assertion.

## Tests you write and run (`bun test e2e/test`)

Add offline tests:

- with `E2E_ESCROW_VERSION=2` and an address set, `ARC.escrow` and `ARC.escrowVersion` follow; without
  the address, the import throws the message above (spawn `bun -e` in a child process for these, so
  the env does not leak between tests);
- `JOB` has the new statuses;
- `escrowEvents` decodes a synthetic v2 `Delivered` log, built with viem's `encodeEventTopics` and
  `encodeAbiParameters` from `ESCROW_V2_EXTRA`;
- `pinArcV2` writes a `rails.json` that the buyer's own `KnownRail` type accepts, with `version: 2`.

## Docs

`docs/e2e.md` gains a short section "Escrow version". It covers the two env vars, what changes on v2
and why: toll accrual, the 600 s settle window, flows 3 and 13 on demand on v2, the buyer pin and the
verifier pin. It also says Whitechain stays v1 until wc-09.

## Gate (paste the tails in your report)

1. `bun run typecheck` clean.
2. `bun test e2e/test` all pass.
3. `bun run e2e -- --list` lists every flow; then
   `E2E_ESCROW_VERSION=2 E2E_ARC_ESCROW_V2=0x000000000000000000000000000000000000dEaD bun run e2e -- --list`
   lists them too, with 3 and 13 marked on demand.

## Constraints

- **No browser of any kind on this machine:** no headless Chrome, Playwright, Puppeteer or screenshot
  tools.
- Do not run any flow (`bun run e2e` without `--list` or `--dry`). Flows move real testnet funds; the
  lane runs them.
- Touch only `e2e/**` and `docs/e2e.md`. Never edit `contracts/`, `packages/`, `apps/` or `scripts/`.
  Never read, print or log a key.
- Never run `git stash` (the worktrees share one stash stack); use a temporary commit or a second worktree.
- Never push, merge or deploy. Small present-tense commits on `cs/cs-62`. No emoji, no Co-authored-by
  and no other trailers.
- **No assertion is weakened.** Each v2 change replaces a v1-only fact with the v2 fact the contract
  defines, cited in your report with the interface line. If a v1 check has no v2 equivalent, stop and
  report it.
- If something cannot be done as written, stop and say exactly what and why. Do not substitute another
  mechanism.

## Report

`.packets/reports/cs-62-e2e-v2.md`: each change with the interface lines it relies on, the verifier pin
case, and the gate outputs.
