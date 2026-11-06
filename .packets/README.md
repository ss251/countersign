# Packets

A packet is one unit of work for one worker in one worktree. File name: `<lane>-<nn>-<slug>.md`, where lane is `cs`, `wc`, `hd` or `ui`.

Every packet has these sections:

1. **Goal** — the outcome, in one paragraph.
2. **Lease** — the exact paths the worker may create or change. Nothing outside the lease is touched.
3. **Context** — the types and files to read first.
4. **Constraints** — what must stay true.
5. **Acceptance** — the command that must pass, and what its output must show.
6. **Stop conditions** — when to stop and write a report instead of pushing on.

Workers commit on their own branch and write a report. They never push, merge, deploy or hold keys.
