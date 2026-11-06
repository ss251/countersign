# wc-10c: wc-10 declares everything it imports

Issue: #14. This is a corrective for wc-10 and wc-10b, from orch-cs's rule at 17:21:39Z:
- CI installs isolated;
- every import must be declared by the root or by its own workspace;
- every lane runs one isolated `bun install --frozen-lockfile && bun run typecheck` before READY.

**Design: decided.** cs-wc wrote it on Opus. Implement it exactly as written. If something here cannot work, stop and report; do not choose another mechanism.

**Base:** `origin/cs/wc-10b`, which is wc-10 plus wc-10b.

## What happens now, under the isolated install CI uses

- **`apps/web/server.ts` imports `hono`, and `apps/web` does not declare it.** The root typecheck reaches `server.ts` through `apps/web/test/checkout.test.ts`, and that test also imports `server.ts` at runtime.
- **`examples/whitechain/*.ts` import `@countersign/relay`, `@countersign/relay/browser`, `hono`, `viem` and `viem/accounts`.** `examples/` is not a workspace, so these resolve from the repo root, and the root declares none of them. The root `tsconfig.json` includes `examples`.
- **`apps/web/src` will import `@countersign/relay/browser`.** That is cs-phone's merchant screen, phone-06.

## Decisions

1. **`apps/web/package.json`, in `dependencies`:** add `"@countersign/relay": "workspace:*"`, and `"hono"` with exactly the range `packages/relay/package.json` declares for it.
2. **The root `package.json`, in `devDependencies`:** add `"@countersign/relay": "workspace:*"`, plus `"hono"` and `"viem"`, each with exactly the range `packages/relay/package.json` declares. This mirrors orch-cs's `d0bcc1c`, which declared `scripts/`'s import the same way.
3. **`bun.lock`:**
   - Regenerate it with `bun install --linker hoisted`, and commit it. This packet commits `bun.lock` because the change is the declarations themselves.
   - **No new external package may appear.** `hono` and `viem` must resolve to the versions the lock already holds.
   - Paste `git diff --stat bun.lock` and the changed lines into the report, and confirm that only workspace dependency lines changed.
4. **Nothing else changes.**

## Acceptance

1. **The isolated check, in a second worktree** (never in your main one):

   ```
   git worktree add --detach ../wc-10c-iso HEAD
   cd ../wc-10c-iso
   bun install --frozen-lockfile && bun run typecheck && bun test apps/web/test packages/relay/test examples/whitechain
   cd - && git worktree remove --force ../wc-10c-iso
   ```

   - All green. The live fixture stays skipped.
   - If an install fails with a cache error (`FileNotFound`), run it once more.
2. **The usual gate, in your main worktree:**

   ```
   bun install --linker hoisted && bun run typecheck && bun test && forge test && bun run --cwd apps/web build
   ```

   All green.

## Lease

- The root `package.json`: `devDependencies` only.
- `apps/web/package.json`: `dependencies` only.
- `bun.lock`.

Touch nothing else.

## Constraints

- **No browser** of any kind on this machine.
- **Never run `git stash`.** Use a temporary commit or a second worktree.
- **No network** in tests.
- **Commits:** small, present tense, ending `refs #14`, with no emoji and no `Co-authored-by`.
- Never write the name of any earlier project.

## Stop conditions

Stop if any of these happens:
- a change is needed outside the lease;
- a failure survives three different fixes;
- 20 minutes have passed.

## Report

Write `.packets/reports/wc-10c-declare-imports.md` in your worktree and commit it. Include the lock diff and both acceptance results.
