# cs-64-e2e-paths: run records never carry a local path

Lane: cs-e2e. Base: `cs/cs-60` (PR #200, which carries `e2e/human`). Branch: `cs/cs-64`. STEER-2245: the repository is public, and no file in it
carries local machine details. Run 20261106-131603-9c9f's record had a home path inside a captured stack
trace. It has been scrubbed by hand (9fb1eae); this packet makes the suite do it for every record.

## The change

In `e2e/lib/secrets.ts`, `Secrets.redact(text)` is applied to every log line and report the suite writes.
Extend it, after its current secret redaction, with two path rewrites, in this order:

1. The repository root becomes `$R`. Take the root from `e2e/lib/paths.ts` (`ROOT`), resolved with
   `realpathSync`, and replace every occurrence of `ROOT + "/"` with `$R/`. Also replace the worktree
   parent: the directory that holds `ROOT` when its parent's name ends in `-wt`. Its occurrences followed
   by `/<name>/` become `$R/`.
2. The home directory becomes `~`: replace every occurrence of `os.homedir()` that is followed by `/` or
   ends the text.

Apply the same two rewrites in `e2e/human/lib/report.ts` wherever it writes the human report and its
text artifacts.

## Tests (`bun test e2e/test` and `bun test e2e/human/test`)

- A stack-trace-shaped string containing `<ROOT>/e2e/lib/hedera.ts:85` comes out as
  `$R/e2e/lib/hedera.ts:85`.
- A string containing `<homedir>/.config/countersign/e2e.env` comes out as
  `~/.config/countersign/e2e.env`.
- A sibling worktree path `<parent-wt>/cs-60/e2e/x.ts` comes out as `$R/e2e/x.ts`.
- Text with no path is unchanged, and secret redaction still applies first.

## Gate

1. `bun install --linker hoisted && bun run typecheck` clean.
2. `bun test e2e/test` and `bun test e2e/human/test` all pass.
3. `bun run e2e -- --list` lists every flow.

## Constraints

- No browser of any kind on this machine. Do not run any flow: `--list` only.
- **Never run `git stash`;** use a temporary commit or a second worktree.
- Touch only `e2e/lib/secrets.ts`, `e2e/lib/paths.ts` if needed, `e2e/human/lib/report.ts`, and their tests.
  Never read or print a real key.
- Never push, merge or deploy. Small present-tense commits on `cs/cs-64`, with no emoji, no
  Co-authored-by and no trailers.
- If something cannot be done as written, stop and say exactly what and why.

## Report

`.packets/reports/cs-64-e2e-paths.md`: the change, line ranges, and the gate outputs.
