# cs-70c-release-deps: a tarball declares only the packages its bundle actually imports

Lane: cs-w4. Base: `cs/cs-70` (continue on it). Branch: `cs/cs-70`. Same lease as cs-70 and cs-70b:
`scripts/release/**` only (no package manifest needs to change). Review finding, not a gate failure: the
gate is green, but the built relay is a bad thing to ask a merchant to install.

## The finding (measured on devcube, Node 25)

The three relay entries built by cs-70b import exactly these bare specifiers: `viem`, `viem/accounts`,
`viem/chains`, `viem/ens` and `ajv/dist/2020.js`. That is two packages: **`viem` and `ajv`**.

The staged manifest nevertheless declares **14** dependencies: `@circle-fin/x402-batching`,
`@hashgraph/hedera-agent-kit`, `@hashgraph/hedera-agent-kit-mcp`, `@hiero-ledger/proto`,
`@hiero-ledger/sdk`, `@modelcontextprotocol/sdk`, `@x402/core`, `@x402/evm`, `@x402/hedera`, `ajv`, `hono`,
`mppx`, `stripe`, `viem`. They are the union of the manifests of `@countersign/rail` and friends. A clean
`npm i` of the tarball installed **221 packages** and printed `EBADENGINE` warnings, because
`@hashgraph/hedera-agent-kit` requires a newer Node than the `>=20` the manifest promises. A merchant who
wants a USDT paywall must not install the Hedera agent kit and Stripe.

## What to change

1. **The staged `dependencies` are the packages the emitted bundles really import**, not the union.
   - After bundling a package, scan **every emitted `.js` file** for bare specifiers with
     `new Bun.Transpiler({ loader: "js" }).scanImports(code)` (it returns each import's `kind` and `path`;
     this build script runs under Bun, so using Bun here is fine; the *shipped* files stay Bun-free).
     Count static imports, side-effect imports, dynamic `import("x")` and `require("x")`.
     Do not use a regex: a string literal that merely contains `from "x"` must not count.
   - Reduce each specifier to its package name (`viem/chains` becomes `viem`;
     `@scope/pkg/sub` becomes `@scope/pkg`; `ajv/dist/2020.js` becomes `ajv`). Ignore `node:` specifiers and
     Node builtins (`crypto`, `fs`, and the rest of `module.builtinModules`).
   - The version range for each comes from the existing union of repository manifests (cs-70's code stays
     the *source of versions*; the conflict rule stays: two different ranges for one package still throw
     naming both).
   - **A bundle that imports a package not declared anywhere in the union is a build error** naming the
     package and the emitted file. The shipped tarball must never fail with "cannot find package" at
     runtime.
   - Declared-but-unused union members are dropped from the staged manifest. They stay on the `external`
     list as today (so nothing is inlined by accident).
   - The staged dependency keys are sorted, so the manifest is stable between builds.
2. **Print it.** `build.ts` prints, per package, one line:
   `relay: dependencies 2 of 14 declared: ajv, viem` (imported count, union count, the imported names).
3. **Smoke gets a real Node 20.** `smoke.ts` currently runs on whatever Node is installed. Add: after the
   install, run each export import and each `bin --help` a second time under **Node 20** through
   `npx -y node@20 ...` (the npm `node` package; `npx -y node@20 --version` prints `v20.x` on this machine).
   - It is on by default; `--no-node20` turns it off and then prints `SKIP node 20 (--no-node20)` loudly.
   - If the Node 20 fetch itself fails (offline), print `FAIL node 20: could not obtain node@20` and exit 1,
     never skip silently.
   - Print which Node ran each PASS line (`[node v20.x]`, `[node v25.x]`).
4. **Tests** (extend `scripts/release/test/`, offline; the scanner needs no network):
   - the scanner: a static import, a side-effect import, `import("x")`, `require("x")`, a `node:` import
     and a builtin that are ignored, a string literal containing `from "left-pad"` that is NOT counted,
     subpath reduction for `viem/chains`, `@scope/pkg/sub` and `ajv/dist/2020.js`;
   - undeclared import: throws naming the package and the file;
   - unused declared dependencies are dropped; keys are sorted; a conflicting range still throws;
   - the existing tests are unchanged and pass. Do not weaken any.

## Gate (paste the tails)

1. `bun install --linker hoisted && bun run typecheck` clean; `bun test scripts/release` all pass, with the
   count (it was 43).
2. `rm -rf .release && bun scripts/release/build.ts --only relay --out .release`: the printed line must read
   `relay: dependencies 2 of 14 declared: ajv, viem`. Show the staged manifest's `dependencies` (exactly
   those two) and the tarball size.
3. `bun scripts/release/smoke.ts --dir .release`: every check PASSes **under both Node 20 and the installed
   Node**. Paste the PASS lines with their `[node ...]` tags, and the install line. Report how many packages
   the install added now (it was 221) and whether any `EBADENGINE` warning remains.
4. `bun scripts/release/build.ts --require mcp,cli,relay --out .release-req` still fails naming `mcp` and
   `cli` (delete `.release-req` afterwards).
5. `grep -c` on the built `dist/*.js`: zero `@countersign/`, zero `bun:`, zero `Bun.`.

## Constraints

- **Never run `git stash`.** Touch only `scripts/release/**` (and the report). Never edit another lane's
  source, the root `package.json`, `bun.lock`, `tsconfig.json` or `.gitignore`. No key, no env file.
- Never `npm publish`, `npm login` or `git tag`. `npm pack`, `npm i` of a local tarball and `npx -y node@20`
  are fine.
- Never push, merge or deploy. Small present-tense commits on `cs/cs-70`, no emoji, no Co-authored-by, no
  trailers; commit the code and the tests separately.

## Report

Append a section "cs-70c" to `.packets/reports/cs-70-k3-release.md`: the change, the gate outputs, the
before and after dependency counts, and the number of packages a clean install now adds.
