# cs-72-e2e-project-lead: the suite says "project lead", not "<old title>"

> Published copy: STEER-2245 removes the direct address, so the word this packet replaced is written `<old title>` here.

Lane: cs-e2e. Base: `cs/e2e`. Branch: `cs/cs-72`. STEER-2245 says the published copies use "the project
lead", never "the <old title>". The suite's reason strings and `docs/e2e.md` still say "<old title>", and every
new run record prints those reasons.

## Change

In exactly these files, replace every case-insensitive occurrence of `<old title>` with `project lead`, and
keep the grammar right:

| file | what |
|---|---|
| `e2e/flows/arc-gateway.flow.ts` | the `notRun` reason |
| `e2e/flows/public-gateway.flow.ts` | the `notRun` reason |
| `e2e/flows/hedera.flow.ts` | the `notRun` reason |
| `e2e/flows/public-hedera.flow.ts` | the `notRun` reason |
| `e2e/flows/hedera-mcp.flow.ts` | the `notRun` reason |
| `e2e/flows/hedera-held.flow.ts` | the check message about plain x402 Hedera |
| `e2e/flows/web.flow.ts` | three comments |
| `e2e/test/harness.test.ts` | the `RETIRED` constant, so it still equals the flows' reason |
| `docs/e2e.md` | the flow table rows and the paragraphs that cite the flag |

Examples: `(<old title>, 23:40 IST)` becomes `(project lead, 23:40 IST)`. "The <old title> cut" becomes "The
project lead cut". "when the <old title> approves" becomes "when the project lead approves". "Cut by the
<old title>" becomes "Cut by the project lead".

Change no other word. The records under `e2e/runs/` and `e2e/human/runs/` stay exactly as they are,
because they are what each run printed.

## Gate (paste the tails)

1. `bun install --linker hoisted && bun run typecheck` clean.
2. `bun test e2e/test` and `bun test e2e/human/test` all pass.
3. `bun run e2e -- --list` shows the five retired flows with `(project lead, 23:40 IST)`.
4. `grep -rni <old title> e2e/flows e2e/lib e2e/test e2e/run.ts e2e/human/lib e2e/human/tests e2e/human/test docs/e2e.md`
   prints nothing.
5. `git diff --stat origin/cs/e2e` lists only the nine files above.

## Constraints

- No browser of any kind on this machine. Do not run any flow (`--list` only).
- **Never run `git stash`;** use a temporary commit or a second worktree.
- Touch only the nine files above. Never read or print a key.
- Never push, merge or deploy. Make one small present-tense commit on `cs/cs-72`, with no emoji, no
  Co-authored-by and no trailers.
- If something cannot be done as written, stop and say exactly what and why.

## Report

`.packets/reports/cs-72-e2e-project-lead.md`: the files changed, and the gate outputs.
