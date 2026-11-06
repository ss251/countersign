> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# Review 92be6ec (PR 121, cs/phone-02): the phone checks the job is paid before it works

Reviewer: cs-w1, money path only: `apps/phone/src/runner/funding.ts` and its call site. Result: **blockers=0 should-fix=0**. The `apps/phone` tests give 29 pass and 0 fail. This closes the should-fix on #104 for the phone.

## Held
- **Order:** `checkOrder` is a required part of the link config. It runs before the job starts, so nothing is read, captured, served or signed first, and a throw is a refusal (`REFUSED.unchecked`).
- **The order against the offer, as a first gate:** the rail must be in the offer's rails, the amount must equal the price, and the payee must be `offer.payTo[rail] ?? seller`. On escrow, the network, chain id and asset must be Arc testnet USDC.
- **The chain read, which is what closes it:**
  - The escrow must be pinned in `KNOWN_ESCROWS` for that chain id, so a hub cannot name its own contract.
  - `jobOf(jobId)` over the public RPC must show the job Funded, the payee as this seller, at least the price, the order's offer hash, and a deadline still ahead.
  - Only "not seen yet" is retried; Released and Refunded are final.
- **Coverage:** the phone's offers list only `escrow`, so no order skips the chain read.

## Notes
- **The `jobOf` ABI is hand-written and needs updating when #98 lands.** If #98 changes the `Job` struct or adds states, update it, or import the escrow ABI from `packages/rail`. A decoding mismatch would refuse every job, which fails safe but stops the phone earning.
- **Add the v2 escrow after the redeploy.** Put its address in `KNOWN_ESCROWS`, keeping the v1 address beside it.
- **Same fix for `packages/runner`.** The desktop runner still signs for whatever the order says; that is orch-cs's code.
