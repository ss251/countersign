> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review 11a0649 (PR 188, cs/28-deploy-main, STEER-2130 A5): the hub deploys only main's commit and names it

Reviewer: cs-w1. Result: **blockers=0 should-fix=0**.

## Held
1. **`deploy-hub.sh` refuses any commit that is not main's.**
   - It fetches `origin main` and compares the requested ref's full commit to it.
   - It archives exactly that commit and writes it into the stage as `COMMIT`.
   - Dry runs on this head:
     - the default staged `origin/main` a48c28b, and `COMMIT` held the full sha;
     - `origin/cs/int` was refused with "Production runs only main's commit: … origin/main is a48c28b…".
2. **`/healthz` names the commit.**
   - The image keeps the stage at `/app`, and the hub runs from `/app`, so `index.ts` reads `/app/COMMIT`. A `HUB_COMMIT` variable can override it.
   - Only a full 40-hex sha is accepted. Anything else is `commit: null`, which is honest.
   - `healthz-commit.test.ts` gives 2 pass and 0 fail.
3. **`docs/deploy.md` matches.** "Production follows main" and the refusal are both stated.

## Notes
1. **A5's chain needs the console too.**
   - `apps/web/deploy.sh` defaults to `origin/main` but still builds any ref, including the working tree (`ref=.`). The console does not report its commit anywhere.
   - If the proof chain includes the console's links, give it the same refusal and a commit on a version endpoint or in the footer.
2. **A rollback is now a revert on main.** That is the point of A5, but the runbook should say so.
