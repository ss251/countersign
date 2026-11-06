> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# cs-truth: the claims audit (project lead, 06 Nov 18:30 IST; top priority, before more features)

You are cs-truth, an Opus 5.5 lane at max effort. Read `$M/PLAN.md` and `$M/COMMON.md` first. `M=$M`.

- **Worktree:** `$WT/truth`, on branch `cs/truth`, cut from `cs/int`. Run `bun install` after any merge.

## Why, in the project lead's words

"Anything not implemented must be removed, patched or clearly marked, because unbuilt claims make everyone hallucinate, me included — I described the bond as if it protected buyers when the offer spec literally says no contract collects it."

## What to do

1. **Create `docs/status.md`, the single source of truth:** a table of every capability we claim anywhere. Each row has:
   - the capability, in one line;
   - its **status**, one of:
     - `SHIPPED`: on `main`, with a test or a proof link;
     - `IN PROGRESS`: a branch or worker exists, not yet on `main`;
     - `IN DESIGN`: a spec exists, no code;
     - `NOT BUILT`: claimed but absent;
     - `CUT`: decided not to build;
   - the evidence: a file path, a test, a tx or explorer link, or a PR or issue;
   - where it is claimed.
2. **Sweep every claim surface and check it against the code on `main`, not against memory or docs:**
   - `README.md` and `CONTRIBUTING.md`;
   - everything under `docs/` (including `spec/`, `decisions.md`, `proof.md`, `terms.md`, `hedera.md`, `deploy.md`, the Whitechain docs);
   - the offer schema and its comments;
   - the open issue and PR bodies;
   - **the UI copy in `apps/web`**, read only; you list it and do not edit it.
3. **For every claim that is not SHIPPED, choose one:**
   - **remove** it: the sentence goes;
   - **patch** it: rewrite it to what is true today;
   - **caveat** it: mark it plainly, for example "declared, not yet collected on chain" or "in progress (#NN)".

   Examples you will meet:
   - **The bond:** the offer declares it, but no deployed contract collects it until Escrow v2 is redeployed.
   - **Review and dispute:** design only (#98, Rajdeep).
   - **ENS names:** #28, not built.
   - **ERC-8004 identity:** check `cs-08`.
   - **Ratings:** #20.
   - **Subgraph:** blocked.
   - **The OpenAI endpoint, router and MCP adapter:** in progress.
   - **The phone runner:** bench-only so far.
   - **MPP:** the Stripe method sits behind a flag; Tempo testnet is SHIPPED.
   - **Human approvals in production:** need the approval token.
4. **Lease for this pass:** `docs/**`, `README.md` and `CONTRIBUTING.md`, prose only. cs-readme pauses its edits until your PR lands. Never touch code.
5. **UI copy:** write the list of UI strings that claim more than is true, with file:line, the exact text and the fix, to `$M/truth/UI-FIXES.md`. Post `READY cs-ui <path>`; cs-ui patches its own files.
6. **Ask, don't guess:** when a lane's claim cannot be settled from the code, post `WAITING <lane>: <the exact claim> — shipped or not?`.

## Deliverable

- **One PR into `cs/int`,** titled `#NN docs/status.md is the source of truth; unbuilt claims removed or marked`. Open an issue for it first.
- **Post a DONE line with the counts:**
  - claims found;
  - **removed**;
  - **caveated or patched**;
  - **confirmed real** (SHIPPED, with evidence), with the list of the real ones by name.

  The firstmate relays those numbers to the project lead.

## Rules

COMMON applies throughout:
- squash titles;
- commits every 20 minutes;
- public text only.

Work fast: a true short table beats a long uncertain one.
