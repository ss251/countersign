# cs-70g-release-peers: a tarball also declares the optional peers its dependencies really import

Lane: cs-w4. Base: `cs/cs-70` (continue on it). Branch: `cs/cs-70`. Lease as before: `scripts/release/**`
only. Do not touch any package. This packet starts after cs-70f has exited (both use the cs-70 worktree).

## What was found (the real K1 package, `cs/hd-k1` merged into a throw-away worktree, Node 25 and Node 20)

`bun scripts/release/build.ts --only mcp` works: `countersign-hub-mcp-0.1.0.tgz`, 19.5 KB, dependencies
`5 of 14` (`@circle-fin/x402-batching`, `@modelcontextprotocol/sdk`, `ajv`, `viem`, `zod`), packed files
clean. But the clean-directory smoke test **fails on both Nodes**:

```
FAIL mcp export @countersign-hub/mcp: ERR_MODULE_NOT_FOUND: Cannot find package '@x402/evm'
  imported from .../node_modules/@circle-fin/x402-batching/dist/server/index.mjs
```

Cause: `@circle-fin/x402-batching` 4.0.0 imports `@x402/evm` unconditionally in its server entry, but its
`package.json` lists `@x402/evm` only under `peerDependencies` with `peerDependenciesMeta` marking it
**optional**, and npm does not install optional peers. In the monorepo it resolves only because
`packages/rail` happens to depend on `@x402/evm`. A published package must declare it itself. (Its other
peers, `@x402/core` and `viem`, are not optional and are installed by npm.)

Do not try to compute "all optional peers": `viem` has an optional peer `mppx`, and adding that would pull
Stripe into every install. The right tool is an explicit, reasoned table.

## What to change

1. **`surface.ts` gains `peerCompletions`**, a per-package list of
   `{ package, needsBy, reason }`: `package` is the extra package to declare, `needsBy` is the declared
   dependency whose code imports it, `reason` is a non-empty sentence.
   - The version range comes from the union of the repository manifests (the same source as every other
     range). If the package is **not** in the union, that is an error naming it.
   - The completion is added to the staged `dependencies` after the import scan, so pruning never removes it.
   - Print one line per completion:
     `mcp: peer completion @x402/evm for @circle-fin/x402-batching (<reason>)`.
   - **A stale completion is an error:** if `needsBy` is not among the package's staged dependencies, fail
     with `stale peer completion for mcp: @x402/evm (needed by @circle-fin/x402-batching, which is not a dependency)`.
   - Table validation: an empty `package`, `needsBy` or `reason` throws.
   - `mcp` gets one entry: `{ package: "@x402/evm", needsBy: "@circle-fin/x402-batching", reason:
     "its server entry imports @x402/evm but lists it only as an optional peer, which npm does not install" }`.
   - `relay` and `cli` get none. (The CLI inlines every third-party package, so it has no external peers.)
2. **Smoke installs siblings together.** Found with the real CLI: `smoke.ts` runs `npm i <one tarball>`, but the
   staged CLI depends on `@countersign-hub/mcp`, which is not on npm until the captain publishes, so a lone
   install fails with `E404` for a reason that has nothing to do with the tarball. Change the install step:
   for each tarball, install it **together with every other tarball in the same directory whose package name
   it lists in its staged `dependencies`** (read from the tarball's own `package.json`), in one
   `npm i ./a.tgz ./b.tgz` command, and then check the first one as before.
   - Print which siblings were installed with it (`install: cli + mcp`).
   - If a staged `@countersign-hub/*` dependency has **no** tarball in the directory, fail with
     `FAIL install: <name> depends on <dep>, which has no tarball in <dir> and is not published` and exit 1.
     Never skip it silently.
   - Add a pure function for "which siblings does this tarball need" and test it: a dependency with a sibling,
     one without, and a tarball with no `@countersign-hub/*` dependency.
3. **Tests** (pure, offline): the completion is added with the union range; sorted keys; a package missing from
   the union throws naming it; a stale completion is an error naming it; an empty reason throws; the printed
   line; `relay` and `cli` have none. All existing tests stay unchanged.

## Gate (paste the tails)

1. `bun install --linker hoisted && bun run typecheck` clean; `bun test scripts/release` all pass, with the
   count.
2. Relay unchanged: `rm -rf .release && bun scripts/release/build.ts --only relay --out .release`, then
   `bun scripts/release/smoke.ts --dir .release` passes (Node 20 and the installed Node).
3. **All three packages, for real, in one second worktree (never on `cs/cs-70`).** Create it in the worktree
   directory, not in a temporary directory:
   ```
   git fetch origin
   git worktree add --detach "$HOME/Developer/countersign-wt/k3-all" origin/cs/tr-09
   cd "$HOME/Developer/countersign-wt/k3-all"
   git merge --no-edit origin/cs/hd-k1 && git merge --no-edit origin/cs/cs-70
   ```
   (`origin/cs/tr-09` already carries `bin` in `packages/cli/package.json`; if it does not, add
   `"bin": { "countersign": "./src/bin.ts" }` in that worktree only and never commit it. If a merge
   conflicts, stop and paste the conflict; do not resolve it by editing another lane's file.)
   Then `bun install --linker hoisted && rm -rf .release &&
   bun scripts/release/build.ts --require mcp,cli,relay --out .release`. It must build **all three**:
   `countersign-hub-mcp-0.1.0.tgz`, `countersign-hub-cli-0.1.0.tgz` and `countersign-hub-relay-0.1.0.tgz`.
   Paste the whole output (the peer-completion line, the guard-exception lines, every dependencies line,
   every `packed files clean`, every tarball size and file list). Then
   `bun scripts/release/smoke.ts --dir .release` must pass **every check for all three on the installed Node
   and the package's floor Node** (`mcp` and `relay` Node 20, `cli` Node 22). Paste every PASS line and the
   number of packages each install added, and show the `install: cli + mcp` line. Remove the worktree afterwards (`git worktree remove --force` and
   `git worktree prune`).
   **If anything fails because of another lane's code, paste the failure and stop; do not edit it.**
4. `bun scripts/release/build.ts --require mcp,cli,relay --out .release-req` in the **main** `cs-70`
   worktree still fails naming the missing ones; delete `.release-req`.

## Constraints

- **Never run `git stash`.** Never edit another lane's source, the root `package.json`, `bun.lock`,
  `tsconfig.json` or `.gitignore`. No key, no env file. Never print a home directory, user name or host name
  into a file, commit or the report.
- Never `npm publish`, `npm login` or `git tag`. `npm pack`, `npm i` of a local tarball and `npx -y node@22`
  are fine.
- Never push, merge or deploy. Small present-tense commits on `cs/cs-70`, no emoji, no Co-authored-by, no
  trailers; commit the feature and the tests separately.

## Report

Append a section "cs-70g" to `.packets/reports/cs-70-k3-release.md`: the change, the gate outputs, the three
tarballs' sizes and file lists, and what each install added.
