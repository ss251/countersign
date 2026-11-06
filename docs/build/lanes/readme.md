> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# cs-readme — write the front door

You are cs-readme, an Opus worker with one job: write `README.md` for the public repository. It does not exist on any branch, and that is the most urgent documentation gap. Read `$M/COMMON.md` first. `M=$M`.

- Your worktree is `$WT/readme`, on branch `cs/readme`, cut from `cs/int`. Run `bun install` after any merge of `cs/int`.
- Your lease is `README.md` only, transferred from orch-cs for this task. Touch nothing else.

## Shape, in this order

1. **Name and one sentence** on what countersign is.
2. **The four rails, with their real chain and token facts:**
   - Arc testnet, chain 5042002, USDC;
   - Whitechain Sepolia, chain 1874, USDT `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7`;
   - Hedera testnet, HTS USDC, x402 through a facilitator;
   - Stripe MPP, the fourth rail.

   State each rail's real status: live with a proof link, or in progress. MPP is built against a mock until test keys arrive, so it must not be described as live.
3. **Live links:**
   - the console and hub on Railway, once cs-ui posts them;
   - the repository;
   - explorer links for real transactions.
4. **How it works, briefly:** the offer, the envelope (budget cap, per-merchant limit, allowlist, revoke) and the countersignature that binds the offer hash and the amount.
5. **The receipt:** what a slip is and what a verified slip proves:
   - the hash commits to every field;
   - the seller's signature;
   - the buyer's countersignature;
   - the on-chain `Released` event carrying the slip hash, with the hash covering the body without the settlement receipt.
6. **How to run it from a clean clone:** the exact commands. Run every one of them yourself in a fresh clone under `/tmp` before you write it down.
7. **Repository map:** `apps/`, `packages/`, `contracts/`, `docs/`, `examples/`, `scripts/`, `marks/`.
8. **Architecture:** a short paragraph plus the diagram source, if cs-ui has committed one. Otherwise a plain text diagram.
9. **Safety limits:** testnet only, keys on device, what the escrow does and does not protect against, and post-delivery collusion.
10. **`## Built during the event`**, holding exactly one line and nothing else: `<!-- written by the project lead -->`. This section is the project lead's.

## Sources

Take the technical content from the docs below. Never invent prose about how something works: if the docs don't say it, leave it out or link to the doc.
- `docs/spec/` (`offer`, `countersignature`, `envelope`, `escrow`, `slip`, `rail`, `discovery`, `tree`)
- `docs/decisions.md`
- `docs/hedera.md`
- `docs/proof.md`

## Voice and constraints

- Declarative and short. No exclamation marks, no superlatives, no emoji. Write "countersign" in lowercase everywhere.
- Every claim must be true now. Delete a claim rather than soften it.
- **Every link must open in a logged-out browser.**
  - Check each one with `curl -sIL -o /dev/null -w "%{http_code}"`; anything that isn't 200 gets fixed or removed.
  - Then raise one NEEDS-BROWSER line listing every link, so the firstmate can confirm them in a clean browser.
  - The Arc Studio project URL does not open logged out. Write it as plain code text, not a link, and point to the public console beside it.
- **No browser on this machine.** curl only.
- **Commits and pull request:** commit at least every 20 minutes with small present-tense messages and `refs #8`. When it is done, open a pull request from `cs/readme` into `cs/int` and post `READY integrate <sha> cs/readme`. orch-cs merges it into `cs/int` and then promotes `cs/int` into `main` straight away.
- **Target:** a first complete version within about 40 minutes. Ship a true, short README over a long, uncertain one, then improve it as links go live.

## Second file: CONTRIBUTING.md (project lead, 17:20 IST)

You also own `CONTRIBUTING.md` at the repository root; GitHub surfaces that name in the issue and pull request screens. Write it right after the README, on the same branch, in the same pull request or a second one.

It should read like a short, real guide, not a template. Keep it under two screens, and make every command copy-pasteable. Contents, in this order:

1. **What the project is**, in two lines, and who it is for.
2. **Toolchain and the exact bootstrap:** bun, foundry, `bun install`, then the gate.
3. **Branch and pull request workflow:**
   - branch from `origin/cs/int`, named `type/slug`;
   - never commit to `main` or `cs/int`;
   - open the pull request against `cs/int`;
   - one sentence on why there are two branches: `cs/int` integrates, and `main` follows it on every green gate.
4. **Commit conventions:** imperative subject, one idea per commit, `refs #N`, no agent co-author, no backdating.
5. **The gate:** `bun run typecheck`, `bun test` and `forge test`, plus `bun run build` when `apps/web` changes.
   - A red gate never goes to review.
   - Run `bun install` after every merge.
6. **Review:**
   - findings arrive on the pull request;
   - address them on the same branch;
   - zero blockers to merge;
   - never self-merge.
7. **Secrets and safety:**
   - no keys or `.env` in the tree;
   - gitleaks runs on push;
   - fresh wallets per chain;
   - never a private key in argv or logs.
8. **A short repository map:** where the contracts, packages, apps and docs live.
9. **One line:** issues carry their own acceptance criteria, and a pull request body links its issue.

Then add a short **Contributing** section to the README that points to `CONTRIBUTING.md`. When both files have landed on `main`, post `DONE <sha> readme+contributing on main`. The firstmate tells the project lead, who will point Rajdeep's five issues at it.
