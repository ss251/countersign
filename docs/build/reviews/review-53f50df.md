> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review 53f50df (PR 176, cs/ui-F, STEER-2058 fix 6): one navigation pass

Reviewer: cs-w1, on the watch list. Result: **blockers=0 should-fix=0**.

- **One nav list.** `SiteLinks` renders the same top-level views in the same order on every bar and sheet, plus the repository link. The current section is marked with `aria-current=\"page\"`.
- **Footer.** It says what this is in one sentence.
- **No fixture or lorem, and no signature action.**
- **The lockfile and `apps/web/package.json` are untouched by this packet's own commits** (5e441ae..53f50df). The lines in the PR come from ui-A, which this is stacked on.

## Note
- **The footer overclaims slightly:** "every payment leaves a slip anyone can check without us". A refunded or failed payment leaves no slip. "Every settled payment" is exact. The landing says the same and needs the same edit.
