# cs-70-k3-release: Node bundles for the publishable packages

## What was built

`scripts/release/build.ts` and `scripts/release/smoke.ts`, plus the small modules the
tests import directly:

- `published.ts` — `PUBLISH_SCOPE = "@countersign-hub"` and the one place a published
  name or tarball prefix is derived.
- `args.ts` — the `--only`/`--require`/`--out` and `--dir` parsers, and the missing
  package planning rule.
- `manifest.ts` — entry discovery from `bin`/`exports`, the recursive
  `@countersign/*` dependency union, `dist` target mapping, and the generated staged
  manifest.
- `external.ts` — `d` plus `d/*` for every third-party dependency.
- `shebang.ts` — the exactly-one `#!/usr/bin/env node` rewrite.
- `guard.ts` — the Bun/`import.meta` scanner and source-map origin lookup.
- `build.ts` — Bun.build staging, guard, bin rewrite, and `npm pack`.
- `smoke.ts` — clean temp installs and Node imports of every tarball export.

`scripts/release/pack.ts` is unchanged. No package manifest changed: `packages/mcp` and
`packages/cli` do not exist yet, and `packages/relay` already had `files` and `exports`.

## Gate 1: install and typecheck

```
$ bun install --linker hoisted
bun install v1.3.14 (0d9b296a)

+ @countersign/relay@workspace:packages/relay

3 packages installed [3.61s]

$ bun run typecheck
$ tsc -p tsconfig.json
```

The root `tsconfig.json` already includes `scripts`, so no temporary tsconfig was
needed. `git status` shows only the new `scripts/release/**` files; `bun.lock` and the
root manifest are untouched.

## Gate 2: unit tests

```
$ bun test scripts/release
bun test v1.3.14 (0d9b296a)

 38 pass
 0 fail
 64 expect() calls
Ran 38 tests across 6 files. [19.00ms]
```

Coverage includes the diamond dependency union, conflicting ranges with both manifests
named, third-party `workspace:` rejection, scope removal, staged manifest fields and
scope override, the shebang rewrite, the Node guard fixtures, `viem`/scoped external
patterns, and missing packages with and without `--require`.

## Gate 3: the relay, for real — blocked by the relay's Bun-only source

The build is supposed to fail here rather than hide another lane's source. It does:

```
$ bun scripts/release/build.ts --only relay --out .release
Node guard failed for relay:
  .release/stage/relay/dist/index.js:2773:27 "bun:sqlite" (source packages/relay/src/ledger.ts)
  packages/relay/src/server.ts:421:5 "import.meta.main"
  packages/relay/src/server.ts:452:3 "Bun."
  packages/relay/src/merchant-server.ts:232:5 "import.meta.main"
  packages/relay/src/merchant-server.ts:241:3 "Bun."
Bun-only APIs in package sources are not rewritten by this build.
```

No tarball is produced, so the exact gate command cannot proceed:

```
$ bun scripts/release/smoke.ts --dir .release
node --version: v26.7.0
no countersign-hub-*.tgz in /Users/sailesh/Developer/countersign-wt/cs-70/.release
```

`packages/relay/src/ledger.ts` imports `bun:sqlite` as a value, and
`server.ts`/`merchant-server.ts` use `Bun.serve` and `import.meta.main`. The `"."`
export re-exports `ledger.ts`, so the relay cannot run on plain Node without a change
in the relay lane. Per the packet, the guard was not weakened and the relay source was
not edited.

For diagnosis only, the staged tree was packed manually outside `.release` (`npm pack`
in `.release/stage/relay`, destination under `os.tmpdir()`) and smoke-tested. This
tarball is not a release artifact and was not left in `.release`:

```
node --version: v26.7.0
PASS countersign-hub-relay-0.1.0 init: ...
PASS countersign-hub-relay-0.1.0 install: added 221 packages in 16s ...
PASS relay published name: @countersign-hub/relay (expected @countersign-hub/relay)
FAIL relay export @countersign-hub/relay: ... Received protocol 'bun:' ...
PASS relay export @countersign-hub/relay/paywall
PASS relay export @countersign-hub/relay/pay-fetch
PASS relay export @countersign-hub/relay/browser
```

Three of the four exports already import under Node. Only `"."` fails, on
`bun:sqlite` from `ledger.ts`. A direct Node import of the staged `dist/index.js` gives
`ERR_UNSUPPORTED_ESM_URL_SCHEME: ... Received protocol 'bun:'`.

Diagnostic tarball: 40,939 bytes, unpacked 215,649 bytes.

```
dist/browser.js    26948
dist/index.js     146194
dist/pay-fetch.js  21898
dist/paywall.js    19752
package.json         857
```

## Gate 4: `--require` fails for the missing lanes

```
$ bun scripts/release/build.ts --require mcp,cli,relay --out .release
missing required packages: mcp, cli (packages/mcp, packages/cli not found)
exit=1
```

## Gate 5: the staged relay manifest

The build writes this before the guard runs, so it is available for inspection even
though no tarball is produced:

```json
{
  "name": "@countersign-hub/relay",
  "version": "0.1.0",
  "type": "module",
  "license": "MIT",
  "publishConfig": {
    "access": "public"
  },
  "engines": {
    "node": ">=20"
  },
  "files": [
    "dist"
  ],
  "dependencies": {
    "@circle-fin/x402-batching": "4.0.0",
    "@hashgraph/hedera-agent-kit": "4.2.0",
    "@hashgraph/hedera-agent-kit-mcp": "1.2.0",
    "@hiero-ledger/proto": "2.32.0",
    "@hiero-ledger/sdk": "2.90.1",
    "@modelcontextprotocol/sdk": "1.32.2",
    "@x402/core": "2.30.0",
    "@x402/evm": "2.30.0",
    "@x402/hedera": "2.30.0",
    "ajv": "^8.20.0",
    "hono": "^4.13.16",
    "mppx": "0.17.1",
    "stripe": "23.1.0",
    "viem": "^2.57.16"
  },
  "exports": {
    ".": "./dist/index.js",
    "./paywall": "./dist/paywall.js",
    "./pay-fetch": "./dist/pay-fetch.js",
    "./browser": "./dist/browser.js"
  }
}
```

The relay carries 14 third-party dependencies. No dependency name starts with
`@countersign/`, and there is no `private` field.

## Gate 6: inlining and external bare imports

```
$ grep -c '@countersign/core' .release/stage/relay/dist/*.js
.release/stage/relay/dist/browser.js:0
.release/stage/relay/dist/index.js:0
.release/stage/relay/dist/pay-fetch.js:0
.release/stage/relay/dist/paywall.js:0

$ grep -c 'from "viem' .release/stage/relay/dist/*.js
.release/stage/relay/dist/browser.js:14
.release/stage/relay/dist/index.js:25
.release/stage/relay/dist/pay-fetch.js:11
.release/stage/relay/dist/paywall.js:10

$ grep -c 'from "hono' .release/stage/relay/dist/*.js
.release/stage/relay/dist/browser.js:0
.release/stage/relay/dist/index.js:4
.release/stage/relay/dist/pay-fetch.js:0
.release/stage/relay/dist/paywall.js:0
```

`@countersign/core` and `@countersign/rail` are inlined. `viem` and `hono` remain bare
specifiers, including the `viem/accounts`, `viem/chains`, `viem/ens`, `ajv/dist/2020.js`
and `hono/cors` subpaths. `bun:sqlite` is the one remaining non-Node bare import.

## What the guard flagged

- `bun:sqlite` in `packages/relay/src/ledger.ts`, emitted into `dist/index.js`.
- `import.meta.main` and `Bun.serve` in `packages/relay/src/server.ts`.
- `import.meta.main` and `Bun.serve` in `packages/relay/src/merchant-server.ts`.

The emitted bundle no longer contains the `import.meta.main`/`Bun.serve` blocks because
Bun drops them for `target: "node"`, but the source scan from the source map still
reports them, as the packet requires.

## Once `mcp` and `cli` exist

```sh
bun scripts/release/build.ts --require mcp,cli,relay --out .release
bun scripts/release/smoke.ts --dir .release
```

The relay still needs its ledger off `bun:sqlite` (and the two server entry points off
`Bun.serve`/`import.meta.main`) before those commands can pass end to end. `mcp` and
`cli` are picked up automatically from their `bin` and `exports`; no edit to this
tooling is needed.

## cs-70b: publish only the Node-safe relay surface

### The change

`scripts/release/surface.ts` adds `PUBLISH_SURFACE`, a short package name to optional
`exports` allowlist table. `relay` publishes `["./paywall", "./pay-fetch", "./browser"]`;
`mcp` and `cli` have no entry and publish everything their own `exports` and `bin`
declare. `manifest.ts` discovers bundle entries and builds the staged `exports` from the
filtered surface, while `bin` is unaffected. `build.ts` prints one line for every
manifest export left out and fails when an allowlisted key is absent from the manifest.
`smoke.ts` adds the relay root check. No relay source, guard, root manifest,
`bun.lock`, `tsconfig.json` or `.gitignore` changed.

### Gate 1: install and typecheck

```
$ bun install --linker hoisted && bun run typecheck
bun install v1.3.14 (0d9b296a)

+ @countersign/relay@workspace:packages/relay

3 packages installed [2.31s]
$ tsc -p tsconfig.json
```

### Gate 2: unit tests

```
$ bun test scripts/release
bun test v1.3.14 (0d9b296a)

 43 pass
 0 fail
 78 expect() calls
Ran 43 tests across 7 files. [90.00ms]
```

The original 38 tests are unchanged; five new tests cover the relay surface, a missing
allowlisted key, a package with no table entry, and one not-published line per omitted
key.

### Gate 3: the relay, for real

```
$ node --version
v26.7.0

$ rm -rf .release && bun scripts/release/build.ts --only relay --out .release
relay: "." not published (not on the publish surface: packages/relay/package.json exports it for the workspace)
relay: /Users/sailesh/Developer/countersign-wt/cs-70/.release/countersign-hub-relay-0.1.0.tgz
  size: 8795 bytes
  files:
    dist/browser.js
    dist/pay-fetch.js
    dist/paywall.js
    package.json
```

Tarball `.release/countersign-hub-relay-0.1.0.tgz`: 8,795 bytes.

```
$ bun scripts/release/smoke.ts --dir .release
node --version: v26.7.0
PASS countersign-hub-relay-0.1.0 init: ...
PASS countersign-hub-relay-0.1.0 install: added 221 packages in 12s ...
PASS relay published name: @countersign-hub/relay (expected @countersign-hub/relay)
PASS relay export @countersign-hub/relay/paywall
PASS relay export @countersign-hub/relay/pay-fetch
PASS relay export @countersign-hub/relay/browser
PASS relay root is not resolvable: Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: No "exports" main defined in .../@countersign-hub/relay/package.json
```

### Gate 4: `--require` still fails for the missing lanes

```
$ bun scripts/release/build.ts --require mcp,cli,relay --out .release
missing required packages: mcp, cli (packages/mcp, packages/cli not found)
exit=1
```

### Gate 5: the staged relay manifest

```json
{
  "name": "@countersign-hub/relay",
  "version": "0.1.0",
  "type": "module",
  "license": "MIT",
  "publishConfig": {
    "access": "public"
  },
  "engines": {
    "node": ">=20"
  },
  "files": [
    "dist"
  ],
  "dependencies": {
    "@circle-fin/x402-batching": "4.0.0",
    "@hashgraph/hedera-agent-kit": "4.2.0",
    "@hashgraph/hedera-agent-kit-mcp": "1.2.0",
    "@hiero-ledger/proto": "2.32.0",
    "@hiero-ledger/sdk": "2.90.1",
    "@modelcontextprotocol/sdk": "1.32.2",
    "@x402/core": "2.30.0",
    "@x402/evm": "2.30.0",
    "@x402/hedera": "2.30.0",
    "ajv": "^8.20.0",
    "hono": "^4.13.16",
    "mppx": "0.17.1",
    "stripe": "23.1.0",
    "viem": "^2.57.16"
  },
  "exports": {
    "./paywall": "./dist/paywall.js",
    "./pay-fetch": "./dist/pay-fetch.js",
    "./browser": "./dist/browser.js"
  }
}
```

`exports` has exactly three keys. No dependency name starts with `@countersign/`.

```
$ grep -c '@countersign/core' .release/stage/relay/dist/*.js
.release/stage/relay/dist/browser.js:0
.release/stage/relay/dist/pay-fetch.js:0
.release/stage/relay/dist/paywall.js:0

$ grep -c 'bun:' .release/stage/relay/dist/*.js
.release/stage/relay/dist/browser.js:0
.release/stage/relay/dist/pay-fetch.js:0
.release/stage/relay/dist/paywall.js:0
```

A merchant imports `@countersign-hub/relay/paywall` (or `.../pay-fetch`, `.../browser`),
not the bare root `@countersign-hub/relay`.

## cs-70c: declare only the packages the bundle imports

### The change

`scripts/release/imports.ts` scans each emitted `.js` file with
`new Bun.Transpiler({ loader: "js" }).scanImports(code)`. Static imports,
side-effect imports, `import("x")` and `require("x")` count; string literals do
not. Each specifier is reduced to its package (`viem/chains` → `viem`,
`@scope/pkg/sub` → `@scope/pkg`, `ajv/dist/2020.js` → `ajv`), and `node:` plus
`module.builtinModules` names are ignored.

`build.ts` runs the scanner over every staged bundle, then keeps only the imported
members of the existing manifest union, with their ranges unchanged. Declared but
unused packages are dropped from `dependencies` (they remain on the `external`
list), keys stay sorted, and an import with no declared range fails the build with
the package and every emitted file that imports it. `build.ts` prints the count
line per package.

`smoke.ts` runs every export import and `bin --help` under both the installed Node
and Node 20 through `npx -y node@20`, tagging each line `[node vX.Y.Z]`.
`--no-node20` prints `SKIP node 20 (--no-node20)`; a failed Node 20 fetch prints
`FAIL node 20: could not obtain node@20` and exits 1.

### Gate 1: install, typecheck, tests

```
$ bun install --linker hoisted && bun run typecheck && bun test scripts/release
bun install v1.3.14 (0d9b296a)

+ @countersign/relay@workspace:packages/relay

3 packages installed [4.94s]
$ tsc -p tsconfig.json
bun test v1.3.14 (0d9b296a)

 54 pass
 0 fail
 98 expect() calls
Ran 54 tests across 8 files. [146.00ms]
```

The original 43 tests are unchanged; eleven new tests cover the scanner kinds, the
ignored `node:`/builtin imports, the non-import string literal, subpath reduction,
an undeclared import, unused-range removal with sorted keys, and a conflicting
range.

### Gate 2: the relay declares two dependencies

```
$ rm -rf .release && bun scripts/release/build.ts --only relay --out .release
relay: "." not published (not on the publish surface: packages/relay/package.json exports it for the workspace)
relay: dependencies 2 of 14 declared: ajv, viem
relay: /Users/sailesh/Developer/countersign-wt/cs-70/.release/countersign-hub-relay-0.1.0.tgz
  size: 8642 bytes
  files:
    dist/browser.js
    dist/pay-fetch.js
    dist/paywall.js
    package.json
```

The staged manifest's `dependencies`:

```json
  "dependencies": {
    "ajv": "^8.20.0",
    "viem": "^2.57.16"
  },
```

Tarball: 8,642 bytes. Dependency count before: 14. After: 2.

### Gate 3: smoke under Node 20 and the installed Node

```
$ bun scripts/release/smoke.ts --dir .release
node --version: v26.7.0
PASS countersign-hub-relay-0.1.0 init: ...
PASS countersign-hub-relay-0.1.0 install: added 19 packages in 11s
node 20 --version: v20.20.2
PASS relay published name: @countersign-hub/relay (expected @countersign-hub/relay)
PASS relay export @countersign-hub/relay/paywall [node v26.7.0]
PASS relay export @countersign-hub/relay/paywall [node v20.20.2]
PASS relay export @countersign-hub/relay/pay-fetch [node v26.7.0]
PASS relay export @countersign-hub/relay/pay-fetch [node v20.20.2]
PASS relay export @countersign-hub/relay/browser [node v26.7.0]
PASS relay export @countersign-hub/relay/browser [node v20.20.2]
PASS relay root is not resolvable [node v26.7.0]: ... ERR_PACKAGE_PATH_NOT_EXPORTED ...
PASS relay root is not resolvable [node v20.20.2]: ... ERR_PACKAGE_PATH_NOT_EXPORTED ...
```

A clean install adds 19 packages, down from 221. `EBADENGINE` warnings remaining: 0.

```
$ bun scripts/release/smoke.ts --dir .release --no-node20
...
SKIP node 20 (--no-node20)
PASS relay export @countersign-hub/relay/paywall [node v26.7.0]
...
```

With a failing `npx`, the second runtime is not skipped silently:

```
FAIL node 20: could not obtain node@20
```

### Gate 4: missing lanes still fail

```
$ bun scripts/release/build.ts --require mcp,cli,relay --out .release-req
missing required packages: mcp, cli (packages/mcp, packages/cli not found)
exit=1
```

`.release-req` was removed afterwards.

### Gate 5: no workspace, Bun or `Bun.` text in the bundles

```
$ grep -c '@countersign/' .release/stage/relay/dist/*.js
.release/stage/relay/dist/browser.js:0
.release/stage/relay/dist/pay-fetch.js:0
.release/stage/relay/dist/paywall.js:0

$ grep -c 'bun:' .release/stage/relay/dist/*.js
.release/stage/relay/dist/browser.js:0
.release/stage/relay/dist/pay-fetch.js:0
.release/stage/relay/dist/paywall.js:0

$ grep -c 'Bun\.' .release/stage/relay/dist/*.js
.release/stage/relay/dist/browser.js:0
.release/stage/relay/dist/pay-fetch.js:0
.release/stage/relay/dist/paywall.js:0
```

## cs-70d: a packed tarball carries no build paths and no source maps

### The change

`scripts/release/leaks.ts` adds the release leak check. `findLeaks(files, environment)` is pure:
it takes the extracted files and the environment strings and returns `{ file, line, kind }`
records. The module also owns the readers: `readTarball` extracts the packed `.tgz` into
`mkdtempSync(join(os.tmpdir(), "countersign-leaks-"))`, and `readDist` reads the staged
`dist/`. Both feed the one `checkFiles` function, so the early and the post-pack checks cannot
drift apart.

The rules:

- Allowed paths are `package.json`, `README*`, `LICENSE*`, and `dist/**` ending in `.js`,
  `.mjs`, `.cjs`, `.d.ts` or `.json`. Any other file fails as `not an allowed file`.
- A file ending `.map` fails as `source map`. Any file whose text holds `sourceMappingURL`
  fails on that line.
- Environment strings: the home directory, the user name, the host name, the repository root
  and `os.tmpdir()` are compared case-sensitively, except the host name, which is
  case-insensitive. The literal fragments `/Users/`, `/home/`, `/private/var`, `/Volumes/`
  and `C:\Users` are always checked. An empty or sub-three-character named string is skipped.
- The failure names the artifact, the file inside it and the line, and prints only the kind.
  It never prints the matched text or the matched line.

`build.ts` calls `checkFiles` once on `stage/<short>/dist` after the Node guard and before
`npm pack`, and once on the real tarball after `npm pack`. The second call prints
`relay: packed files clean (4 files)` with the inspected count.

### Maps: written during the build, removed before packing

`Bun.build` still runs with `sourcemap: "external"` because the Node guard reads the `.map`
files to attribute a violation to its original source. Bun writes them next to the emitted
bundles in `.release/stage/<short>/.bundle/`, never in `dist/`. `moveOutputs` moves only the
`.js` outputs into `dist/`, and the build deletes the whole `.bundle/` tree before `npm pack`.
So the maps are kept in the stage directory only for the guard and are gone by packing time.
The tarball would fail even if that deletion regressed: `files: ["dist"]` keeps `.bundle/`
out, and the allow-list plus the `.map` rule reject a map if one ever reached `dist/`.

### Gate 1: install, typecheck, tests

```
$ bun install --linker hoisted && bun run typecheck
bun install v1.3.14 (0d9b296a)

+ @countersign/relay@workspace:packages/relay

3 packages installed [493.00ms]
$ tsc -p tsconfig.json

$ bun test scripts/release
bun test v1.3.14 (0d9b296a)

 63 pass
 0 fail
 115 expect() calls
Ran 63 tests across 9 files. [161.00ms]
```

The 54 existing tests are unchanged and still pass. Nine new tests cover the clean tarball,
a `.map` file, a `sourceMappingURL` comment, the home directory (the message contains
`home directory` and not `os.homedir()`), `/Users/`, the host name in upper case, `notes.txt`,
`.env`, and empty or one-character user names. The fixtures are real `tar` archives under
`os.tmpdir()` and make no network calls.

### Gate 2: the relay, packed and checked

```
$ rm -rf .release && bun scripts/release/build.ts --only relay --out .release
relay: "." not published (not on the publish surface: packages/relay/package.json exports it for the workspace)
relay: dependencies 2 of 14 declared: ajv, viem
relay: packed files clean (4 files)
relay: .release/countersign-hub-relay-0.1.0.tgz
  size: 8642 bytes
  files:
    dist/browser.js
    dist/pay-fetch.js
    dist/paywall.js
    package.json
```

The tarball path is shortened above; the build printed the absolute path under the output
directory. The four packed files match the allow-list and hold no leak string.

### Gate 3: smoke on the installed Node and Node 20

```
$ bun scripts/release/smoke.ts --dir .release
node --version: v26.7.0
PASS countersign-hub-relay-0.1.0 init: ...
PASS countersign-hub-relay-0.1.0 install: added 19 packages in 9s
node 20 --version: v20.20.2
PASS relay published name: @countersign-hub/relay (expected @countersign-hub/relay)
PASS relay export @countersign-hub/relay/paywall [node v26.7.0]
PASS relay export @countersign-hub/relay/paywall [node v20.20.2]
PASS relay export @countersign-hub/relay/pay-fetch [node v26.7.0]
PASS relay export @countersign-hub/relay/pay-fetch [node v20.20.2]
PASS relay export @countersign-hub/relay/browser [node v26.7.0]
PASS relay export @countersign-hub/relay/browser [node v20.20.2]
PASS relay root is not resolvable [node v26.7.0]: ... ERR_PACKAGE_PATH_NOT_EXPORTED ...
PASS relay root is not resolvable [node v20.20.2]: ... ERR_PACKAGE_PATH_NOT_EXPORTED ...
```

### Gate 4: the negative proof

A throw-away copy of the tarball under `os.tmpdir()` gained `dist/leaked.js` holding the home
directory. The one-line check rejected it:

```
$ TARBALL="$tmp/proof.tgz" bun -e 'import { buildEnvironment, checkFiles, readTarball } from "./scripts/release/leaks.ts"; try { checkFiles(process.env.TARBALL, readTarball(process.env.TARBALL), buildEnvironment()); } catch (error) { console.log(error.message); process.exit(1); }'
release leak check failed for /var/folders/.../countersign-leak-proof-XXXXXX/proof.tgz:
  dist/leaked.js:1: home directory
  dist/leaked.js:1: user name
  dist/leaked.js:1: /Users/
exit=1
```

The message names the kinds and the file and line, and does not contain the path. The copy and
its directory were deleted.

### Gate 5: missing lanes still fail

```
$ bun scripts/release/build.ts --require mcp,cli,relay --out .release-req
missing required packages: mcp, cli (packages/mcp, packages/cli not found)
exit=1
```

`.release-req` was removed afterwards.

### Files

Only `scripts/release/leaks.ts`, `scripts/release/build.ts` and
`scripts/release/test/leaks.test.ts` changed. No package source, root `package.json`,
`bun.lock`, `tsconfig.json`, `.gitignore`, key or env file was touched.

## cs-70e: the real CLI and its child entry

### The changes

`scripts/release/imports.ts` adds `stripShebang`, which removes one leading `#!` line
before `scanImportPackages` calls Bun's transpiler. The scanned file on disk is not
rewritten.

`scripts/release/surface.ts` adds `EXTRA_ENTRIES` and `EXTRA_DEPENDENCIES`. Both are
empty for `relay` and `mcp`; `cli` adds the runner child entry
(`packages/runner/src/child-entry.ts` -> `dist/child-entry.js`) and the published
`@countersign-hub/mcp` dependency from workspace `mcp`. `manifest.ts` adds
`bundleEntries` (the manifest entries plus the extras, with one target-collision
check), `extraDependencyRanges` (`^` plus the source package version, or a skipped
line), and takes the staged Node floor from the source package through `engines.ts`
(`nodeEngine`). `build.ts` builds every entry in one `Bun.build` rooted at the
repository, stages each output at its target, then guards, import-scans and packs it.
Extra dependencies are merged after the scan, so pruning cannot drop them.
`smoke.ts` reads the installed package's `engines.node` (`floorMajor`), runs the
second pass under `npx -y node@<major>`, and checks the CLI's installed
`dist/child-entry.js` with `node -e` and `fs.existsSync`.

### Gate 1: install, typecheck, tests

```
$ bun install --linker hoisted && bun run typecheck
bun install v1.3.14 (0d9b296a)

+ @countersign/relay@workspace:packages/relay

3 packages installed [2.22s]
$ tsc -p tsconfig.json
$ bun test scripts/release
bun test v1.3.14 (0d9b296a)

 74 pass
 0 fail
 141 expect() calls
Ran 74 tests across 10 files. [301.00ms]
```

The 63 tests from cs-70d are unchanged. Eleven new tests cover the shebang scan, the
`relay`/`mcp` empty extras, the `cli` extra entry list and its staging target, the fact
that extras never reach `bin` or `exports`, the extra dependency range, its loud skip
line, its survival after an empty import scan, the source versus default engine, and
the `>=N` floor parser.

### Gate 2: the relay is unchanged

```
$ rm -rf .release && bun scripts/release/build.ts --only relay --out .release
relay: "." not published (not on the publish surface: packages/relay/package.json exports it for the workspace)
relay: dependencies 2 of 14 declared: ajv, viem
relay: packed files clean (4 files)
relay: .release/countersign-hub-relay-0.1.0.tgz
  size: 8642 bytes
  files:
    dist/browser.js
    dist/pay-fetch.js
    dist/paywall.js
    package.json
```

The size and the four files match cs-70d exactly.

```
$ bun scripts/release/smoke.ts --dir .release
node --version: v26.7.0
PASS countersign-hub-relay-0.1.0 init: ...
PASS countersign-hub-relay-0.1.0 install: added 19 packages in 10s
PASS relay published name: @countersign-hub/relay (expected @countersign-hub/relay)
node 20 --version: v20.20.2
PASS relay export @countersign-hub/relay/paywall [node v26.7.0]
PASS relay export @countersign-hub/relay/paywall [node v20.20.2]
PASS relay export @countersign-hub/relay/pay-fetch [node v26.7.0]
PASS relay export @countersign-hub/relay/pay-fetch [node v20.20.2]
PASS relay export @countersign-hub/relay/browser [node v26.7.0]
PASS relay export @countersign-hub/relay/browser [node v20.20.2]
PASS relay root is not resolvable [node v26.7.0]: ... ERR_PACKAGE_PATH_NOT_EXPORTED ...
PASS relay root is not resolvable [node v20.20.2]: ... ERR_PACKAGE_PATH_NOT_EXPORTED ...
```

### Gate 3: the CLI against K2 — blocked by the guard

The refreshed `origin/cs/tr-09` tip (`e3b1c17`) already declares
`"bin": { "countersign": "./src/bin.ts" }`, so the second worktree needed no manifest
edit. It merged the local `cs/cs-70` branch, since nothing is pushed.

```
$ git worktree add --detach "$HOME/Developer/countersign-wt/k3-cli" origin/cs/tr-09
$ cd "$HOME/Developer/countersign-wt/k3-cli" && git merge --no-edit cs/cs-70
$ bun install --linker hoisted && bun scripts/release/build.ts --only cli --out .release
bun install v1.3.14 (0d9b296a)
Saved lockfile

748 packages installed [10.40s]
cli: extra dependency @countersign-hub/mcp skipped (packages/mcp not found)
cli: dependencies 0 of 0 declared: 
Node guard failed for cli:
  .release/stage/cli/dist/bin.js:32564:18 "Bun." (source packages/buyer/src/openai/server.ts)
  packages/runner/src/cli.ts:488:5 "import.meta.main"
  packages/runner/src/child.ts:97:16 "Bun."
Bun-only APIs in package sources are not rewritten by this build.
exit=1
```

The packet says not to edit K2 or runner source when the guard fails, so the gate
stopped there. No CLI tarball was produced, so there is no CLI tarball size or packed
file list to report. The parts before the guard did complete, and they show the extra
entry and engine wiring:

```json
{
  "name": "@countersign-hub/cli",
  "version": "0.1.0",
  "type": "module",
  "license": "MIT",
  "publishConfig": {
    "access": "public"
  },
  "engines": {
    "node": ">=22"
  },
  "files": [
    "dist"
  ],
  "dependencies": {},
  "bin": {
    "countersign": "./dist/bin.js"
  }
}
```

The staged tree before packing:

```
dist/bin.js
dist/child-entry.js
package.json
```

`.bundle/packages/*.map` also exists during the guard and is deleted before packing, so
those three files are the ones `files: ["dist"]` plus npm would have packed. `dependencies`
is empty because `packages/mcp` is absent in that tree and the extra dependency was
skipped with the required line.

The guard named three K2/runner sources: `Bun.spawn` in
`packages/runner/src/child.ts:97`, `import.meta.main` in
`packages/runner/src/cli.ts:488`, and `Bun.serve` in
`packages/buyer/src/openai/server.ts:92` (emitted in `dist/bin.js`). These are findings
for K2's owner; the release tooling did not weaken the guard. Smoke was not run because
there is no CLI tarball.

The worktree was removed afterwards with `git worktree remove --force` and
`git worktree prune`.

### Gate 4: missing lanes still fail

```
$ bun scripts/release/build.ts --require mcp,cli,relay --out .release-req
missing required packages: mcp, cli (packages/mcp, packages/cli not found)
exit=1
```

`.release-req` was removed afterwards.

### Files

Only `scripts/release/imports.ts`, `scripts/release/surface.ts`,
`scripts/release/engines.ts`, `scripts/release/manifest.ts`,
`scripts/release/build.ts`, `scripts/release/smoke.ts` and the tests under
`scripts/release/test/` changed. No package source, root `package.json`, `bun.lock`,
`tsconfig.json`, `.gitignore`, key or env file was touched. The three commits are the
shebang fix, the extra-entry/engine feature, and the tests.

## cs-70f

### What changed

- `build.ts` `guardPackage` now judges only the emitted `.js` files. The
  `sourceFiles()` helper and the second loop that scanned source-map
  `sourcesContent` are gone. The first loop keeps the emitted file, line and column,
  and its `(source <file>)` attribution. No existing test asserted the removed source
  scan, so no assertion had to be removed.
- Attribution now resolves the emitted line and column through the source map with
  `findMappedSource` (`node:module` `SourceMap`) before falling back to the text
  search in `findSourceWithText`. This mattered for the real CLI: both
  `Bun.serve` and `Bun.spawn` are in `dist/bin.js`, and the text search attributed
  both of them to `packages/buyer/src/openai/server.ts`, leaving the child exception
  stale. The mapping attributes the second hit to
  `packages/runner/src/child.ts:97`.
- `surface.ts` adds `GUARD_EXCEPTIONS`, a per-package list of
  `{ source, pattern, reason }`, plus `checkGuardExceptionTable`,
  `guardExceptionsFor`, `findGuardException` and `staleGuardExceptionLines`.
  A hit is excused only when its attributed source and pattern both match. An
  unattributed hit is never excused, and an empty `source`, `pattern` or `reason`
  throws. Every excused hit prints
  `cli: guard exception <source> "<pattern>" (<reason>)`. An exception that excuses
  nothing fails with `stale guard exception for cli: <source> "<pattern>"`.
- The `cli` table has exactly two entries:
  - `packages/runner/src/child.ts`, `"Bun."`: `runWithBun` runs only when
    `globalThis.Bun` is defined; under Node `defaultSpawner` returns `node` and
    `node:child_process` is used.
  - `packages/buyer/src/openai/server.ts`, `"Bun."`: started only by the buyer
    `openai` subcommand, which the `countersign` wrapper does not expose.
  `relay` and `mcp` have none.
- A `cli` build prints plainly:
  `cli: smoke test does not run a sell job through the child spawner; that path is guarded by the runtime check only`.

### Tests

`scripts/release/test/guard-exceptions.test.ts` covers a matching source and pattern,
the same source with a different pattern, the same pattern in a different source, an
unattributed hit, an empty reason, empty source and pattern, a stale exception naming
itself, the shipped table, and `relay`/`mcp` having none. `guard.test.ts` gained one
test for source-map position attribution; its existing tests are unchanged.

```
$ bun install --linker hoisted && bun run typecheck && bun test scripts/release
bun install v1.3.14 (0d9b296a)

+ @countersign/relay@workspace:packages/relay

3 packages installed [3.90s]
$ tsc -p tsconfig.json
bun test v1.3.14 (0d9b296a)

 84 pass
 0 fail
 155 expect() calls
Ran 84 tests across 11 files. [141.00ms]
```

### Gate 2: the relay is unchanged

```
$ rm -rf .release && bun scripts/release/build.ts --only relay --out .release
relay: "." not published (not on the publish surface: packages/relay/package.json exports it for the workspace)
relay: dependencies 2 of 14 declared: ajv, viem
relay: packed files clean (4 files)
relay: .release/countersign-hub-relay-0.1.0.tgz
  size: 8642 bytes
  files:
    dist/browser.js
    dist/pay-fetch.js
    dist/paywall.js
    package.json
```

```
$ bun scripts/release/smoke.ts --dir .release
node --version: v26.7.0
PASS countersign-hub-relay-0.1.0 init: ...
PASS countersign-hub-relay-0.1.0 install: added 19 packages in 2s
PASS relay published name: @countersign-hub/relay (expected @countersign-hub/relay)
node 20 --version: v20.20.2
PASS relay export @countersign-hub/relay/paywall [node v26.7.0]
PASS relay export @countersign-hub/relay/paywall [node v20.20.2]
PASS relay export @countersign-hub/relay/pay-fetch [node v26.7.0]
PASS relay export @countersign-hub/relay/pay-fetch [node v20.20.2]
PASS relay export @countersign-hub/relay/browser [node v26.7.0]
PASS relay export @countersign-hub/relay/browser [node v20.20.2]
PASS relay root is not resolvable [node v26.7.0]: ... ERR_PACKAGE_PATH_NOT_EXPORTED ...
PASS relay root is not resolvable [node v20.20.2]: ... ERR_PACKAGE_PATH_NOT_EXPORTED ...
```

### Gate 3: the CLI, for real

`origin/cs/cs-70` had advanced past this branch's base with the cs-70g packet, while
the cs-70f commits were still local, so the throw-away worktree merged both
`origin/cs/cs-70` and the local `cs/cs-70` branch.

```
$ git fetch origin
$ git worktree add --detach "$HOME/Developer/countersign-wt/k3-cli" origin/cs/tr-09
$ cd "$HOME/Developer/countersign-wt/k3-cli"
$ git merge --no-edit origin/cs/cs-70
$ git merge --no-edit cs/cs-70
$ bun install --linker hoisted
bun install v1.3.14 (0d9b296a)
Saved lockfile

748 packages installed [26.71s]
$ bun scripts/release/build.ts --only cli --out .release
cli: extra dependency @countersign-hub/mcp skipped (packages/mcp not found)
cli: dependencies 0 of 0 declared: 
cli: guard exception packages/buyer/src/openai/server.ts "Bun." (started only by the buyer openai subcommand, which the countersign wrapper does not expose)
cli: guard exception packages/runner/src/child.ts "Bun." (runWithBun runs only when globalThis.Bun is defined; under Node defaultSpawner returns node and node:child_process is used)
cli: packed files clean (3 files)
cli: smoke test does not run a sell job through the child spawner; that path is guarded by the runtime check only
cli: .release/countersign-hub-cli-0.1.0.tgz
  size: 636862 bytes
  files:
    dist/bin.js
    dist/child-entry.js
    package.json
```

The dependencies line says `0 of 0 declared`. The CLI declares no dependencies and
imports its sibling packages by relative path, so the externals list is empty and all
third-party code is inlined. The staged manifest has `"dependencies": {}`.
`dist/bin.js` is 45,796 lines and `dist/child-entry.js` is 40,746 lines: this is a
self-contained CLI tarball, not one with a dependency tree. The packed-file leak check
passed on all three files.

```
$ bun scripts/release/smoke.ts --dir .release
node --version: v26.7.0
PASS countersign-hub-cli-0.1.0 init: ...
PASS countersign-hub-cli-0.1.0 install: added 1 package in 140ms
PASS cli published name: @countersign-hub/cli (expected @countersign-hub/cli)
node 22 --version: v22.23.4
PASS cli bin countersign --help [node v26.7.0]: countersign 0.1.0 Sell. ... Buy. ...
PASS cli bin countersign --help [node v22.23.4]: countersign 0.1.0 Sell. ... Buy. ...
PASS cli child entry dist/child-entry.js [node v26.7.0]
PASS cli child entry dist/child-entry.js [node v22.23.4]
```

The one thing the smoke test does not run is a sell job through the child spawner. It
runs `countersign --help` and checks that `dist/child-entry.js` exists in the install;
the `runWithBun` path is guarded by the `globalThis.Bun` runtime check and the named
exception, not by a smoke run.

The worktree was removed afterwards with `git worktree remove --force` and
`git worktree prune`.

### Gate 4: missing lanes still fail

```
$ bun scripts/release/build.ts --require mcp,cli,relay --out .release-req
missing required packages: mcp, cli (packages/mcp, packages/cli not found)
exit=1
```

`.release-req` was removed afterwards.

### Commits and files

The three commits are the fix (`df39674`, guard the emitted bundle instead of source
map text), the feature (`c6be2d5`, allow named guard exceptions for the CLI), and the
tests (`ba0204b`, test the guard exception table). Only `scripts/release/build.ts`,
`scripts/release/guard.ts`, `scripts/release/surface.ts` and tests under
`scripts/release/test/` changed. No package source, root `package.json`, `bun.lock`,
`tsconfig.json`, `.gitignore`, key or env file was touched.

