# tr-09e: `countersign mcp` runs the bundled MCP server and never resolves a package name (refs #246)

**Design: decided.** cs-truth wrote this on Opus from cs-w1's review of e3b1c17 (should-fix 1) and cs-w1's npm-names heads-up. Implement exactly what follows. Nothing here is left for you to choose. You start in the tr-09 worktree at `e3b1c17`.

## Why

- **The scope is not ours.** The `@countersign` scope on npm belongs to someone else, and so do the unscoped `countersign` and `countersign-mcp`.
- **The risk.** `loadMcpPackage` imports `@countersign/mcp` by name as a fallback. On a machine where that other package is installed, `countersign mcp` would run its code with `CS_BUYER_KEY` in the environment.
- **The fix.** The CLI imports the MCP server from this repository by a literal relative path, so the bundle carries it, and nothing is looked up by name.
- **K1.** That server is K1, PR #248, on `cs/hd-k1`. Its `packages/mcp/src/main.ts` exports `main(argv: string[]): Promise<void>` with no side effects on import. This branch therefore stacks on K1.

## Decisions

### 1. Stack on K1

Run `git fetch origin && git merge --no-edit origin/cs/hd-k1`.
- If `bun.lock` conflicts, take `origin/cs/hd-k1`'s version.
- Any other conflict is a stop condition.

### 2. `packages/cli/src/cli.ts`

- In `USAGE`, replace `The buyer MCP server over stdio, from @countersign-hub/mcp:` with `The buyer MCP server over stdio:`.
- Delete the two comment lines, `const MCP_PACKAGES = ...` and the whole `loadMcpPackage` function, which are the lines quoted below:
  ```ts
  // Built at run time, so neither the bundler nor the typecheck needs the MCP package present.
  // The published name comes first; the workspace name is the fallback.
  const MCP_PACKAGES = [["@countersign-hub", "mcp"].join("/"), ["@countersign", "mcp"].join("/")];

  async function loadMcpPackage(): Promise<unknown> {
    ...
  }
  ```
- In `DEFAULT_DEPS`, replace `loadMcp: () => loadMcpPackage(),` with:
  ```ts
    // A literal path into this repository: the bundle carries the server, and no package name is resolved.
    loadMcp: () => import("../../mcp/src/main.ts"),
  ```
- Replace the refusal `"countersign mcp needs @countersign-hub/mcp installed beside countersign."` with `"countersign mcp could not load its MCP server."`.
- Replace `"@countersign/mcp has no main(argv) export."` with `"The MCP server has no main(argv) export."`.

Nothing else in `cli.ts` changes.

### 3. `packages/cli/test/cli.test.ts` (new in this pull request)

In the case whose `loadMcp` rejects, change the expected text `needs @countersign-hub/mcp` to `could not load its MCP server`. Change nothing else.

### 4. `docs/decisions.md`

Replace the line

```
- `buy`, `discover`, `envelope` and `journal` run the buyer CLI, `verify` runs the verifier CLI, and `mcp` runs `@countersign/mcp`'s `main(argv)`.
```

with exactly

```
- `buy`, `discover`, `envelope` and `journal` run the buyer CLI, `verify` runs the verifier CLI, and `mcp` runs the buyer MCP server's `main(argv)` from `packages/mcp`, bundled into `countersign`. Nothing is looked up by package name, because the `@countersign` scope on npm is not ours.
```

## Lease

- the merge in section 1;
- `packages/cli/src/cli.ts`, `packages/cli/test/cli.test.ts` and `docs/decisions.md`: the edits above only.

Read only: everything else. Never commit a `bun.lock` you generated yourself.

## Constraints

- **No browser** of any kind.
- **No network** in tests.
- **Never print a key.**
- **Never run `git stash`.**
- **Tests:** never edit, weaken, skip or delete any other test.
- **Commits:** the merge commit, then one commit, `countersign mcp runs the bundled MCP server and resolves no package name (refs #246)`, with no emoji and no `Co-authored-by`.

## Acceptance

```
bun install --linker hoisted && bun run typecheck && bun test && forge test
cd packages/cli && bun run build && node dist/cli.js --help && node dist/cli.js --version && ! grep -q '"@countersign/mcp"' dist/cli.js && ! grep -q '@countersign-hub/mcp' dist/cli.js
```

All green. The bundle must not name either package.

## Stop conditions

Stop if any of these happens:
- a change is needed outside the lease;
- the merge of `origin/cs/hd-k1` conflicts outside `bun.lock`;
- a quoted line differs from the file;
- a failure survives three different fixes;
- 20 minutes have passed.

## Report

Write `~/Developer/countersign-mac/reports/tr-09e-bundled-mcp.md` (on the second machine): the diff, the gate output counts, and the acceptance output.
