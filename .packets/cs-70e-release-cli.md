# cs-70e-release-cli: make the release build work on the real `countersign` CLI (K2) and its child process

Lane: cs-w4. Base: `cs/cs-70` (continue on it). Branch: `cs/cs-70`. Lease as before: `scripts/release/**`
only. **Do not touch `packages/cli/**`, `packages/runner/**` or any other package**: K2 (`cs/tr-09`) is
cs-truth's and is not on `cs/int` yet.

## What was found (I ran the release build against K2 in a throw-away worktree)

K2's `packages/cli/package.json` is `name: countersign`, `private: true`, `engines.node: >=22`, with no `bin`,
`exports` or `files`. Its code and my build disagree in four places:

1. **A bug in `scripts/release/imports.ts`.** `Bun.Transpiler.scanImports` throws
   `Unexpected #!/usr/bin/env node` when the code starts with a shebang line. The emitted CLI bundle starts
   with one; the relay has none, so cs-70c never hit it. Strip a leading `#!` line before scanning (do not
   alter the file on disk).
2. **A second entry that is not in `bin` or `exports`.** `packages/runner/src/child.ts` starts the sandboxed
   child with `new URL("./child-entry.js", import.meta.url)`, i.e. a file **beside the running bundle**.
   K2's own build script emits `dist/child-entry.js` from `packages/runner/src/child-entry.ts` next to
   `dist/cli.js`. The published CLI must ship that file next to its main bundle, built, guarded and
   scanned like the rest.
3. **A dependency the scanner cannot see.** `packages/cli/src/cli.ts` loads the MCP server with
   `import(["@countersign","mcp"].join("/"))`, a computed name on purpose. The published package is named
   `@countersign-hub/mcp`, so the staged CLI manifest must declare `@countersign-hub/mcp` as a dependency.
4. **The Node floor.** The staged `engines.node` is hard-coded `>=20`; the CLI declares `>=22`, and the smoke
   test runs a Node 20 pass for everything.

## What to change

1. **imports.ts**: strip a leading shebang line before `scanImports`. Add a test with a fixture that begins
   with `#!/usr/bin/env node` and imports `viem`: it must be scanned, not throw. Keep every existing test.
2. **`surface.ts`** gains two optional per-package tables, both empty for `relay` and `mcp`:
   - `extraEntries`: a list of `{ source, target }` (repository-relative source path, `dist/...js` target).
     For `cli`: `{ source: "packages/runner/src/child-entry.ts", target: "dist/child-entry.js" }`.
     These are bundled in the same `Bun.build` as the main entries, with the same externals, then guarded,
     import-scanned and packed with them. They do not appear in `bin` or `exports`. They count towards the
     dependency scan (so their imports are declared) and towards the leak check.
   - `extraDependencies`: a map of published package name to the **short workspace name it comes from**.
     For `cli`: `{ "@countersign-hub/mcp": "mcp" }`. The version range is `^` plus the version in
     `packages/<short>/package.json`. If `packages/<short>` does not exist, **skip it and print one loud
     line** (`cli: extra dependency @countersign-hub/mcp skipped (packages/mcp not found)`), unless `mcp`
     is in `--require`, in which case the existing missing-package error already applies. Extra dependencies
     are added after the scan, so "declared but not imported" pruning never removes them.
3. **Engines.** The staged `engines.node` is the source package's own `engines.node` if it declares one,
   otherwise `>=20`. Add a pure function and test both.
4. **Smoke** picks the Node to test from the staged `engines.node`: read the floor's major (`>=22` gives
   22, `>=20` gives 20) and run the second pass under `npx -y node@<major>`; keep the installed-Node pass.
   Print `node <major> --version` and tag each PASS line with the Node that ran it, as now. For a package
   with a `bin`, `--help` must also pass under the floor Node. For the CLI additionally check that
   `dist/child-entry.js` exists in the installed package (`node -e` with `fs.existsSync`).
5. **Tests** (offline, in `scripts/release/test/`): the shebang scan; `extraEntries` are added to the entry
   list, are bundled to the right target and are not added to `bin`/`exports`; `extraDependencies` produce
   the right range, are skipped loudly when the package is absent, and are not pruned; engines from the
   source versus the default; the floor-major parser.

## Gate (paste the tails)

1. `bun install --linker hoisted && bun run typecheck` clean; `bun test scripts/release` all pass, with the
   count (it was 54 before cs-70d).
2. The relay build is unchanged: `rm -rf .release && bun scripts/release/build.ts --only relay --out .release`
   still gives `countersign-hub-relay-0.1.0.tgz` with three files plus `package.json`, and
   `bun scripts/release/smoke.ts --dir .release` still passes.
3. **The CLI, for real, in a second worktree (never on `cs/cs-70`).** Create it in the worktree directory,
   not in a temporary directory:
   ```
   git fetch origin
   git worktree add --detach "$HOME/Developer/countersign-wt/k3-cli" origin/cs/tr-09
   cd "$HOME/Developer/countersign-wt/k3-cli" && git merge --no-edit origin/cs/cs-70
   ```
   In that worktree only, add `"bin": { "countersign": "./src/bin.ts" }` to `packages/cli/package.json` (do
   not commit it anywhere; K2's owner adds it in the real branch), then
   `bun install --linker hoisted && bun scripts/release/build.ts --only cli --out .release`. It must produce
   `countersign-hub-cli-0.1.0.tgz` whose file list is `dist/bin.js`, `dist/child-entry.js` and
   `package.json` (plus anything the build adds for the bin, say what), print the extra-dependency skip
   line (`packages/mcp` is not in that tree), and pass the guard. Then
   `bun scripts/release/smoke.ts --dir .release` must pass `npx countersign --help` under Node 22 and the
   installed Node, and the `child-entry.js` check. Paste the build output, the file list, the staged manifest
   (name, bin, engines, dependencies) and every PASS line. Remove the worktree afterwards
   (`git worktree remove --force` and `git worktree prune`).
   **If the guard fails on K2's or the runner's source, do not edit it: paste the failure and stop.** That
   is a finding for K2's owner.
4. `bun scripts/release/build.ts --require mcp,cli,relay --out .release-req` still fails naming the missing
   ones (in the main worktree that is `mcp` and `cli`); delete `.release-req`.

## Constraints

- **Never run `git stash`.** Never edit another lane's source, the root `package.json`, `bun.lock`,
  `tsconfig.json` or `.gitignore`. No key, no env file. Never print a home directory, user name or host name
  into a file, commit or the report.
- Never `npm publish`, `npm login` or `git tag`. `npm pack`, `npm i` of a local tarball and `npx -y node@22`
  are fine.
- Never push, merge or deploy. Small present-tense commits on `cs/cs-70`, no emoji, no Co-authored-by, no
  trailers; commit the fix, the feature and the tests separately.

## Report

Append a section "cs-70e" to `.packets/reports/cs-70-k3-release.md`: the four changes, the gate outputs, the
CLI tarball's size and file list, and anything the guard or the smoke test reported about K2.
