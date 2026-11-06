# tr-09d: the countersign CLI gets its bin, and `countersign mcp` finds the published MCP package first (refs #246)

**Design: decided.** cs-truth wrote this on Opus from cs-w4's K3 note (the release build). Implement exactly what follows. Nothing here is left for you to choose. You start in the tr-09 worktree at `46fa595`.

## Why

- The release build needs `packages/cli` to declare its command.
- The MCP server is published as `@countersign-hub/mcp`, while the workspace name stays `@countersign/mcp`. `countersign mcp` must find the published name first.

## Decisions

### 1. `packages/cli/package.json`

Add exactly this field after `"engines"`:

```json
  "bin": { "countersign": "./src/bin.ts" },
```

Nothing else in the file changes.

### 2. `packages/cli/src/cli.ts`

- In `USAGE`, replace the line `The buyer MCP server over stdio, from @countersign/mcp:` with `The buyer MCP server over stdio, from @countersign-hub/mcp:`.
- Replace these two lines:
  ```ts
  // Built at run time, so neither the bundler nor the typecheck needs @countersign/mcp present.
  const MCP_PACKAGE = ["@countersign", "mcp"].join("/");
  ```
  with exactly:
  ```ts
  // Built at run time, so neither the bundler nor the typecheck needs the MCP package present.
  // The published name comes first; the workspace name is the fallback.
  const MCP_PACKAGES = [["@countersign-hub", "mcp"].join("/"), ["@countersign", "mcp"].join("/")];

  async function loadMcpPackage(): Promise<unknown> {
    let lastError: unknown = new Error("No MCP package name to try.");
    for (const name of MCP_PACKAGES) {
      try {
        return await import(name);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }
  ```
- In `DEFAULT_DEPS`, replace `loadMcp: () => import(MCP_PACKAGE),` with `loadMcp: () => loadMcpPackage(),`.
- Replace the refusal `"countersign mcp needs @countersign/mcp installed beside countersign."` with `"countersign mcp needs @countersign-hub/mcp installed beside countersign."`.

Nothing else in `cli.ts` changes.

### 3. `packages/cli/test/cli.test.ts`

This test file is new in this same pull request, not an existing test on `cs/int`. In the case whose `loadMcp` rejects, change the expected text `needs @countersign/mcp` to `needs @countersign-hub/mcp`. Change nothing else in the file.

## Lease

`packages/cli/package.json`, `packages/cli/src/cli.ts` and `packages/cli/test/cli.test.ts`: the edits above only. Read only: everything else. Never commit `bun.lock`.

## Constraints

- **No browser** of any kind.
- **No network** in tests.
- **Never print a key.**
- **Never run `git stash`.**
- **Tests:** never edit, weaken, skip or delete any other test.
- **Commits:** one commit, `countersign declares its bin and looks for the published MCP package first (refs #246)`, with no emoji and no `Co-authored-by`.

## Acceptance

```
bun install --linker hoisted && bun run typecheck && bun test && forge test
cd packages/cli && bun run build && node dist/cli.js --help && node dist/cli.js --version
```

All green. `--help` names `@countersign-hub/mcp`.

## Stop conditions

Stop if any of these happens:
- a change is needed outside the lease;
- a quoted line differs from the file;
- a failure survives three different fixes;
- 15 minutes have passed.

## Report

Write `~/Developer/countersign-mac/reports/tr-09d-release-names.md` (on the second machine): the diff, the gate output counts, and the acceptance output.
