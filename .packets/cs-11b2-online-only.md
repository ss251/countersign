# cs-11b2-online-only — an offer that matches no query word is not a search hit (refs #55)

## Setup

Run `bun install` at the worktree root before anything else. This follows `.packets/cs-11b-search-reasons.md`, already done on this branch.

## The defect

In `apps/hub/src/frontdoor.ts`, `scoreOffer` adds 1 for an online seller even when no query token matched any field. `searchOffers` keeps every offer with a score above 0, so every online offer is returned for every query, and its only reason is `seller is online`.

## Lease

- `apps/hub/src/frontdoor.ts`: `searchOffers` and `scoreOffer` only
- `apps/hub/test/frontdoor.test.ts`
- `.packets/reports/cs-11b-search-reasons.md`: append a section, and do not rewrite the earlier sections

## What to change

1. An offer is a hit only when at least one query token matched one of its fields.
2. The online bonus (+1, and `seller is online` as the last reason) applies only to offers that are already hits.
3. Nothing else changes.

## Tests

- Call `searchOffers` directly with a fake `FrontdoorDeps` whose `isOnline` returns true. The fake already exists in the test file around the `online: false` usage; reuse that pattern.
  - An online offer that matches no token is not returned.
  - An online offer that matches has the score of its matches plus 1, and `seller is online` is its last reason.

## Constraints

- **Never launch a browser of any kind on this machine**: no Chrome or Chromium, headless or not, no Playwright, Puppeteer or screenshot tools.
- No view code. No network in tests. TypeScript strict, no `any`.

## Acceptance

From the worktree root:

```
bun install && bun run typecheck && bun test apps/hub && bun test && forge test
```

Every command passes.

## Finish

Commit with a small present-tense message ending `(refs #55)`, and no trailers. Append to the report. Do not push, merge or deploy.
