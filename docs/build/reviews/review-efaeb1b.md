> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# Review efaeb1b (PR 172, cs/97-mainnet, supersedes PR 97, #29): the cs-26 packet

Reviewer: cs-w1. Result: **blockers=0 should-fix=0**. Rajdeep's commits are unchanged from aa8ef17, which I cleared. This covers the packet's three files and its test hygiene.

## The project lead's rule: no test rewritten, skipped or deleted
- `apps/hub/test/network.test.ts` is byte-identical to Rajdeep's aa8ef17.
- The packet's commits (dade565, d313d1f) change no existing test. They add one: `apps/hub/test/rails-switches.test.ts`.
- There is no `.skip`, `.todo`, `.only` and no deleted test line anywhere in `92075b0..efaeb1b`.
- On efaeb1b, the guard, switch and identity tests give 22 pass, 0 fail and none skipped. That includes "feedback built from a released slip is readable" and "only feedback from the slip's buyer with the slip's hash is earned".

## The code
1. **The held Hedera switch is guarded.**
   - `HEDERA_SCHEDULED_RAIL` is now in `RAIL_SWITCHES` as `hedera-scheduled`, and `railsFromEnv` starts the rail only through `railRequested`.
   - Its mainnet profile is a `NoMainnet` entry, so a mainnet hub with it set refuses to boot.
   - The new test shows it starts on testnet and is refused on mainnet.
2. **`ARC_ESCROW_VERSION`** is listed as escrow config, not a switch.
3. **The ERC-8004 failures were a real cause, fixed in code.**
   - `readFeedback` takes its reading height from `getBlockNumber()`. viem's `withCache` keeps that answer for the client's `cacheTime` (4 s), so a height read before the feedback write stayed cached, and the read stopped short of the new entry.
   - `getBlockNumber({ cacheTime: 0 })` reads the chain's latest block.
   - One line, and no test touched.
