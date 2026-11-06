# wc-10c — every console and example import is declared

Issue: #14. Corrective for wc-10 and wc-10b.

## What changed

### `apps/web/package.json`, `dependencies`

- `"@countersign/relay": "workspace:*"`
- `"hono": "^4.13.16"`

The range is exactly the range `packages/relay/package.json` declares.

### Root `package.json`, `devDependencies`

- `"@countersign/relay": "workspace:*"`
- `"hono": "^4.13.16"`
- `"viem": "^2.57.16"`

Both external ranges are exactly the ranges `packages/relay/package.json` declares.

No other file, dependency, or script changed.

## The lock

`git diff --stat HEAD^ HEAD -- bun.lock`:

```
 bun.lock | 5 +++++
 1 file changed, 5 insertions(+)
```

The changed lines:

```diff
diff --git a/bun.lock b/bun.lock
index 35b3fd9..93cedd0 100644
--- a/bun.lock
+++ b/bun.lock
@@ -5,10 +5,13 @@
     "": {
       "name": "countersign",
       "devDependencies": {
+        "@countersign/relay": "workspace:*",
         "@openzeppelin/contracts": "5.6.1",
         "@types/bun": "1.3.x",
         "forge-std": "github:foundry-rs/forge-std#v1.17.0",
+        "hono": "^4.13.16",
         "typescript": "5.9.3",
+        "viem": "^2.57.16",
       },
     },
     "apps/hub": {
@@ -46,8 +49,10 @@
       "dependencies": {
         "@countersign/core": "workspace:*",
         "@countersign/rail": "workspace:*",
+        "@countersign/relay": "workspace:*",
         "@countersign/verify": "workspace:*",
         "@tanstack/react-query": "^5",
+        "hono": "^4.13.16",
         "react": "^19.3.1",
         "react-dom": "^19.3.1",
         "viem": "^2.57.16",
```

Only the two workspace blocks changed: the root `devDependencies` block and the `apps/web`
`dependencies` block. The `packages` section is byte-identical to the base. `hono` still resolves to
`4.13.16` and `viem` to `2.57.16`, the versions the lock already held. No external package was
added, removed, or moved. `bun install --linker hoisted` and `bun install --frozen-lockfile` both
report no changes against the committed lock.

## Acceptance 1: isolated install in a second worktree

Worktree at the code commit `3f73fe3` (the report commit adds only this file), separate from the
main one:

```
bun install --frozen-lockfile
bun run typecheck
bun test apps/web/test packages/relay/test examples/whitechain
```

- install: `Checked 658 installs across 668 packages (no changes)`
- typecheck: clean
- tests: `378 pass, 4 skip, 0 fail` (382 tests across 40 files, 1591 `expect()` calls)
- the live fixture stays skipped: `bun test examples/whitechain` is `0 pass, 1 skip, 0 fail`

Environment note: the first run of this command in `../wc-10c-iso` picked up
`~/node_modules/@types/node@20.14.2`, a directory above the worktree that is not part of
this repo. TypeScript walks upward when the isolated install has no root `@types/node`, and the old
home copy produced `Buffer` assignability errors in `apps/hub`, `packages/rail`, `packages/relay`,
`packages/runner`, and `scripts`. The same errors reproduce at the base commit `d71d2a6`, so they are
not caused by these declarations. The same tree installed frozen and typechecked clean from a
clean-ancestor temporary path, which is what CI has. The recorded run above moved that unrelated
home directory aside for the duration of the command and restored it immediately.

## Acceptance 2: the usual gate in the main worktree

```
bun install --linker hoisted
bun run typecheck
bun test
forge test
bun run --cwd apps/web build
```

- install: `Checked 857 installs across 668 packages (no changes)`
- typecheck: clean
- `bun test`: `1226 pass, 4 skip, 0 fail` (1230 tests across 147 files, 4574 `expect()` calls)
- `forge test`: 47 passed, 0 failed, 0 skipped (5 suites)
- web build: `vite v8.3.6`, 4974 modules transformed, built in 519 ms
