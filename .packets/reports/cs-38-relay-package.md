# cs-38-relay-package

Branch `cs/38-relay-package`. Repository manifests keep `workspace:*`. Only `scripts/release/pack.ts` rewrites `@countersign/*` dependencies, and only inside the tarballs.

## Diff summary

```
.gitignore                  |  2 ++
packages/core/package.json  | 17 +++++++++++++++--
packages/rail/package.json  | 17 +++++++++++++++--
packages/relay/package.json | 24 +++++++++++++++++++++---
packages/relay/README.md    | new
scripts/release/pack.ts     | new
```

In `packages/core`, `packages/rail` and `packages/relay`:

- dropped `"private": true`
- `"version": "0.1.0"`
- `"license": "MIT"`
- `"repository"` points at `https://github.com/ss251/countersign.git` with `directory` `packages/<name>`
- `"files"` is `src/**`, plus `README.md` on the relay, with negations for tests, `.env*` and fixtures
- dependency specifiers are unchanged, including `workspace:*`

Core and rail `exports` are unchanged. Relay keeps `"."` and adds `"./paywall"` and `"./pay-fetch"`. No `"./browser"`.

`.gitignore` adds `.release/` and `.release-test/`. No tarball is committed.

`packages/relay/README.md` has `## Install (v0.1.0, from the GitHub release)` with the one `bun add` of the relay tarball, one import each of `whitechainPaywall` and `createPayFetch`, and the sentence that 0.1.0 ships TypeScript source for Bun or a TypeScript-aware bundler, is not on npm, and does not support Node without a bundler.

## Test pack (`--base http://127.0.0.1:8799 --out .release-test`)

```
/Users/sailesh/Developer/countersign-wt/cs-38/.release-test/countersign-core-0.1.0.tgz
{
  "ajv": "^8.20.0",
  "viem": "^2.57.16"
}
/Users/sailesh/Developer/countersign-wt/cs-38/.release-test/countersign-rail-0.1.0.tgz
{
  "@circle-fin/x402-batching": "4.0.0",
  "@countersign/core": "http://127.0.0.1:8799/countersign-core-0.1.0.tgz",
  "@hashgraph/hedera-agent-kit": "4.2.0",
  "@hashgraph/hedera-agent-kit-mcp": "1.2.0",
  "@hiero-ledger/proto": "2.32.0",
  "@hiero-ledger/sdk": "2.90.1",
  "@modelcontextprotocol/sdk": "1.32.2",
  "@x402/core": "2.30.0",
  "@x402/evm": "2.30.0",
  "@x402/hedera": "2.30.0",
  "mppx": "0.17.1",
  "stripe": "23.1.0",
  "viem": "^2.57.16"
}
/Users/sailesh/Developer/countersign-wt/cs-38/.release-test/countersign-relay-0.1.0.tgz
{
  "@countersign/core": "http://127.0.0.1:8799/countersign-core-0.1.0.tgz",
  "@countersign/rail": "http://127.0.0.1:8799/countersign-rail-0.1.0.tgz",
  "hono": "^4.13.16",
  "viem": "^2.57.16"
}
```

`tar -tzf` — nothing under `test/`, no `.env`, no fixture. Every entry is `package/src/…`, `package/package.json`, or `package/README.md`.

### countersign-core-0.1.0.tgz

```
package/
package/package.json
package/src/
package/src/schema.ts
package/src/envelope.ts
package/src/approval.ts
package/src/canonical.ts
package/src/wire.ts
package/src/countersign.ts
package/src/types.ts
package/src/slip.ts
package/src/index.ts
package/src/amount.ts
package/src/offer.ts
package/src/ens.ts
```

```json
{
  "name": "@countersign/core",
  "version": "0.1.0",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/ss251/countersign.git",
    "directory": "packages/core"
  },
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "files": [
    "src/**",
    "!src/**/test/**",
    "!src/**/*.test.ts",
    "!**/.env*",
    "!**/fixtures/**",
    "!**/fixtures.*"
  ],
  "dependencies": {
    "ajv": "^8.20.0",
    "viem": "^2.57.16"
  }
}
```

### countersign-rail-0.1.0.tgz

```
package/
package/package.json
package/src/
package/src/whitechain/
package/src/eip3009/
package/src/router.ts
package/src/hedera/
package/src/mpp/
package/src/escrow/
package/src/rail.ts
package/src/index.ts
package/src/gateway/
package/src/gateway/payer.ts
package/src/gateway/client.ts
package/src/gateway/index.ts
package/src/escrow/abi.ts
package/src/escrow/index.ts
package/src/escrow/abi-v2.ts
package/src/mpp/mock.ts
package/src/mpp/mppx.ts
package/src/mpp/types.ts
package/src/mpp/constants.ts
package/src/mpp/client.ts
package/src/mpp/rail.ts
package/src/mpp/index.ts
package/src/hedera/facilitator.ts
package/src/hedera/schedule.ts
package/src/hedera/agent-kit-mcp.ts
package/src/hedera/txid.ts
package/src/hedera/inspect.ts
package/src/hedera/constants.ts
package/src/hedera/held.ts
package/src/hedera/memo.ts
package/src/hedera/rail.ts
package/src/hedera/index.ts
package/src/hedera/mcp-schema.ts
package/src/hedera/sdk.ts
package/src/hedera/mirror.ts
package/src/hedera/wallet-paid.ts
package/src/eip3009/index.ts
package/src/whitechain/index.ts
```

```json
{
  "name": "@countersign/rail",
  "version": "0.1.0",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/ss251/countersign.git",
    "directory": "packages/rail"
  },
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./hedera": "./src/hedera/index.ts",
    "./mpp": "./src/mpp/index.ts"
  },
  "files": [
    "src/**",
    "!src/**/test/**",
    "!src/**/*.test.ts",
    "!**/.env*",
    "!**/fixtures/**",
    "!**/fixtures.*"
  ],
  "dependencies": {
    "@circle-fin/x402-batching": "4.0.0",
    "@countersign/core": "http://127.0.0.1:8799/countersign-core-0.1.0.tgz",
    "@hashgraph/hedera-agent-kit": "4.2.0",
    "@hashgraph/hedera-agent-kit-mcp": "1.2.0",
    "@hiero-ledger/proto": "2.32.0",
    "@hiero-ledger/sdk": "2.90.1",
    "@modelcontextprotocol/sdk": "1.32.2",
    "@x402/core": "2.30.0",
    "@x402/evm": "2.30.0",
    "@x402/hedera": "2.30.0",
    "mppx": "0.17.1",
    "stripe": "23.1.0",
    "viem": "^2.57.16"
  }
}
```

### countersign-relay-0.1.0.tgz

```
package/
package/README.md
package/package.json
package/src/
package/src/merchant-server.ts
package/src/refund.ts
package/src/pay-fetch.ts
package/src/reconcile.ts
package/src/escrow-ops.ts
package/src/whitechain-config.ts
package/src/exact.ts
package/src/eip3009.ts
package/src/ledger.ts
package/src/ports.ts
package/src/relayer.ts
package/src/countersign-scheme.ts
package/src/chain.ts
package/src/index.ts
package/src/paywall.ts
package/src/ceiling.ts
package/src/config.ts
package/src/server.ts
package/src/merchant.ts
```

```json
{
  "name": "@countersign/relay",
  "version": "0.1.0",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/ss251/countersign.git",
    "directory": "packages/relay"
  },
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./paywall": "./src/paywall.ts",
    "./pay-fetch": "./src/pay-fetch.ts"
  },
  "files": [
    "src/**",
    "README.md",
    "!src/**/test/**",
    "!src/**/*.test.ts",
    "!**/.env*",
    "!**/fixtures/**",
    "!**/fixtures.*"
  ],
  "scripts": {
    "start": "bun run src/server.ts",
    "merchant": "bun run src/merchant-server.ts"
  },
  "dependencies": {
    "@countersign/core": "http://127.0.0.1:8799/countersign-core-0.1.0.tgz",
    "@countersign/rail": "http://127.0.0.1:8799/countersign-rail-0.1.0.tgz",
    "hono": "^4.13.16",
    "viem": "^2.57.16"
  }
}
```

Every version is `0.1.0`. Rail's `@countersign/core` and relay's `@countersign/core` and `@countersign/rail` are `http://127.0.0.1:8799/…tgz`. `rg workspace:` over the three manifests prints nothing.

## Default pack (GitHub release URLs)

`bun scripts/release/pack.ts` writes the same file lists as the test pack (same paths, same absence of `test/`, `.env` and fixtures). The manifests differ only in the `@countersign/*` URLs.

Relay `package/package.json`:

```json
{
  "name": "@countersign/relay",
  "version": "0.1.0",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/ss251/countersign.git",
    "directory": "packages/relay"
  },
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./paywall": "./src/paywall.ts",
    "./pay-fetch": "./src/pay-fetch.ts"
  },
  "files": [
    "src/**",
    "README.md",
    "!src/**/test/**",
    "!src/**/*.test.ts",
    "!**/.env*",
    "!**/fixtures/**",
    "!**/fixtures.*"
  ],
  "scripts": {
    "start": "bun run src/server.ts",
    "merchant": "bun run src/merchant-server.ts"
  },
  "dependencies": {
    "@countersign/core": "https://github.com/ss251/countersign/releases/download/v0.1.0/countersign-core-0.1.0.tgz",
    "@countersign/rail": "https://github.com/ss251/countersign/releases/download/v0.1.0/countersign-rail-0.1.0.tgz",
    "hono": "^4.13.16",
    "viem": "^2.57.16"
  }
}
```

Core dependencies stay `ajv` and `viem`. Rail's `@countersign/core` is `https://github.com/ss251/countersign/releases/download/v0.1.0/countersign-core-0.1.0.tgz`. No `workspace:`.

Printed rewritten dependencies:

```
.release/countersign-core-0.1.0.tgz
{
  "ajv": "^8.20.0",
  "viem": "^2.57.16"
}
.release/countersign-rail-0.1.0.tgz
{
  "@circle-fin/x402-batching": "4.0.0",
  "@countersign/core": "https://github.com/ss251/countersign/releases/download/v0.1.0/countersign-core-0.1.0.tgz",
  "@hashgraph/hedera-agent-kit": "4.2.0",
  "@hashgraph/hedera-agent-kit-mcp": "1.2.0",
  "@hiero-ledger/proto": "2.32.0",
  "@hiero-ledger/sdk": "2.90.1",
  "@modelcontextprotocol/sdk": "1.32.2",
  "@x402/core": "2.30.0",
  "@x402/evm": "2.30.0",
  "@x402/hedera": "2.30.0",
  "mppx": "0.17.1",
  "stripe": "23.1.0",
  "viem": "^2.57.16"
}
.release/countersign-relay-0.1.0.tgz
{
  "@countersign/core": "https://github.com/ss251/countersign/releases/download/v0.1.0/countersign-core-0.1.0.tgz",
  "@countersign/rail": "https://github.com/ss251/countersign/releases/download/v0.1.0/countersign-rail-0.1.0.tgz",
  "hono": "^4.13.16",
  "viem": "^2.57.16"
}
```

## Clean install

`PATH` `bun` is **1.3.14**. That Bun downloads and extracts all three tarballs, then fails because `@countersign/core`'s URL is both a direct dependency of relay and a transitive dependency through rail. Installing rail alone (one edge) succeeds on 1.3.14. A wrapper whose only dependencies are those two same URLs fails the same way. Bun 1.4.4 resolves the diamond.

Full error, after `bun pm cache rm`, empty temp project, `bun init -y`, then `bun add --no-cache` of the relay URL, Bun 1.3.14:

```
bun add v1.3.14 (0d9b296a)
Resolving dependencies
Resolved, downloaded and extracted [786]
error: @countersign/core@http://127.0.0.1:8799/countersign-core-0.1.0.tgz failed to resolve
```

Exit code 1.

The passing install uses Bun 1.4.4 (`bun-v1.4.4` darwin-aarch64). Same tarballs, served by `python3 -m http.server 8799 --bind 127.0.0.1 --directory .release-test`. Fresh directory `/tmp/cs-38-relay-proof`, outside the repository. Only the relay URL was added.

```
bun install v1.4.4 (38afee6c8)
Saved lockfile

+ @types/bun@1.4.4
+ typescript@7.0.2

6 packages installed [52.00ms]

bun add v1.4.4 (38afee6c8)
Resolving dependencies
Resolved, downloaded and extracted [382]
Saved lockfile

installed @countersign/relay@http://127.0.0.1:8799/countersign-relay-0.1.0.tgz

207 packages installed [2.56s]

Blocked 1 postinstall. Run `bun pm untrusted` for details.
whitechainPaywall function
createPayFetch function
===== bun pm ls =====
/private/tmp/cs-38-relay-proof node_modules (222 installed)
├── @countersign/relay@http://127.0.0.1:8799/countersign-relay-0.1.0.tgz
├── @types/bun@1.4.4
└── typescript@7.0.2
```

`check.ts` imports `whitechainPaywall` from `@countersign/relay/paywall` and `createPayFetch` from `@countersign/relay/pay-fetch`, and prints `typeof` of each. Both are `function`.

`bun pm ls` lists the root. `bun pm ls --all` also lists the transitive packages:

```
├── @countersign/core@http://127.0.0.1:8799/countersign-core-0.1.0.tgz
├── @countersign/rail@http://127.0.0.1:8799/countersign-rail-0.1.0.tgz
├── @countersign/relay@http://127.0.0.1:8799/countersign-relay-0.1.0.tgz
```

Installed `package.json` versions are all `0.1.0`. Rail depends on core at the core tarball URL. Relay depends on core and rail at their tarball URLs. No `workspace:` remains. The server was stopped and `/tmp/cs-38-relay-proof` was deleted.

## Acceptance

`bun install --linker hoisted` then `bun run typecheck && bun test && forge test`. All exit 0.

- `tsc -p tsconfig.json` prints nothing
- `bun test`: 1262 pass, 3 skip, 0 fail, 4641 expect() calls, 1265 tests across 154 files
- `forge test`: 5 suites, 47 tests passed, 0 failed, 0 skipped

The three skipped tests are the Arc testnet fifth-check cases in the human e2e suite. No test was edited.
