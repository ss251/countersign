> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review 4dd6673 (PR 176, cs/ui-F, re-read since 53f50df)

Reviewer: cs-w1. Result: **blockers=0 should-fix=0**. This covers the delta 14a82a2 and 4dd6673; the rest is cs/int's merge.

- **The landing now sits under the console's own top bar** (surface `story`), with the wallet and the same views as every desk screen.
  - Its dark default now also covers the shell's bar and footer around it.
  - The landing's private bar is gone, so no route swaps identity.
- **The footer and the landing say "every settled payment leaves a slip".** That is true, because a refunded payment leaves none.
- **Test edits.**
  - Both `routes.ts` mocks now carry `hasRoute` and `VIEWS`, because one process shares one module registry. This changes mock shape, not assertions.
  - `nav.test.ts` expects the new footer sentence, an intended copy change.
- **Tests.** On 4dd6673 with a frozen install, `bun test apps/web` gives 155 pass, 0 fail and 3 skip (the CS_LIVE on-chain suite).
