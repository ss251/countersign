# cs-70f-release-guard: the Node guard judges the emitted code, and allows two named, reasoned exceptions for the CLI

Lane: cs-w4. Base: `cs/cs-70` (continue on it). Branch: `cs/cs-70`. Lease as before: `scripts/release/**`
only. Do not touch `packages/cli/**`, `packages/runner/**`, `packages/buyer/**` or any other package.

## What was found (the real K2 CLI, `cs/tr-09` merged into a throw-away worktree, Node 25)

`bun scripts/release/build.ts --only cli` now gets past the shebang bug (cs-70e), bundles `dist/bin.js` and
`dist/child-entry.js`, and then the Node guard rejects it:

```
Node guard failed for cli:
  .release/stage/cli/dist/bin.js:32564:18 "Bun." (source packages/buyer/src/openai/server.ts)
  packages/runner/src/cli.ts:488:5 "import.meta.main"
  packages/runner/src/child.ts:97:16 "Bun."
```

I checked each by hand:

1. `import.meta.main` (`runner/src/cli.ts:488`) is **not in the emitted code at all.** Bun resolves it at build
   time; `grep -c import.meta.main dist/bin.js dist/child-entry.js` gives 0 and 0. It is reported only because
   `guardPackage` in `build.ts` has a second loop that scans the **source text** from the source maps
   (`sourceFiles(...)`). The packet for cs-70 said to scan the emitted `.js` files; the source scan is a false
   positive generator and must go.
2. `Bun.spawn` (`runner/src/child.ts:97`) is inside `runWithBun`, and `defaultSpawner()` returns `"node"`
   unless `globalThis.Bun` is defined, so under Node the `node:child_process` path runs. Dead on Node.
3. `Bun.serve` (`buyer/src/openai/server.ts`) is started only by the buyer CLI's `openai` subcommand. The
   `countersign` wrapper accepts only `discover`, `buy`, `envelope` and `journal` (`BUYER_COMMANDS` in
   `packages/cli/src/cli.ts`), so it cannot be reached from `countersign`.

The bundle runs correctly on Node: `node dist/bin.js --help` prints the usage under Node 25.

## What to change

1. **Guard the emitted code only.** In `build.ts` `guardPackage`, delete the second loop that scans source
   files from the source maps. Keep the first loop and its `(source <file>)` attribution, which uses the map
   only to name where an emitted hit came from. If a unit test asserts the removed source scan, do not edit
   it quietly: remove that one assertion, and list it in the report with the reason above.
2. **Named exceptions.** In `surface.ts` add `guardExceptions`: per package, a list of
   `{ source, pattern, reason }` where `source` is the repository-relative source file the map attributes the
   emitted hit to, `pattern` is the guard pattern (`"Bun."` and so on) and `reason` is a non-empty sentence.
   - A violation is excused only if **its attributed source and pattern both match** an exception of that
     package. An unattributed hit (no map, or the map cannot name the file) is never excused.
   - Every excused violation prints one line:
     `cli: guard exception packages/runner/src/child.ts "Bun." (<reason>)`.
   - **A stale exception is an error:** one that excuses nothing in this build fails with
     `stale guard exception for cli: <source> "<pattern>"`, so the table cannot rot.
   - Table validation: an empty `reason`, `source` or `pattern` throws when the module's table is checked.
   - `relay` and `mcp` get none.
3. **The two exceptions for `cli`:**
   - `packages/runner/src/child.ts`, `"Bun."`: runWithBun runs only when `globalThis.Bun` is defined; under
     Node `defaultSpawner` returns `node` and `node:child_process` is used.
   - `packages/buyer/src/openai/server.ts`, `"Bun."`: started only by the buyer `openai` subcommand, which
     the `countersign` wrapper does not expose.
4. **Say what is not covered.** The build output and the report must say plainly that the smoke test does
   not run a sell job through the child spawner, so that path is guarded by the runtime check only.
5. **Tests** (pure, offline): excused when source and pattern match; not excused for the same source with a
   different pattern; not excused for the same pattern in a different source; an unattributed hit is never
   excused; an empty reason throws; a stale exception is an error naming it; relay has none. All existing
   tests stay unchanged.

## Gate (paste the tails)

1. `bun install --linker hoisted && bun run typecheck` clean; `bun test scripts/release` all pass, with the
   count (it was 74).
2. The relay is unchanged: `rm -rf .release && bun scripts/release/build.ts --only relay --out .release`
   gives `countersign-hub-relay-0.1.0.tgz` (four files) and `bun scripts/release/smoke.ts --dir .release`
   passes.
3. **The CLI, for real, in a second worktree (never on `cs/cs-70`).** Create it in the worktree directory,
   not in a temporary directory:
   ```
   git fetch origin
   git worktree add --detach "$HOME/Developer/countersign-wt/k3-cli" origin/cs/tr-09
   cd "$HOME/Developer/countersign-wt/k3-cli" && git merge --no-edit origin/cs/cs-70
   ```
   (`origin/cs/tr-09` already carries `bin` in `packages/cli/package.json`; if it does not, add
   `"bin": { "countersign": "./src/bin.ts" }` in that worktree only and never commit it.) Then
   `bun install --linker hoisted && bun scripts/release/build.ts --only cli --out .release`. Paste the whole
   output: the extra-dependency line (`@countersign-hub/mcp` skipped, `packages/mcp` is not in that tree),
   the two `guard exception` lines, the dependencies line, `packed files clean`, the tarball size, and its
   file list (expect `dist/bin.js`, `dist/child-entry.js`, `package.json`).
   **Watch the dependencies line.** The CLI declares no dependencies and imports its sibling packages by
   relative path, so the externals list may be empty and every third-party package inlined (the bundle is
   about 45,000 lines). That may be acceptable (a self-contained CLI), but say plainly what you see. If the
   packed-file leak check fails on text inside an inlined third-party package, **paste the failure and
   stop; do not weaken the leak check.**
   Then `bun scripts/release/smoke.ts --dir .release`: `npx countersign --help` passes under Node 22 and
   the installed Node, and `dist/child-entry.js` exists in the install. Paste every PASS line. Remove the
   worktree afterwards (`git worktree remove --force` and `git worktree prune`).
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

Append a section "cs-70f" to `.packets/reports/cs-70-k3-release.md`: the changes, the gate outputs, the CLI
tarball's size and file list, what the dependencies line said, and the one thing the smoke test does not run.
