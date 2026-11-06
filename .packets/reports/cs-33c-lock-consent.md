# cs-33c-lock-consent

The runner signs `Lock(jobId, funder)` only for a job it rebuilds from the buyer's countersigned terms. A bond above zero needs `offer.deadline` of at least 60 seconds, the same floor `setTerms` uses for `minDuration`.

## Diff summary

The hub-to-runner `lock` frame gains `terms: LockTerms`: `buyer`, `payee`, `amount`, `deadline`, `salt`, `bond`, `reviewWindow`. With the frame's `offerHash`, those are the fields `jobIdOf` hashes.

On a bonded call the hub copies those fields from the same `payment.payload.terms` it verified. `bond` and `reviewWindow` default to `"0"` and `0`. `runners.lock` puts the object on the frame as `terms`.

The runner still refuses a malformed funder with `bad-funder`, an offer it does not serve, and a bond that is not the served offer's. Before it signs, it then refuses with `lock-refused` and one of:

| Check | Reason |
|---|---|
| `frame.terms` missing or not the countersign shape | `bad-terms` |
| `terms.payee` is not this runner's address | `not-payee` |
| `terms.amount` is not the offer's price, `terms.bond` is not the offer's bond or is not above 0, or `terms.reviewWindow` is not `offer.reviewWindow ?? 0` | `terms-mismatch` |
| `terms.deadline - now < 60`, on the daemon's clock | `deadline-too-near` |
| `(chainId, escrow)` is not in the daemon's funding pins, including when the daemon has no funding config | `unknown-escrow` |
| `jobIdOf({ offerHash, ...terms }, chainId, escrow)` is not `frame.jobId` | `job-mismatch` |

Payee, escrow, and job id compare case-insensitively. Only then does it sign `lockTypedData(frame.chainId, frame.escrow, frame.jobId, frame.funder)`.

`assertOffer` rejects a bond above zero whose `deadline` is under 60, with `offer.bond above zero needs offer.deadline of at least 60 seconds: setTerms refuses a bonded minDuration under 60`. The existing review-window message still fires first.

## Every changed test line

`packages/runner/test/w1-lock-consent.test.ts` is new and unedited. `cmp` against `~/Developer/countersign-mac/briefs/w1-lock-consent.test.ts` matched. Both cases expect `lock-refused`.

`packages/runner/test/lock-consent.test.ts` is new. It pins the escrow through `funding.known` except in the two `unknown-escrow` cases.

- positive: terms hash with `jobIdOf` to `jobId`, deadline `NOW + 120`, reply `locked`, `recoverTypedDataAddress(lockTypedData(..., FUNDER))` is the seller
- deadline `NOW + 60` and a lowercased payee with an upper-hex job id also lock, and the signature recovers over `lockTypedData(..., FUNDER)`
- missing `terms` → `bad-terms`
- `payee` `0x1111…1111` → `not-payee`
- `amount` `"999"`, `bond` `"99"`, and `reviewWindow` `60` → `terms-mismatch`
- deadline `NOW + 59` → `deadline-too-near`
- no `funding` config → `unknown-escrow`
- pins a different escrow → `unknown-escrow`
- job id `0xab…ab` → `job-mismatch`

`packages/core/test/bond-window.test.ts`

- `const DEADLINE_MESSAGE = "offer.bond above zero needs offer.deadline of at least 60 seconds: setTerms refuses a bonded minDuration under 60";`
- `function offer(over: { bond?: string; reviewWindow?: number; deadline?: number } = {})`
- `deadline: over.deadline ?? 60`
- added `test("bond 1 with deadline 59 throws the duration floor")`: `assertOffer(offer({ reviewWindow: 60, deadline: 59 }))` throws `new OfferError(DEADLINE_MESSAGE)`
- added `test("bond 1 with deadline 60 passes the duration floor")`: `assertOffer(offer({ reviewWindow: 60, deadline: 60 }))` does not throw

`apps/hub/test/lock.test.ts`

- `const BUYER = "0x7777777777777777777777777777777777777777" as Address;`
- `const SALT = "42";`
- `termsPayment` terms become `{ buyer: BUYER, payee: seller.address, amount: "1000", deadline: NOW + 60, salt: SALT, bond: "0", reviewWindow: 0, ...terms }`
- the bonded lock frame expectation gains `terms: { buyer: BUYER, payee: seller.address, amount: "1000", deadline: NOW + 60, salt: SALT, bond: "100", reviewWindow: 300 }`

`packages/runner/test/lock.test.ts`

- `import { jobIdOf, ... }`
- `startRunner` gains `funding: { known: [{ chainId: CHAIN_ID, escrow: ESCROW }] }`
- `consentTerms()` returns `{ buyer: FUNDER, payee: seller.address, amount: bonded.price, deadline: NOW + 120, salt: "1", bond: bonded.bond, reviewWindow: bonded.reviewWindow ?? 0 }`
- `sendLock` default frame gains `terms: consentTerms()`
- the two signing tests compute `jobId = jobIdOf({ offerHash: bondedHash, ...terms }, CHAIN_ID, ESCROW)` and pass `{ terms, jobId }` (the funder test also passes `funder`)
- `expect(reply.jobId).toBe(jobId)`
- `verifyTypedData` / `recoverTypedDataAddress` spread `lockTypedData(CHAIN_ID, ESCROW, jobId, funder)`

No other test line changed. The refusal reasons in `packages/runner/test/lock.test.ts` are unchanged.

## Counts

From the worktree root, after `bun install --linker hoisted`:

- `bun run typecheck` — exit 0.
- `bun test` — 1459 pass, 5 skip, 0 fail. 5883 expect() calls. 1464 tests across 196 files. The five skips are the live Whitechain checkout, the three Arc fifth-check tests, and the STEER-2225 bundle scan. An earlier full run failed one unrelated case, `sellers > erc8004 is null when no lookup is injected`, with `publish failed with 401`. That file passes alone (22 pass) and the full suite passed on the rerun. Publish 401 is the existing bad-signature response. It is not this change.
- `forge test` — 5 suites, 47 passed, 0 failed, 0 skipped.

Isolated check, second worktree of `13a8a13`, `bun install --frozen-lockfile && bun run typecheck`: exit 0.

Implementation commits on `cs/33-runner-hub-lock`: `2090245` require a bonded offer deadline of at least 60 (refs #98); `13a8a13` refuse a lock the runner cannot rebuild (refs #98). This report is the commit after those two. Not pushed.
