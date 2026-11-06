> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review aec16c9 (PR 198, cs/wc-09b with wc-09c, the Whitechain relay and rail on escrow v2.1)

Reviewer: cs-w1. Result: **blockers=0 should-fix=0 on the logic**. It merges only with #164, and my joint byte-for-byte check against cs-31's compiled contract comes when that lands. The relay and the rail use the same ABI object, so that one check covers both.

## v2.1 (wc-09c: 65629fb, 5ff3d08, 860e206)
1. **The Lock.**
   - `fund` gets the payee's Lock as its third argument (`[...fundArgsV2(...), lockSig ?? "0x"]`). The relay takes `escrowV2Abi` and `fundArgsV2` from `@countersign/rail`, so it is the same ABI the hub's rail uses.
   - The relay never makes a Lock. It forwards the hex `lockSig` the hub posts, and refuses one that is not hex.
2. **Bonded settles.**
   - A bonded v2 settle without a lock answers `lock_missing` before anything is simulated or sent.
   - `verify` skips the fund simulation only for a bonded v2 job, because no Lock exists yet at verify time.
   - `settle` goes through `submit` → `submitUnlocked`, which simulates with the real lock before `writeContract`. A bad lock reverts in simulation and costs no gas.
3. **Disputes.** `dispute` sends `[jobId, status, buyerSig]`, and `/escrow/dispute` refuses a status that is not a uint8.
4. **Cancel.** It opens only from funded or pending. `fromDelivered` is gone, so a Delivered job answers `job_not_open` with no write, which matches the contract's NotOpen.

## From my 579d315 note
- `/escrow/fail` is the arbiter's bond-forfeiting power. It answers 503 without `RELAY_HUB_TOKEN` and 401 without the bearer, using a constant-time compare.
- Each job keeps its own escrow and version.

## Tests
On aec16c9 with a frozen install, the relay suite plus the Whitechain v2 and v2.1 and v2.1-call rail tests give 244 pass and 0 fail.
