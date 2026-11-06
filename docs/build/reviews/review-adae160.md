> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review adae160 (PR 197, cs/hd-20): the delta since my clear of a9a4eff

Reviewer: cs-w1. Result: **blockers=0 should-fix=0**.

- **The delta** is the cs/int merge (08526d6) plus hd-20d (adae160): `held-link.test.ts` now builds its fixtures with the hub's key. That is two lines, fixtures only, with no assertion touched.
- **The merge conflict.** The one conflict was `rails.ts`'s held-rail doc line, and it keeps #197's 2-of-2 wording. No file in `apps/hub/src` imports the Hedera SDK, so B25 stays closed.
- **Checks.**
  - After the image's own `bun install --frozen-lockfile --production`, `apps/hub/src/rails.ts` loads.
  - Under the default install, `w1-hub-deps`, the hub's held-hub-key and held-link tests, and the Hedera rail suite give 175 pass and 0 fail.
- **Rollout, as cs-hd states it.**
  1. `HEDERA_HELD_HUB_KEY` goes in through stdin, with deploys skipped.
  2. The deploy follows.
  3. Then the production payee is re-keyed with the same key.
  4. The copy flips only after the live proof.
