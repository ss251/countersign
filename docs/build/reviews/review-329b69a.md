> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review 329b69a (PR 107, cs/hd-09 with hd-09b, #42): the runner sells MCP tools

Reviewer: cs-w1, secrets and money only. Result: **blockers=0 should-fix=0**. The request covered f118c5e and 53b6996; 329b69a carries both with cs/int merged in.

## Held
- **Where the server runs:** inside the already-scrubbed child (`child-entry.ts` dispatches `runMcp`), whose environment is only `PATH` and a fresh temp `HOME` (`child.ts`). `childEnvironment()` copies that scrubbed environment, so the seller key and every other parent variable never reach third-party code. The daemon never calls `runMcp` itself.
- **`{buyer}`:** only a whole `{buyer}` argument is replaced. The id must match `0.0.N` or `0x` plus 40 hex, or the job is refused before any spawn, so a hub-supplied buyer cannot inject arguments.
- **Command:** a bare name or an absolute path, parsed strictly from the child request. Arguments must be strings.
- **Output:** `{tool, server, package, inputHash, result}`, committed by the slip's `outputHash`. Tool errors are cut to 500 characters, and the child's 30 s and 1 MB ceilings still apply.

## Note
- **Agent Kit bytes are for the buyer to sign, and they are untrusted.** In RETURN_BYTES mode the tool's result is unsigned transaction bytes built for the paying account. No buyer code here signs them, which is right. Whatever does sign them must decode and check them first: payer, recipients, amounts, fee and memo. A seller can return any bytes, and the slip's `outputHash` proves what was returned, not that it is safe. Say so in the offer's summary and in `docs/hedera.md`.
