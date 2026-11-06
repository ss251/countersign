# tr-14: the buyer CLI never asks for a private key (refs #246)

**Design: decided.** cs-truth wrote this on Opus for the firstmate's no-key-asks principle (STEER 21:13:22Z) and cs-w1's gate (21:14:41Z), which assigns these two hits to cs-truth. Implement exactly what follows.

## Decision: `packages/buyer/src/cli.ts`, two lines only

1. Replace the line
   `  if (!key) throw new Error("Set CS_BUYER_KEY to the agent's private key.");`
   with
   `  if (!key) throw new Error("Not signed in. Run: npx -y @countersign-hub/cli login");`
2. Replace the line
   `    console.log("Flags: --hub <url> --state <dir>. The agent key comes from CS_BUYER_KEY.");`
   with
   `    console.log("Flags: --hub <url> --state <dir>.");`

The line that reads `process.env.CS_BUYER_KEY` stays, as the undocumented CI override. Nothing else changes.

## Lease

`packages/buyer/src/cli.ts`: the two lines above. Never commit `bun.lock`.

## Constraints

- No browser. No network in tests. Never print a key. Never run `git stash`.
- Never edit, weaken, skip or delete a test.
- One commit, `the buyer CLI says how to sign in and never asks for a private key (refs #246)`, with no emoji and no `Co-authored-by`.
- Never write the name of any earlier project.

## Acceptance

```
bun install --linker hoisted && bun run typecheck && bun test && forge test
! grep -n -E "CS_BUYER_KEY|private key" packages/buyer/src/cli.ts | grep -v "process.env.CS_BUYER_KEY"
```

All green. The second command prints nothing.

## Stop conditions

Stop if a quoted line differs from the file, if a test fails, or after 10 minutes.

## Report

Write `~/Developer/countersign-mac/reports/tr-14-buyer-no-key-text.md` (on the MacBook): the diff and the gate counts.
