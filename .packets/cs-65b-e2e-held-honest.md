# cs-65b-e2e-held-honest: the held flows assert that plain x402 Hedera is gone

Lane: cs-e2e. Base: `cs/e2e`. Branch: `cs/cs-65b`. This is the companion to cs-65, written for the
captain's 23:40 IST flag: with `HEDERA_RAIL` off, production's 402 for a Hedera offer carries only the
held accept. cs-hd keeps the Agent Kit offer as declared, so its signed rails still name `hedera`.

## Change `e2e/flows/hedera-held.flow.ts`, in `heldListing`

1. Step "the public hub lists the Agent Kit offer with the held rail first": remove the line
   `check(l.offer.rails.includes("hedera"), "the held offer keeps the exact Hedera rail beside it");`.
   Every other check in the step stays.
2. Step "the 402 offers the held payment beside the exact one": rename it
   "the 402 offers the held payment and no plain x402 Hedera". Keep every check on the held accept.
   Replace the exact-accept lines (`const exact = hederaExact(required); check(exact, ...); equal(exact.payTo, ...)`)
   with:
   `check(!hederaExact(required), "the 402 still offers plain x402 Hedera, which production removed by flag (captain, 23:40 IST)")`.

Nothing else changes. Both held flows share `heldListing`, so both get it.

## Docs

In `docs/e2e.md`, section "21, 21b · hedera-held", item 3, the exact accept sentence becomes: "The 402 offers no
plain x402 Hedera accept: production removed that rail by flag."

## Gate

1. `bun install --linker hoisted && bun run typecheck` clean.
2. `bun test e2e/test` and `bun test e2e/human/test` all pass.
3. `bun run e2e -- --list` lists every flow.

## Constraints

- No browser of any kind on this machine. Do not run any flow (`--list` only).
- **Never run `git stash`;** use a temporary commit or a second worktree.
- Touch only `e2e/flows/hedera-held.flow.ts` and `docs/e2e.md`. Never read or print a key.
- Never push, merge or deploy. One or two small present-tense commits on `cs/cs-65b`, with no emoji, no
  Co-authored-by and no trailers.
- If something cannot be done as written, stop and say exactly what and why.

## Report

`.packets/reports/cs-65b-e2e-held-honest.md`: the change with line ranges, and the gate outputs.
