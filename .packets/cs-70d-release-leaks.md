# cs-70d-release-leaks: a packed tarball must carry no build paths and no source maps

Lane: cs-w4. Base: `cs/cs-70` (continue on it). Branch: `cs/cs-70`. Lease as before: `scripts/release/**`
only. This answers orch-cs's review of #253 (should-fix 1): `Bun.build` with `sourcemap: "external"` writes
`.map` files whose `sources` and `sourcesContent` normally carry absolute build paths, and a published
copy must not hold a local path, a home directory or a machine name.

## Where it stands today

The built relay tarball is clean (checked: four files, no `.map`, no `sourceMappingURL`, no `/Users/`, home
directory, host name or user name in any file). That is true by accident of how the build removes its maps,
not by a rule. Make it a rule that fails the build.

## What to change

1. **A post-pack check**, in a new small module `scripts/release/leaks.ts` (pure, so it can be tested), called
   by `build.ts` **after `npm pack`**, on the real `.tgz`:
   - Extract the tarball to a temporary directory under `os.tmpdir()` and list every file.
   - **Allowed files only:** `package.json`, `README*`, `LICENSE*`, and anything under `dist/` that ends in
     `.js`, `.mjs`, `.cjs`, `.d.ts` or `.json`. Any other file fails the build, naming the file.
   - **No source maps:** any file ending `.map`, and any file containing `sourceMappingURL`, fails.
   - **No build-environment strings** in any file's text: the current user's home directory
     (`os.homedir()`), the current user name (`os.userInfo().username`), the host name (`os.hostname()`), the
     repository root (the absolute path of this checkout), the temporary directory prefix used by the build,
     and the literal patterns `/Users/`, `/home/`, `/private/var`, `/Volumes/`, `C:\Users`. Skip a string
     that is empty or shorter than 3 characters so a short user name cannot match everything; for the
     patterns above that is not needed.
   - A failure names the **tarball, the file inside it and the line number**, and prints which *kind* of
     string matched (`home directory`, `host name`, `/Users/`, and so on) **but never the matched text or
     the line**, so the failing log does not itself leak the path.
   - Compare case-sensitively, except for the host name (case-insensitive).
2. **The staged directory** also gets the same check on `dist/` before packing, so a leak is caught early;
   both calls use the same function.
3. **Do not change the sourcemap setting** unless you must; if the guard needs the maps for source
   attribution, keep them in the stage directory and make sure `files: ["dist"]` plus the allow-list above
   keep them out of the tarball. State in the report which it is.
4. **Tests** (`scripts/release/test/leaks.test.ts`, offline): build small fixture tarballs with `tar` under
   `os.tmpdir()` and check the pure function on each:
   - a clean tarball passes;
   - a `.map` file fails, naming it;
   - a `.js` containing `//# sourceMappingURL=` fails;
   - a file containing the current home directory fails, with the kind `home directory` and **without** the
     path in the message (assert the message does not contain `os.homedir()`);
   - one containing `/Users/` fails; one containing the host name fails case-insensitively;
   - an extra file (`notes.txt`, `.env`) fails as not allowed;
   - an empty or one-character user name does not match everything.
   Do not weaken or edit any existing test.

## Gate (paste the tails)

1. `bun install --linker hoisted && bun run typecheck` clean; `bun test scripts/release` all pass, with the
   count (it was 54).
2. `rm -rf .release && bun scripts/release/build.ts --only relay --out .release` still produces
   `countersign-hub-relay-0.1.0.tgz` and prints one line `relay: packed files clean (4 files)` (use the real
   count).
3. `bun scripts/release/smoke.ts --dir .release` still passes on Node 20 and the installed Node.
4. **The negative proof:** make a throw-away copy of the tarball in `os.tmpdir()` with a file added that
   contains your home directory, run the leak check on it through a one-line `bun -e`, and paste that it
   fails with the kind and **not** the path. Delete the copy.
5. `bun scripts/release/build.ts --require mcp,cli,relay --out .release-req` still fails naming `mcp` and
   `cli`; delete `.release-req`.

## Constraints

- **Never run `git stash`.** Touch only `scripts/release/**` (and the report). Never edit another lane's
  source, the root `package.json`, `bun.lock`, `tsconfig.json` or `.gitignore`. No key, no env file. Never
  print a home directory, user name or host name into a file, a commit message or the report; say "the
  home directory".
- Never `npm publish`, `npm login` or `git tag`.
- Never push, merge or deploy. Small present-tense commits on `cs/cs-70`, no emoji, no Co-authored-by, no
  trailers; commit the code and the tests separately.

## Report

Append a section "cs-70d" to `.packets/reports/cs-70-k3-release.md`: the change, the gate outputs, and
whether the maps are kept in the stage directory or never written.
