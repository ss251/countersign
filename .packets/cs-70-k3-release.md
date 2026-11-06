# cs-70-k3-release: bundle the publishable packages for Node and pack them (STEER-0110 K3)

Lane: cs-w4, with orch-cs. Base: `cs/int`. Branch: `cs/cs-70`.
Lease: `scripts/release/**`, plus each package's `package.json` `files`, `bin` and `exports` only. You do
not touch the root `package.json`, `bun.lock`, `tsconfig.json` or `.gitignore` (orch-cs's, serialized).
Publishing is NOT part of this packet: nothing goes to npm, nothing is tagged, nothing is uploaded.

**Published names (firstmate STEER 19:12:50Z, the captain chose npm).** The `@countersign` scope and the
`countersign` name are taken on npm by other projects. The packages are therefore published as
`@countersign-hub/mcp`, `@countersign-hub/cli` (its `bin` is still `countersign`) and
`@countersign-hub/relay`. The workspace imports stay `@countersign/*`; **only the generated, staged
`package.json` carries the published name.** Keep the scope in ONE constant (`PUBLISH_SCOPE =
"@countersign-hub"`, in one small module under `scripts/release/`, used by the build, the smoke test and the
tests) so that a rename is a one-line edit.

## Why

Every package is private or source-only, so nobody outside this repository can install anything.
`scripts/release/pack.ts` already packs the relay as raw TypeScript tarballs. The onboarding kit needs
tarballs that run on plain Node 20+, with no Bun and no `workspace:` dependency, so that a stranger can
run `npm i ./countersign-hub-cli-0.1.0.tgz && npx countersign --help`. K1 (`packages/mcp`) and K2
(`packages/cli`) are being written by other lanes at the same time, so your tooling must work for
whichever of `mcp`, `cli` and `relay` exist, and pick up the others when they land, without edits.

## What to build

Read `scripts/release/pack.ts` first, and leave it as it is (it stays the raw-source channel).

### 1. `scripts/release/build.ts` (runs under Bun, produces output that runs under Node)

`bun scripts/release/build.ts [--only mcp,cli,relay] [--require mcp,cli,relay] [--out .release]`

- The publishable set is `mcp`, `cli`, `relay`. A package whose directory `packages/<name>` does not exist
  is skipped with one line saying so, unless it is named in `--require`, which makes a missing one an
  error. With no flags, build whatever exists.
- **Entry points come from each package's own `package.json`:** every source file referenced by its `bin`
  values and its `exports` values (the source `.ts` paths) is bundled. Do not hard-code file names.
- Bundle each package with `Bun.build({ target: "node", format: "esm", ... })` into
  `<out>/stage/<name>/dist/`.
  - **Inline every `@countersign/*` workspace package** (`core`, `rail`, `verify`, `buyer`, `runner`,
    `identity` and the rest) so that none of them needs publishing.
  - **Keep every third-party package external.** For each third-party dependency name `d`, mark both `d`
    and `d/*` external, so subpath imports such as `viem/chains` stay external too.
- **The third-party dependency set** of a staged package is the union of its own `dependencies` and the
  `dependencies` of every `@countersign/*` package it transitively imports (read from the repository
  manifests, recursively), with the `@countersign/*` names removed. If two manifests give different
  ranges for the same package, fail loudly and name both. Never emit a `workspace:` specifier.
- **The staged `package.json`** is generated, not copied: `name` (`PUBLISH_SCOPE` + `/` + the short name:
  `@countersign-hub/mcp`, `@countersign-hub/cli`, `@countersign-hub/relay`), `version` (from the repository
  manifest), `type: "module"`, `license: "MIT"`, `publishConfig: { "access": "public" }`,
  `engines: { "node": ">=20" }`, `files: ["dist"]`, no `private`,
  the dependency union, `bin` and `exports` rewritten to the built `dist/*.js` paths. If a package has no
  `bin`, the staged manifest has none.
- **Bin files** must start with exactly one `#!/usr/bin/env node` line (replace a `#!/usr/bin/env bun`
  line, add one if missing) and be executable.
- **Node guard.** After bundling, scan every emitted `.js` file and fail the build, naming the file and
  the match, if it contains `Bun.`, `bun:`, `import.meta.dir`, `import.meta.path` or `import.meta.main`
  outside a string literal that is clearly data. If the existing source of a package uses one of these,
  the build must fail and say which source file it came from if the source map or the bundle comment
  shows it. **Do not edit another lane's source to make the guard pass.** Report the failure instead.
- **Pack.** Run `npm pack --pack-destination <out>` in each staged directory. `npm pack` names a scoped
  package `<scope>-<name>-<version>.tgz`, so the three files are
  `countersign-hub-mcp-<version>.tgz`, `countersign-hub-cli-<version>.tgz` and
  `countersign-hub-relay-<version>.tgz`. Have the script print each path it produced, and require that
  every produced tarball matches `countersign-hub-*.tgz`.
- Print, per package, the tarball path, its size, and the file list.

### 2. `scripts/release/smoke.ts` (also runs under Bun, but everything it launches runs under Node)

`bun scripts/release/smoke.ts [--dir .release]`

For each tarball in the directory, in a fresh temporary directory outside the repository (use
`os.tmpdir()`, never a path inside the repo):

- `npm init -y`, then `npm i <tarball>` (third-party dependencies come from the registry; that is fine).
- If the package has a `bin`, run `npx <bin-name> --help` under Node (the bin name, for example
  `countersign`, is a key of the staged `bin`, not the package name) and require exit code 0 and non-empty
  output.
- For every `exports` entry, run `node --input-type=module -e "await import('<published name>/<subpath>')"`,
  where the published name is `@countersign-hub/<short>`, and
  require exit code 0. (If an export needs a browser, `browser` for the relay, that is still a plain
  import and must succeed under Node; if it does not, report it, do not skip it.)
- Print one PASS or FAIL line per check and exit 1 if any failed. Clean the temporary directory up.
- Print `node --version` first, and refuse to run on Node older than 20.

### 3. Manifest fields in the packages

Only where a package already exists on this branch and the bundler needs it: set `files`, `bin` and
`exports` in `packages/mcp/package.json` and `packages/cli/package.json` **only if those packages exist
and their owners have not already set them**. Today they do not exist, so expect to change nothing.
The relay already has `files` and `exports`; do not change them.

### 4. Tests (`scripts/release/test/*.test.ts`, `bun test`)

Pure and offline. Export the functions you need from small modules under `scripts/release/` so they can
be tested without building anything real. Cover at least:

- the dependency union: a diamond of two workspace packages sharing a dependency, a conflicting range
  (must throw naming both), a `workspace:` specifier (must throw), `@countersign/*` names removed;
- the staged manifest: `name` is `@countersign-hub/<short>`, `publishConfig.access` is `public`, `bin` and
  `exports` rewritten to `dist/*.js`, no `private`, `engines` set, `files` is `["dist"]`, and changing
  `PUBLISH_SCOPE` in the one module changes every name (test it by calling the function with another scope);
- the shebang rewrite: bun shebang replaced, missing shebang added, exactly one line;
- the Node guard: a fixture string with `Bun.file(` fails, `import.meta.dir` fails, plain code passes,
  and the failure names the file;
- the external list: `viem` yields `viem` and `viem/*`, a scoped name yields `@scope/name` and
  `@scope/name/*`;
- missing packages: skipped without `--require`, an error with it.

Use temporary directories under `os.tmpdir()` for fixtures. No network, no `npm`, no Bun.build in the
unit tests.

## Gate (all of these; paste the tails)

1. `bun install --linker hoisted` then `bun run typecheck` clean. If the root `tsconfig.json` `include`
   does not cover `scripts/**`, do not edit it: typecheck your files with a temporary tsconfig in
   `os.tmpdir()` that extends the root one and includes `scripts/release`, and say so in the report.
2. `bun test scripts/release` all pass. Count the tests.
3. **The relay, for real:** `bun scripts/release/build.ts --only relay --out .release`, then
   `bun scripts/release/smoke.ts --dir .release`, run on a machine with Node 20+. The relay tarball
   installs from a clean directory as `countersign-hub-relay-<version>.tgz` and every one of its four
   exports (`@countersign-hub/relay`, `/paywall`, `/pay-fetch`, `/browser`) imports under Node. Paste the PASS lines and `node --version`.
4. `bun scripts/release/build.ts --require mcp,cli,relay --out .release` **must fail** today with a
   message naming `mcp` and `cli` as missing (they land later). Paste it. This proves `--require`.
5. Show the staged relay `package.json` (name, version, `publishConfig`, `engines`, `files`, the dependency
   names): the name is `@countersign-hub/relay` and no dependency starts with `@countersign/`.
6. Open the built relay `dist/*.js` and show with `grep -c` that it contains no `@countersign/core`
   import specifier (it was inlined) and still imports `viem` and `hono` as bare specifiers.

## Constraints

- **Never run `git stash`;** the worktrees share one stash stack. Use a temporary commit or a second
  worktree.
- Touch only `scripts/release/**` (and, per section 3, a package manifest if one exists and lacks the
  fields). Never edit the root `package.json`, `bun.lock`, `tsconfig.json` or `.gitignore`. `.release/`
  and `dist/` are already gitignored; check with `git status` that no build output is staged.
- Never read, print or log a key or an env file. This packet needs none.
- Never run `npm publish`, `npm login`, `git tag`, or anything that uploads. `npm pack` and `npm i` of a
  local tarball are fine.
- No test is rewritten to pass. If a gate step fails because of another lane's code, stop and report it.
- Never push, merge or deploy. Small present-tense commits on `cs/cs-70`, no emoji, no Co-authored-by,
  no trailers. Commit the script and its tests separately.

## Report

`.packets/reports/cs-70-k3-release.md`: what was built, the exact commands, the gate outputs, the size
and file list of the relay tarball, how many third-party dependencies the relay carries, anything the
guard flagged, and the one-line commands for building and smoke-testing once `mcp` and `cli` exist.
