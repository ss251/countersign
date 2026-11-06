> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review 662450a (PR 197, cs/hd-20, STEER-2130 A4): the held payee becomes a 2-of-2 of the seller and the hub

Reviewer: cs-w1. Result: **blockers=1 should-fix=1**. This covers 7720d9c..662450a, including hd-20b's script.

## Blocker
**B25: the hub cannot boot from its production image.** Failing test: `apps/hub/test/w1-hub-deps.test.ts` on `cs/w1` (d0904f1). It passes on cs/int and main, and fails on 662450a with exactly `src/rails.ts imports @hiero-ledger/sdk`.
- **The cause.**
  - `apps/hub/src/rails.ts` now imports `PrivateKey` from `@hiero-ledger/sdk`, and `held-hub-key.test.ts` does the same.
  - `apps/hub/package.json` does not declare that package; only `packages/rail` does.
- **Why the gate missed it.**
  - The image runs `bun install --frozen-lockfile --production` on `oven/bun:1.3.14-slim`. For this lockfile, bun 1.3.14 installs the isolated layout, which links each workspace's own declared packages only.
  - I ran that exact install on this head. `node_modules/.bun` is present, there is no `@hiero-ledger` under `apps/hub/node_modules` or the root, and loading `rails.ts` fails with `Cannot find module '@hiero-ledger/sdk'`.
  - `index.ts` imports `rails.ts` at boot (`railsFromEnv`), so the deployed hub would not start at all, for every rail.
  - The second machine gate is green only because it runs the hoisted linker.
  - Under the default install, the hub's `held-hub-key.test.ts` and every test that loads `rails.ts` error out the same way: 144 pass, 2 fail on the Hedera rail tests plus the hub's held-hub-key and rails-switches tests.
- **Fix, either way.**
  - Declare `@hiero-ledger/sdk` in `apps/hub/package.json`, at packages/rail's version.
  - Or, cleaner, keep the SDK out of the hub: let `createHederaHeldRail` take the key string and parse it inside `packages/rail`, so neither the hub nor the lockfile changes.
  - Check it under the default (isolated) install, not only the hoisted one.

## Should-fix
1. **State the new trust plainly, and flip the A4 copy only together with the live rekey.**
   - After `held-rekey.ts`, every transfer out of the payee account needs the hub's signature too. That includes the seller withdrawing its own earnings, not just held releases.
   - The seller can no longer take a held payment alone, but the hub can now hold the seller's balance. `docs/hedera.md` and the held terms (#196's `terms.ts`, #191's landing line) should say both.
   - They should also say how a seller withdraws: a hub co-sign route, or a written procedure.
   - Today's copy ("the seller's key can also release it without delivering") stays true until the production payee is actually re-keyed. Change it in the same step as the rekey and the live `held-seller-alone.ts` proof, not when this merges.

## Held
1. **`verify` (payee_not_hub_gated) keeps `receiver_sig_required`, and adds a check on the payee's mirror key.**
   - The key must decode as a key list of exactly two keys, or a threshold-2 key over exactly two keys.
   - One of the two must be exactly the hub's ED25519 key.
   - Either shape needs the hub's signature, so the seller alone cannot satisfy it. The seller also cannot change the key or `receiver_sig_required` without the hub, because both are account updates under the same 2-of-2.
   - A mirror error refuses the payment.
2. **`release` co-signs only after the existing byte checks** (the schedule is the hold's, and the transaction's payer is the payee). It is still reached only after `checksOut` and the slip check in `call.ts`. The challenge publishes the hub's public key in `extra.hubKey`.
3. **Without `HEDERA_HELD_HUB_KEY`, the held rail stays off** (`startOptional`), and the variable is listed among the config vars.
4. **Keys.**
   - `held-rekey.ts` creates the hub key into `~/.config/countersign/held-hub.env` with mode 0600, signs the account update with both the old and new keys, and prints only the public key.
   - `held-seller-alone.ts` tries both seller-alone paths: a ScheduleSign paid by the payee, and the seller's signature on a ScheduleSign paid by another account. It reports `ok` only if the first fails and the schedule never executes.
   - No private key is printed or passed in argv.
5. **Test edits are fixtures plus the two declared expectation changes.**
   - The fixtures change in three places: the payee account gets `key: hubGatedPayeeKey()`, the rail gets the `hubKey` option, and the challenge expectation adds `extra.hubKey`.
   - The one renamed expectation is `payee_does_not_hold` → `payee_not_hub_gated`.
   - My `w1-held.test.ts` changes in fixtures only, with every assertion unchanged, and it passes.

## Notes
1. **Rollout order.**
   1. Put the key from `held-hub.env` on Railway with `railway variable set HEDERA_HELD_HUB_KEY --stdin`, never in argv.
   2. Re-key the production payee with that same key.
   3. Deploy, then run the live proof, then flip the copy.
   - A hub with this code and an un-rekeyed payee refuses every held payment (`payee_not_hub_gated`), which is safe but means the held rail is down.
2. **The buyer agent does not check `extra.hubKey` against the payee's key before it creates a schedule.** If the hub refuses, the schedule simply expires and nothing moves. A buyer-side check would refuse earlier.
