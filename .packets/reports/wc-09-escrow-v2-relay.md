# wc-09: the Whitechain relay and rail speak escrow v2

## What changed

### The rail (`packages/rail`)

- `WhitechainRailOptions` gained `version?: 1 | 2` (default 1) and `relayToken?: string`.
- Version 1 still defaults `escrow` to `WHITECHAIN_ESCROW` and builds exactly the four-method
  escrow object it built before (`release`, `cancel`, `refund`, `status`).
- Version 2 requires `escrow`; without one it throws
  `whitechain escrow v2 needs its escrow address`. It passes `version: 2` to the base
  `escrowRail`, so the 402 challenge, `status`, `reviewOf`, `tollBps` and
  `disputeWindowSeconds` (600) are v2.
- The v2 escrow object adds `accept`, `dispute` and `releaseAfterWindow`, posting to
  `/escrow/accept`, `/escrow/dispute` and `/escrow/release-after-window`. `failDelivery`
  posts to `/escrow/fail` with `authorization: Bearer <relayToken>` and exists only when
  `relayToken` is set.
- `escrowV2Abi` is exported from `packages/rail/src/index.ts`; `fundArgsV2` was already
  exported through `packages/rail/src/escrow/index.ts`.

### The hub (`apps/hub/src/rails.ts`)

- The whitechain line now reads `WC_ESCROW_VERSION`, `WC_ESCROW_V2` and `WC_RELAY_TOKEN`.
- With `WC_ESCROW_VERSION=2` and a valid `WC_ESCROW_V2`, the rail starts on that escrow with
  the relay token when present.
- With `WC_ESCROW_VERSION=2` and no valid `WC_ESCROW_V2`, the rail stays off and logs exactly
  `[hub] rail whitechain is off: WC_ESCROW_VERSION=2 needs WC_ESCROW_V2`. It does not fall
  back to v1.
- `WC_ESCROW_VERSION`, `WC_ESCROW_V2` and `WC_RELAY_TOKEN` were added to
  `RAIL_CONFIG_VARS`, so the existing guard test sees every variable the file reads.

### The relay (`packages/relay`)

- `loadRelayConfig` builds `allowedEscrows` as v1 (`RELAY_ESCROW` or `WHITECHAIN_ESCROW`)
  plus v2 when `WC_ESCROW_V2` is a valid address; an invalid value throws. It also reads the
  optional `RELAY_HUB_TOKEN`, refusing values shorter than 24 characters.
- `Relayer` gained `escrowVersion(address)`, the v2-only call kinds (`escrowAccept`,
  `escrowDispute`, `escrowReleaseAfterWindow`, `escrowFailDelivery`), and `escrowFund.version`.
  Version 2 funds with `escrowV2Abi` + `fundArgsV2`; version 1 is unchanged.
- `settleCountersign` verifies and funds on the escrow named by the requirements, using a
  v2 rail only when that address is the configured v2 escrow. It records `jobs.escrow` and,
  on v2, reads `bondOfJob` after a confirmed fund.
- `escrow-ops` uses each job's own escrow for release, cancel and refund. It exposes
  `acceptJob`, `disputeJob`, `releaseAfterWindowJob` and `failDeliveryJob`; all four answer
  `job_not_found` when the ledger lacks the job and `not_supported_on_v1` when it knows the
  job is on the v1 escrow. `cancel` now also closes a `delivered` job.
- A confirmed v2 release reads `reviewOf`: `endsAt > 0` records `delivered` with
  `delivered_at`, `review_ends_at` (ms) and `review_window` (seconds) and leaves the job open;
  otherwise it records `released`.
- `server.ts` adds the four routes. `/escrow/fail` checks `RELAY_HUB_TOKEN` first (503 when
  unset, 401 on a missing or wrong token) before parsing the body or calling the relayer.
  `not_supported_on_v1` maps to 409; every other refusal maps to 422. `/status` keeps v1 as
  `escrow` and adds `escrowV2`.
- `ledger.ts` adds the `jobs` columns with `ALTER TABLE` only when missing, the new statuses,
  `deliverJob`, and the order mapping: `delivered` becomes `in_review`, accept releases carry
  `acceptedAt`/`acceptTx`, window releases carry `releasedAfterWindow`, disputes and failed
  deliveries are `refunded` with `dispute_refund`/`delivery_failed`, and `bondSlashed` is the
  seller's bond when it was forfeited. The orders CSV still has its 14 columns.

## Tests and what they prove

- `packages/relay/test/wc-09-v2.test.ts`
  - v2 settle writes `fund` on the v2 escrow with the v2 struct (bond and review window) and
    records the escrow and `bondOfJob`.
  - v1 settle still writes `fund` on v1 with the v1 tuple.
  - `/escrow/accept`, `/escrow/dispute` and `/escrow/release-after-window` succeed; unknown
    jobs are 404, v1 jobs are 409, malformed bodies are 400, and a simulation revert is 422
    with no write.
  - `/escrow/fail` is 503 without a token; a missing header, a same-length wrong token, a
    different-length wrong token and the wrong scheme are 401 with no relayer call; the right
    token submits `failDelivery`.
  - Window 0 releases; a window delivers (with ms/seconds recorded); accept, window release,
    dispute and cancel each move a delivered job to the right status and `close_via`; fail and
    refund move a funded job to `failed`/`refunded`.
  - Orders map to `in_review`, paid-with-`acceptedAt`/`acceptTx`, paid-with
    `releasedAfterWindow`, `dispute_refund`, `delivery_failed`, and carry `bondSlashed` only
    when the bond was lost. The CSV header is still 14 columns.
  - A v2 job's release/cancel/refund go to v2 while a v1 job's go to v1 with both allowed.
  - With no v2 configured only v1 is allowed.
  - A bonded v2 settle is submitted by the relay account (the arbiter).
  - `/status` keeps v1 first and names `escrowV2`.
- `packages/relay/test/config-v2.test.ts`: the allowlist has v1+v2; a bad `WC_ESCROW_V2`
  throws; `RELAY_HUB_TOKEN` is optional but 23 characters throws and 24 is accepted.
- `packages/rail/test/whitechain-v2.test.ts`: the v2 rail requires its escrow, names it in
  the 402 with bond/window/version, calls the right relay routes and bodies, sends the bearer
  token only when configured, exposes `reviewOf`/`tollBps`/600 seconds, and the v1 rail still
  has none of the v2 methods.
- `apps/hub/test/whitechain-v2.test.ts`: the hub starts the whitechain rail on the v2 escrow,
  and a v2 request without a valid `WC_ESCROW_V2` leaves it off with the exact log line.
- All existing rail, relay and hub tests pass unedited.

## Deviation from the packet

- The guard's config list on this base is `RAIL_CONFIG_VARS` in `apps/hub/src/rails.ts`, not a
  table in `apps/hub/src/network.ts`. The three names were added there; `network.ts` is
  untouched. The existing guard test passes without edits.
- The hub fallback test lives in a new `apps/hub/test/whitechain-v2.test.ts`. The packet asks
  for that proof but did not list hub tests in the lease; no hub source outside the whitechain
  line changed.
- `bun run typecheck` on this machine reports 15 errors in files outside this packet's lease
  (`packages/rail/src/hedera/*`, `packages/buyer/*`, `apps/hub/src/buyerplumbing.ts`,
  `packages/relay/src/merchant-server.ts`, `packages/relay/src/paywall.ts`,
  `scripts/hedera/agent-run.ts`). They come from `bun-types` resolving `@types/node@26.6.6`,
  whose `Buffer` no longer matches `timingSafeEqual`'s parameter type. A stashed baseline run
  shows the same errors without this packet. No changed file in this packet reports a type
  error.
- `bun test` (1174 pass, 3 skip) and `forge test` (47 pass) are green.
