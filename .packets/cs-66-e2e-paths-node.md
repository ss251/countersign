# cs-66-e2e-paths-node: e2e/lib/paths.ts loads under Node, so the human run starts

Lane: cs-e2e. Base: `cs/e2e`. Branch: `cs/cs-66`. URGENT: this blocks the captain's production
acceptance run.

## The bug

`e2e/lib/paths.ts:6` is `export const ROOT = resolve(import.meta.dir, "..", "..");`. `import.meta.dir`
exists only under Bun. The human acceptance run executes under Node, through Playwright's runner, and
`e2e/human/lib/report.ts` imports `e2e/lib/paths.ts` since cs-64. Loading the Playwright config
therefore fails before any test:
`TypeError: The "paths[0]" argument must be of type string. Received undefined at e2e/lib/paths.ts:6`.

## The fix (exactly this)

In `e2e/lib/paths.ts`:

- add `import { fileURLToPath } from "node:url";`
- change line 6 to
  `export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");`.
  `dirname` is already imported.

Nothing else in the file changes. Both Bun and Node support `import.meta.url`, so the suite under Bun
behaves exactly as before.

Then search `e2e/lib` and `e2e/human` for any other `import.meta.dir` or `import.meta.path`, and any
`Bun.` use in a module that `e2e/human` imports, directly or indirectly. Report each one you find. Fix it
the same way if it is `import.meta.dir` or `import.meta.path`. Otherwise stop and report it.

## Gate (all four; paste the tails)

1. `bun install --linker hoisted && bun run typecheck` clean.
2. `bun test e2e/test` and `bun test e2e/human/test` all pass.
3. **Under Node:** `cd e2e && npx playwright test -c human/playwright.config.ts --list` lists the two
   tests. This is the check that failed; it must pass.
4. `bun run e2e -- --list` lists every flow, under Bun, as before.

## Constraints

- No browser of any kind on this machine: `--list` only, never a test run, no `playwright install`.
- **Never run `git stash`;** use a temporary commit or a second worktree.
- Touch only `e2e/lib/paths.ts`, and any file the search above finds. Never read or print a key.
- Never push, merge or deploy. One small present-tense commit on `cs/cs-66`, with no emoji, no
  Co-authored-by and no trailers.

## Report

`.packets/reports/cs-66-e2e-paths-node.md`: the change, what the search found, and the gate outputs.
