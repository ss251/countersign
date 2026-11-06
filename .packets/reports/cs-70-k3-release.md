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
