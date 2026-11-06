# cs-62-e2e-v2 — report

Status: done. Refs #98, STEER-1950.

Phase 1 runs the claims the suite already proves on the Arc escrow v2 contract with offers of bond 0 and
review window 0. Whitechain stays on v1. No flow was run from this worktree; the lane runs them.

## The switch

### `e2e/lib/chains.ts`

- `ESCROW_VERSION` is read once: `E2E_ESCROW_VERSION === "2"` is 2, anything else including unset is 1.
  With version 2 and no `E2E_ARC_ESCROW_V2`, importing the module throws
  `E2E_ESCROW_VERSION=2 needs E2E_ARC_ESCROW_V2` before any network is built.
- `EvmNetwork` gained `escrowVersion: 1 | 2`. `ARC.escrowVersion` follows the switch and `ARC.escrow` is
  the v2 address when switched, else the v1 Arc Studio address it had. `WHITECHAIN.escrowVersion` is
  always 1.
- `ESCROW_V2_EXTRA` is a `parseAbi([...])` copy of v2's own events and every custom error, from
  `contracts/src/ICountersignedEscrow.sol`: `Delivered`, `Accepted`, `WindowElapsed`, `Disputed`,
  `DeliveryFailed`, `BondForfeited`, `TollSwept` and `TermsSet` (interface lines 65–79), and the full
  error list (interface lines 81–109), indexed flags included. `Funded`, `Released` and `Refunded`
  (lines 51–60) are unchanged, so they still decode through the v1 ABI.
- `JOB` gained `Failed: 4`, `Delivered: 5`, `Disputed: 6` (interface `Status`, lines 12–20). v1 never
  returns them.
- `escrowEvents` keeps the v1 decode for `funded`, `released` and `refunded`, then, only when
  `net.escrowVersion === 2`, decodes the eight v2 events into the same lower-camel, array-of-args shape
  (`delivered`, `accepted`, `windowElapsed`, `disputed`, `deliveryFailed`, `bondForfeited`, `tollSwept`,
  `termsSet`).
- `revertOf` uses the v1 ABI on v1. On v2 it uses v1 plus `ESCROW_V2_EXTRA` plus the functions in
  `packages/rail/src/escrow/abi-v2.ts`; viem's overload resolution picks the three-argument v2 `fund`
  over v1's two-argument one, while `release`, `refund` and `cancel` keep v1's unchanged signatures.
- `jobOf` on v2 reads the interface's `Job` through a v2 declaration
  (`function jobOf(bytes32) view returns ((address buyer, uint64 deadline, uint8 status, address payee,
  uint256 amount, bytes32 offerHash, bytes32 slipHash))`, interface lines 41–50 and 188) and maps it
  onto the same `JobRecord`, with `status` as a number.
- `tollAccruedOf(net)` reads `tollAccrued()` (interface line 200) on v2 and throws `v1 has no accrual`
  on v1. The flows read `DISPUTE_WINDOW()` (implementation line 43) through the small
  `disputeWindowOf(net)` helper rather than hard-coding 600.

### `e2e/lib/actors.ts`

- `startHub` with `arc` adds `ARC_ESCROW_VERSION=2` when switched; `ARC_ESCROW` is still `ARC.escrow`.
  The `/healthz` check against `ARC.escrow` is unchanged.
- `startSkillSeller` adds `--known-escrow 5042002=<ARC.escrow>` to `runner serve` when switched, so the
  seller's funding check accepts the v2 escrow (the runner's `jobOf` read is the unchanged `Job`).
- `pinArcV2(stateDir)` writes `rails.json` as one entry built from the Arc entry of `KNOWN_RAILS`, with
  `escrow: ARC.escrow` and `version: 2`. `buyerCli` calls it before every buyer process when switched;
  that is the one point every buyer state directory passes through before its first call, so the flow
  files the packet marks "no change" stay unchanged. `arcV2Rail()` exposes the same pinned entry to
  `arc-wrong-amount`, which signs through `countersignPayer` without a buyer state directory.

### The report

`RunMeta` gained `escrowVersion` and `escrow`; `run.ts` fills them from `ARC`, and `renderRun` writes a
header row `| escrow | v<1|2> · <address> |`. Nothing else in `run.ts` changed.

## Flows

Each v2 branch is `if (ARC.escrowVersion === 2)`; the v1 path is the same code as before.

- **`arc-spine`.** On v2 the release no longer pays the toll to the treasury: `Released.toll`
  (interface line 59) is accrued by `_pay` into `tollAccrued` (implementation lines 410–415), so the
  flow reads `tollAccruedOf(ARC)` before the buy and checks after the release that it rose by exactly
  `Released.toll`, and that the release transaction has no token transfer to the treasury. v1 keeps the
  old "escrow pays the toll to the treasury" check.
- **`arc-wrong-amount`.** On v2 the fund arguments come from `fundArgsV2`, with `lockSig` `0x` (bond 0);
  the moved job id is `jobIdOf` of the v2 terms, whose `bond` and `reviewWindow` are carried in the
  countersignature (interface lines 25–37 and `fund` at line 116; `jobIdFor` implementation lines
  324–335). The forced `fund` and the call replay use the v2 function, and the expected revert is
  still `CountersignatureMismatch` (interface line 86).
- **`arc-deadline-refund`.** On v2 the early refund expects `SettleWindowOpen` (interface line 101)
  instead of `DeadlineNotReached` (line 90); `refund` reverts while `block.timestamp <= settleBy`
  (implementation lines 266–270), where `settleBy = deadline + DISPUTE_WINDOW` (lines 43 and 447).
  The real refund waits until chain time passes that same `settleBy`, and the near-window guard uses it
  too. On v2 the flow is `onDemand` with
  `on escrow v2 it waits the 600 s settle window; run it with --with arc-deadline-refund` and gets a
  15-minute timeout. The money checks are unchanged.
- **`ratings`.** On v2 the janitor wait is until `deadline + DISPUTE_WINDOW`; the hub's janitor already
  waits `escrow.disputeWindowSeconds` (`apps/hub/src/janitor.ts`). The flow is `onDemand` with
  `on escrow v2 it waits the 600 s settle window; run it with --with ratings` and a 15-minute timeout.
- `slip-onchain-arc`, `public-spine`, `discovery`, `refusals`, `runner-restart` and `arc-gateway` have no
  code change. On v2 they follow `ARC.escrow` and the buyer pin automatically. `public-spine` reads the
  public hub's settlement through `ARC.escrow`, so it expects production to be on the v2 address the
  suite is given; that is the STEER-1950 switch, not a flow change.

## Verifier pin

`packages/verify/src/cli.ts` takes `--rpc` and `--mirror` only; it has no flag for extra escrows. The
packet's second case applies: `verifyCli` is unchanged. On this base `KNOWN_ESCROWS` names only the v1
Arc deployments, so the verifier answers `FAIL escrow unknown escrow …` and `INVALID` for a v2 slip. That
red is expected until orch-cs promotes the v2 address into `KNOWN_ESCROWS`; `arc-spine`'s verifier step
and the flows that verify a v2 slip (`slip-onchain-arc`, `public-spine`) are red for that reason alone.

## Tests

`e2e/test/escrow-v2.test.ts` (offline; no keys, network or chain):

- child `bun -e` with `E2E_ESCROW_VERSION=2` and an address: `ARC.escrow` and `ARC.escrowVersion`
  follow; unset means v1 and the Arc Studio address; version 2 without `E2E_ARC_ESCROW_V2` exits
  non-zero with `E2E_ESCROW_VERSION=2 needs E2E_ARC_ESCROW_V2`;
- `JOB` has `Failed`, `Delivered` and `Disputed` at 4, 5 and 6;
- `escrowEvents` decodes a synthetic v2 `Delivered` log built with `encodeEventTopics` and
  `encodeAbiParameters` from `ESCROW_V2_EXTRA`;
- `pinArcV2` writes a `rails.json` that the buyer's own `State.loadRails()` returns as `KnownRail[]`,
  with `version: 2` and the switched Arc escrow.

`e2e/test/harness.test.ts`'s run-summary case supplies the new meta fields.

## Docs

`docs/e2e.md` gained the "Escrow version" section: the two env vars, toll accrual, the 600 s settle
window, flows 3 and 13 on demand on v2, the buyer pin, the verifier's missing pin, the report row, and
Whitechain staying v1 until wc-09.

## Gate

1. `bun run typecheck` — exit 0:

```
$ tsc -p tsconfig.json
```

2. `bun test e2e/test` — exit 0:

```
bun test v1.3.14 (0d9b296a)

 37 pass
 0 fail
 109 expect() calls
Ran 37 tests across 2 files. [8.42s]
```

3. `bun run e2e -- --list` — exit 0, all 27 flows listed; tail:

```
21  hedera-held              cs-hd    hedera     NOT RUN (on demand: about 0.16 HBAR a run; run it with --flow hedera-held)  Hedera agent 0.05 USDC, Hedera agent 0.17 HBAR
21b hedera-held-undelivered  cs-hd    hedera     NOT RUN (on demand: about 0.16 HBAR and 7 minutes a run; run it with --flow hedera-held-undelivered)  Hedera agent 0.05 USDC, Hedera agent 0.17 HBAR
14a production-console       cs-ui    none
14b production-hub           orch-cs  none
14c production-approvals     cs-ui    none
9   web                      cs-ui    none       NOT RUN (cut: screenshot rounds cover it)
```

`E2E_ESCROW_VERSION=2 E2E_ARC_ESCROW_V2=0x000000000000000000000000000000000000dEaD bun run e2e -- --list`
— exit 0, all 27 flows listed, with 3 and 13 marked on demand:

```
3   arc-deadline-refund      orch-cs  arc        NOT RUN (on demand: on escrow v2 it waits the 600 s settle window; run it with --with arc-deadline-refund)  Arc buyer 0.01 USDC, Arc hub gas wallet 0.01 USDC gas, Arc stranger 0.01 USDC gas
13  ratings                  orch-cs  arc        NOT RUN (on demand: on escrow v2 it waits the 600 s settle window; run it with --with ratings)  Arc buyer 0.02 USDC, Arc e2e seller 0.01 USDC, Arc hub gas wallet 0.03 USDC gas
```

## Commits

- `add the escrow v2 switch to the e2e harness`
- `run the Arc flows against escrow v2 when switched`
- `test and document the escrow v2 switch`

No browser, Playwright, Puppeteer or screenshot tool was launched. No flow was run. No key was printed,
logged or written to an artifact. No file outside `e2e/**`, `docs/e2e.md` and this report was changed.
