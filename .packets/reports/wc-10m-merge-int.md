# wc-10m — merge cs/int before the PR

Issue: #14.

## Merge

`git fetch origin && git merge --no-ff origin/cs/int`, committed as
`e99b2283d861619ab6b665c5df2333c2775dc77e` with the message
`merge cs/int into cs/wc-10b before the PR, refs #14`.

Only the two expected files conflicted:

- `package.json`: kept every root `devDependencies` entry from both sides, in
  alphabetical order. Nothing else in the file changed.
- `bun.lock`: started from cs/int's version, then added this branch's workspace
  dependency lines for the root and `apps/web`.

No other file conflicted. No other file was resolved by hand.

## Lock diff vs `origin/cs/int`

`git diff origin/cs/int -- bun.lock`:

```diff
diff --git a/bun.lock b/bun.lock
index 8bcc6d1..b2a8ae8 100644
--- a/bun.lock
+++ b/bun.lock
@@ -5,11 +5,14 @@
     "": {
       "name": "countersign",
       "devDependencies": {
+        "@countersign/relay": "workspace:*",
         "@hiero-ledger/sdk": "2.90.1",
         "@openzeppelin/contracts": "5.6.1",
         "@types/bun": "1.3.x",
         "forge-std": "github:foundry-rs/forge-std#v1.17.0",
+        "hono": "^4.13.16",
         "typescript": "5.9.3",
+        "viem": "^2.57.16",
       },
     },
     "apps/hub": {
@@ -47,10 +50,12 @@
       "dependencies": {
         "@countersign/core": "workspace:*",
         "@countersign/rail": "workspace:*",
+        "@countersign/relay": "workspace:*",
         "@countersign/verify": "workspace:*",
         "@privy-io/react-auth": "3.6.1",
         "@privy-io/wagmi": "^4.0.20",
         "@tanstack/react-query": "^5",
+        "hono": "^4.13.16",
         "react": "^19.3.1",
         "react-dom": "^19.3.1",
         "viem": "^2.57.16",
```

The diff contains only root and `apps/web` workspace dependency lines. No new
external package appears. `viem` was already in `apps/web`'s cs/int lock, so it
only appears as new at the root.

Note on producing that lock: `git checkout --theirs bun.lock` followed by
`bun install --linker hoisted` with the workspace lines missing made bun also
re-hoist the existing `@solana/errors` entry (5.5.1 to 8.6.0), which is outside
the allowed diff. Restoring cs/int's lock and adding only the six workspace
lines above produced a stable lock: a following
`bun install --linker hoisted` reported `Checked 1029 installs across 772
packages (no changes)` and left the diff exactly as shown.

## Acceptance 1 — isolated worktree

The first run was created at `../wc-10m-iso` exactly as specified.
`bun install --frozen-lockfile` succeeded (1483 packages), but `bun run
typecheck` failed on `Buffer` assignability because TypeScript resolved
`~/node_modules/@types/node@20.14.2` from an unrelated
`node_modules` in the home directory. That directory is outside the project and
was not touched.

The identical install/typecheck/test sequence was rerun in a second worktree at
`/private/var/folders/p4/8cqx396x7yl142gkb4sqv5800000gn/T/opencode/wc-10m-iso`,
whose parents contain no stray `node_modules`. The second worktree was removed
with `git worktree remove --force` after the run.

```
bun install --frozen-lockfile
bun run typecheck
bun test apps/web/test packages/relay/test examples/whitechain
```

All green:

- install: 1483 packages installed
- typecheck: clean
- tests: `441 pass`, `5 skip`, `0 fail`, 2393 `expect()` calls, 446 tests across 52 files

## Acceptance 2 — main worktree gate

```
bun install --linker hoisted
bun run typecheck
bun test
forge test
bun run --cwd apps/web build
```

All green:

- install: `Checked 1029 installs across 772 packages (no changes)`
- typecheck: clean
- `bun test`: `1417 pass`, `4 skip`, `0 fail`, 5774 `expect()` calls, 1421 tests across 187 files
- `forge test`: 47 passed, 0 failed, 0 skipped (5 suites)
- web build: `✓ built in 1.33s`
