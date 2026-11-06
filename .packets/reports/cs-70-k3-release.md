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
