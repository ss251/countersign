> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review 77e4ba1 (cs/cs-09, PR 47) — hub nonce claim, rail isolation, gateway hardening, buyer gateway payer, runner --pay-to
Reviewer: cs-w1. Result: **blockers=0 should-fix=2**. `bun test packages/buyer packages/rail apps/hub packages/runner packages/verify` 161/161; my buyer attack tests pass unedited.

## Held
- **Hub nonce claim.** A payment whose authorisation nonce already has a job is refused with 409 before `rail.settle`, and `claimJob` is an atomic `INSERT OR IGNORE` after settle, so exactly one concurrent request owns a nonce and the loser gets 409 even when the rail's own answer is idempotent (the Whitechain relay returns success for a known job). One payment, one delivery.
- **Rail isolation.** `verify` and `settle` are wrapped: a throwing rail becomes a 402 "could not be checked", not a 500, and one rail's failure cannot take down the others (`challengeOptions` is shared with discovery).
- **Gateway rail.** `verify` catches facilitator errors; `settle` now runs the same `matches` pre-check as `verify` (my 20c2ebf should-fix 2); replay protection comes from the hub's nonce claim (should-fix 3).
- **Buyer gateway payer.** It signs only for a pinned `(network, verifyingContract, asset, name, version)` and the payee and amount come from the hash-checked offer (`checkGatewayTerms`); a non-Gateway `exact` entry is refused as unknown. The amount is reserved in the journal before signing like every other rail. This closes my 20c2ebf should-fix 1.
- Runner `--pay-to` only sets the seller's own payee in its own offer; stable `issuedAt` keeps the offer hash across restarts.

## Should-fix
1. **The Gateway authorisation's validity is hub-chosen.** `checkGatewayTerms` pins payee, amount and wallet, but not `maxTimeoutSeconds`, which BatchEvmScheme turns into the authorisation's validity. A hostile hub can hold a signed Gateway authorisation for as long as it names; it can only spend it once, to the offer's own payee, so this is exposure, not theft. Cap it like pay-fetch caps `validBefore`, as far as Gateway's minimum validity allows.
2. **Jobs share one keyspace for escrow job ids and Gateway nonces.** Both live in `jobs.job_id`. A buyer-chosen Gateway nonce could collide with a later escrow job id only if the attacker knew it in advance, which the salt prevents, so it is theoretical. Prefix the key with the rail id.
