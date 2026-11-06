# cs-70b-release-surface: publish only the Node-safe surface of a package (corrective for cs-70)

Lane: cs-w4. Base: `cs/cs-70` (continue on it). Branch: `cs/cs-70`. Same lease as cs-70:
`scripts/release/**`, plus a package's `package.json` `files`, `bin` and `exports` only (and you will not need
the second part). This is the single corrective packet; the report from cs-70 is
`.packets/reports/cs-70-k3-release.md`.

## The finding (reproduced on devcube, Node 25)

`bun scripts/release/build.ts --only relay --out .release` fails the Node guard, correctly:
`packages/relay/src/index.ts` (the `.` export) re-exports the relay *service*, so the bundle contains
`bun:sqlite` (`ledger.ts`), `Bun.serve` and `import.meta.main` (`server.ts`, `merchant-server.ts`). That
service is a Bun program and is not part of what a merchant installs.

The three subpath exports are Node-clean. Checked directly, bundling each alone for Node:
`./paywall` (12 KB), `./pay-fetch` (14 KB) and `./browser` (21 KB) contain no `bun:`, `Bun.` or
`import.meta.main|dir|path`.

Do not edit `packages/relay/src/**`: it is cs-wc's. The guard stays exactly as strict as it is.

## What to change

1. **A publish surface per package**, in one small module `scripts/release/surface.ts`: a table from the
   short name (`mcp`, `cli`, `relay`) to an optional **allowlist of `exports` keys that are published**.
   - `relay`: `["./paywall", "./pay-fetch", "./browser"]`.
   - `mcp` and `cli`: no entry, which means "publish everything the package's own `exports` and `bin`
     declare" (as today).
   - A package with no table entry behaves exactly as before.
2. **Entry discovery** (`manifest.ts`) takes the table into account: when an allowlist exists, only the
   `exports` keys on it are bundled and appear in the staged `exports`. `bin` is unaffected.
3. **Loud about what is left out.** For every `exports` key of the repository manifest that is not
   published, `build.ts` prints one line:
   `relay: "." not published (not on the publish surface: packages/relay/package.json exports it for the workspace)`.
   If an allowlisted key is **absent** from the package's `exports`, that is an error naming the key (the
   surface must never promise something that does not exist).
4. **Smoke** (`smoke.ts`) already imports every key of the *staged* `exports`, so it follows. Add one
   explicit check for the relay: the installed package must **not** resolve `@countersign-hub/relay` (the
   bare root); `node --input-type=module -e "await import('@countersign-hub/relay')"` must fail with
   `ERR_PACKAGE_PATH_NOT_EXPORTED`. Print PASS when it does.
5. **Tests** (extend `scripts/release/test/`, offline, no real build):
   - the allowlist filters entries and staged exports, and keeps `bin`;
   - an allowlist key missing from the manifest `exports` throws and names it;
   - no table entry means everything is published;
   - the "not published" line is produced for each omitted key;
   - the existing guard tests are unchanged and still pass.

No existing test is edited to make it pass; add tests, do not weaken any.

## Gate (paste the tails)

1. `bun install --linker hoisted && bun run typecheck` clean.
2. `bun test scripts/release` all pass; give the count (it was 38).
3. **The relay, for real:** `rm -rf .release && bun scripts/release/build.ts --only relay --out .release`
   produces `.release/countersign-hub-relay-0.1.0.tgz` and prints the "`.` not published" line. Then
   `bun scripts/release/smoke.ts --dir .release` under Node 20+ passes every check, including the
   "root is not resolvable" check. Paste `node --version`, the build output, the tarball size and file list,
   and every PASS line.
4. `bun scripts/release/build.ts --require mcp,cli,relay --out .release` still fails and names `mcp` and
   `cli` as missing.
5. Show the staged relay manifest: name `@countersign-hub/relay`, `exports` has exactly three keys, no
   dependency starts with `@countersign/`. Show with `grep -c` that the built `dist/*.js` has no
   `@countersign/core` specifier and no `bun:`.

## Constraints

- **Never run `git stash`.** Do not edit `packages/relay/src/**` or any other lane's source, the root
  `package.json`, `bun.lock`, `tsconfig.json` or `.gitignore`. Never read or print a key or env file.
- Never run `npm publish`, `npm login` or `git tag`. `npm pack` and `npm i` of a local tarball are fine.
- Never push, merge or deploy. Small present-tense commits on `cs/cs-70` with no emoji, no Co-authored-by
  and no trailers; commit the code and the tests separately.

## Report

Append a section "cs-70b" to `.packets/reports/cs-70-k3-release.md`: the change, the gate outputs, and one
line saying what `import` a merchant must now use (`@countersign-hub/relay/paywall`, not the root).
