# wc-10m: bring cs/int into the wc-10 branch before its PR

Issue: #14. **Design: decided.** cs-wc wrote it on Opus. Follow it exactly. If something here cannot work, stop and report.

**Base:** `cs/wc-10b` as wc-10d leaves it. You run in the same worktree.

## What to do

1. **Merge.** `git fetch origin && git merge --no-ff origin/cs/int`. A dry run shows two conflicts, and everything else merges cleanly:
   - **`package.json`:** both sides added to the root `devDependencies`. cs/int added `@hiero-ledger/sdk` (orch-cs's `d0bcc1c`), and this branch added `@countersign/relay`, `hono` and `viem` (wc-10c). Keep every entry from both sides, in alphabetical order, and change nothing else in the file.
   - **`bun.lock`:** take cs/int's version (`git checkout --theirs bun.lock`), then run `bun install --linker hoisted` so the lock gains this branch's workspace lines again.
2. **Check the lock.**
   - Compare it with cs/int's: `git diff origin/cs/int -- bun.lock`. It may differ only in workspace dependency lines for the root and `apps/web` (`@countersign/relay`, `hono`, `viem`).
   - No new external package may appear.
   - Paste that diff into the report.
3. **Commit the merge** with the message `merge cs/int into cs/wc-10b before the PR, refs #14`.

## Acceptance

1. **The isolated check, in a second worktree** (never in your main one):

   ```
   git worktree add --detach ../wc-10m-iso HEAD
   cd ../wc-10m-iso
   bun install --frozen-lockfile && bun run typecheck && bun test apps/web/test packages/relay/test examples/whitechain
   cd - && git worktree remove --force ../wc-10m-iso
   ```

   - All green.
   - If an install fails with a cache error, run it once more.
2. **The usual gate, in your main worktree:**

   ```
   bun install --linker hoisted && bun run typecheck && bun test && forge test && bun run --cwd apps/web build
   ```

   All green.

## Lease

- The merge itself.
- `package.json`: the `devDependencies` conflict only.
- `bun.lock`.

Resolve no other file by hand. If any other file conflicts, stop and report.

## Constraints

- **No browser** of any kind on this machine.
- **Never run `git stash`.** Use a temporary commit or a second worktree.
- **Never rebase,** and never rewrite a pushed commit.
- **Commits:** small, present tense, ending `refs #14`, with no emoji and no `Co-authored-by`.

## Stop conditions

Stop if any of these happens:
- another file conflicts;
- a failure survives three different fixes;
- 20 minutes have passed.

## Report

Write `.packets/reports/wc-10m-merge-int.md` in your worktree and commit it, with the lock diff and both acceptance results.
