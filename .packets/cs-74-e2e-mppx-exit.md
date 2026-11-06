# cs-74-e2e-mppx-exit: mpp finds its pinned binary under either install, and a dead process says how it died

Lane: cs-e2e. Base: `cs/e2e`. Branch: `cs/cs-74`.

## Evidence

1. **mpp, run 20261106-192434-ef79 on main 25e8104.** The step "the named payer pays with the pinned
   mppx" failed with `ENOENT: posix_spawn '$R/packages/rail/node_modules/.bin/mppx'`. That checkout was
   installed with `bun install --linker hoisted`, which puts the binary in the root
   `node_modules/.bin/mppx`. The same sha with the isolated install passed (run 20261106-193656-ac7d).
   The gates install hoisted, so a suite run from a gated checkout fails mpp for no product reason.
2. **arc-deadline-refund, run 20261106-191637-d6d5.** The step "hub up" failed with
   `hub exited before printing /\[hub\] listening on /; last output: ""`. The log was empty even though
   stdout and stderr are both piped, and the message cannot say whether the hub exited with a code or
   was killed by a signal.

## Changes

### `e2e/lib/paths.ts`

Add `export function mppxBin(root: string = ROOT): string`. It returns the first of these paths that
exists:

1. `join(root, "packages/rail/node_modules/.bin/mppx")`, the isolated layout and the rail's pinned
   version;
2. `join(root, "node_modules/.bin/mppx")`, the hoisted layout.

If neither exists, it throws `the pinned mppx binary is not installed under ${root}: run bun install`.
Before throwing, put the root through the existing `redactPaths`.

### `e2e/flows/mpp.flow.ts`

Delete the module-level `const MPPX = ...`. Call `mppxBin()` where `MPPX` was used: the spawn command at
about line 96 and the `Bun.spawn` at about line 112. Nothing may resolve the binary at import time, so
`--list` still works without an install. Change nothing else in the flow.

### `e2e/lib/procs.ts`

When the process has exited, `waitFor` rejects with the same message as now, plus the exit code and the
signal after the pattern:

`${spec.name} exited before printing ${pattern} (exit code ${code}, signal ${signal ?? "none"}); last output: ${tail(...)}`

- Take `code` from `child.exited`, and `signal` from `child.signalCode` once it has exited. Store both
  when `exited` settles.
- The text "exited before printing" stays exactly as it is, so the existing harness test keeps passing.
- The "did not print ... within" message for a timeout does not change.

## Tests (`bun test e2e/test`)

1. `mppxBin(tmp)`:
   - only the hoisted path exists: it returns that path;
   - both exist: it returns the `packages/rail` path;
   - neither exists: it throws the message above.

   Create the fake binaries as empty files in a temp dir.
2. A process that exits with code 3 before printing: the rejection contains
   `(exit code 3, signal none)`.
3. A process that kills itself with SIGKILL before printing, for example
   `["sh", "-c", "kill -9 $$"]`: the rejection contains `signal SIGKILL`.

## Gate (paste the tails)

1. `bun install --linker hoisted && bun run typecheck` clean.
2. `bun test e2e/test` and `bun test e2e/human/test` all pass.
3. `bun run e2e -- --list` lists every flow.

## Constraints

- No browser of any kind on this machine. Do not run any flow (`--list` only); flows move real funds.
- **Never run `git stash`;** use a temporary commit or a second worktree.
- Touch only `e2e/lib/paths.ts`, `e2e/lib/procs.ts`, `e2e/flows/mpp.flow.ts` and `e2e/test/**`. Never
  read or print a key.
- Never push, merge or deploy. Make small present-tense commits on `cs/cs-74`, with no emoji, no
  Co-authored-by and no trailers.
- If something cannot be done as written, stop and say exactly what and why.

## Report

`.packets/reports/cs-74-e2e-mppx-exit.md`: the changes with line ranges, and the gate outputs.
