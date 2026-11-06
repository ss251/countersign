> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Countersign fleet — common rules

Every session reads this after `PLAN.md`. The plan is the project lead's brief; this file adds fleet mechanics and two holds. Where they differ, this file wins only on the points it names.

## Paths

- `M=$M` — plan, charters, packet copies, reports, logs, `RUN-STATE.md`.
- `R=$R` — the main clone. `main` stays at the initial commit. Nobody works here directly.
- `WT=$WT` — every worktree.

## Sessions

`orch-cs` (build orchestrator), `cs-wc` (Whitechain lane), `cs-hd` (Hedera lane), `cs-ui` (brand, web, demo lane), `cs-e2e` (end-to-end test lane, from 17:00 IST), `cs-w1` (money-path reviewer), `cs-w4` (pusher), `ds-<label>` (DeepSeek workers, one packet each).


## Leases

Each lane owns these paths on `cs/int`. Nobody edits another lane's paths.

- **orch-cs:**
  - root config: `package.json`, `bun.lock`, `tsconfig*`, `.gitignore`, `LICENSE`;
  - packages: `packages/core`, `packages/rail` (interface, `eip3009`, `gateway`, `erc8183`), `packages/runner`, `packages/buyer` (except `src/hedera/`), `packages/verify`;
  - `apps/hub`, `contracts/` (except `script/whitechain/`), `subgraph/`;
  - docs: `docs/spec/`, `docs/decisions.md`, `README.md`, `examples/`.
- **cs-wc:** `packages/rail/src/whitechain/`, `packages/relay/`, `contracts/script/whitechain/`, `apps/web/src/routes/merchant/` (built on cs-ui's tokens and components), `WHITECHAIN_FEEDBACK.md`, `docs/whitechain.md`.
- **cs-hd:** `packages/rail/src/hedera/`, `packages/buyer/src/hedera/`, `scripts/hedera/`, `docs/hedera.md`. After the spine is green, also the Stripe MPP rail (PLAN §5 row 26, §7): `packages/rail/src/mpp/`, `packages/buyer/src/mpp/`, `scripts/mpp/`, `docs/mpp.md`. Any hub glue for MPP goes through orch-cs.
- **cs-ui:** `apps/web/` (except `routes/merchant/`), `marks/`, the architecture diagram source.
- **cs-e2e (17:00 IST):** `e2e/`, `scripts/e2e/`, `docs/e2e.md`, and the coverage-matrix issue #39.
- **cs-phone (project lead, 06 Nov 17:35 IST):** `apps/phone/**`, `docs/phone.md`, the phone skills. It is an Opus lane in the tmux session `cs-phone`, worktree `countersign-wt/phone`, branch `cs/phone`. Hub and runner changes go through orch-cs.
  - It reads every lane's code and writes only its own paths.
  - It reads testnet keys from `~/.config/countersign/*.env` at run time and never prints them.

Shared rules:

- Name packets `.packets/<lane>-<nn>-<slug>.md`, where lane is `cs`, `wc`, `hd` or `ui`, so lanes never collide.
- `bun.lock` and the root `package.json` change only on `cs/int`, and only orch-cs changes them. A lane that needs a dependency adds it to its own package's `package.json` and says so in its READY line.
- For any path not listed, post a WAITING line to orch-cs before touching it.

## Branches

- `cs/int` (worktree `$WT/cs-int`) is the integration branch, and orch-cs owns it.
- Lanes work on `cs/<lane>` and per-packet branches `cs/<lane>-<nn>`. They may merge `cs/int` into their own branch at any time.
- When work is ready, a lane posts `READY integrate <sha> <branch>` and opens a pull request into `cs/int`. orch-cs runs the gate, and cs-w1 reviews when the change touches money paths.
- **Squash only (project lead, 06 Nov 17:20 IST): this overrides every "merge commit" below.**
  - **Repo settings:** the repository is squash-only, and delete-branch-on-merge is on. Every pull request lands as exactly one commit.
  - **Title and body:** the PR title is the commit subject, in the form `#NN <what changed and why it matters>`.
    - NN is the issue it closes. A promotion names its headline issue and lists the rest in the body.
    - Never a bare branch description such as "cs/ui into cs/int".
    - The PR body carries the detail: what landed, why, gate counts, proof links, `Closes #N`.
  - **How orch-cs merges:** always `gh pr merge <n> --squash --subject "<the PR title>" --body "<the PR body>"`. Pass both explicitly every time; the repo default would dump every commit message into the body.
  - **Never rewrite history.** No force-push to `main` or `cs/int`, and no rebase of any published branch. The merge commits already on `main` stay.
  - **Lane branches keep their small commits.** They never reach `main`; the squash is what keeps the record clean.
  - **Deletion hazard:** delete-on-merge removes the head branch of every merged PR.
    - **Promotions** therefore never use `cs/int` as the head. Cut `promote/<yyyymmdd-hhmm>` from `cs/int`, open the PR into `main`, and squash-merge it. GitHub deletes only the promote branch.
    - **Lane PRs** may still come from the lane branch. Its remote copy is deleted on merge and cs-w4 re-pushes it on the next sweep: expected, not an error.
  - **Keeping the next diff clean:**
    - **After every squash promotion,** orch-cs records it on `cs/int` with `git merge -s ours origin/main -m "record promotion #NN"`, then pushes normally. The tree is unchanged and the next promotion shows only new work. This is valid only because `main` receives nothing but promotions of `cs/int`.
    - **After a lane's PR is squash-merged into `cs/int`,** the lane merges `origin/cs/int` into its own branch at once, before any new work, so its next PR shows only new work.
- **Merges (project lead, 16:50 IST):**
  - **Into `cs/int`:** this is integration work, so nobody asks the project lead and nobody waits. orch-cs squash-merges a pull request on GitHub as soon as the gate is green and cs-w1 shows 0 blockers.
  - **Into `main` (project lead authorised, 17:00 IST):**
    - PR #9 merged at 42846c7 (17:10 IST). `main` now carries the build.
    - **Cadence:** after each green full gate on `cs/int`, orch-cs cuts a `promote/` branch from `cs/int`, opens its pull request into `main`, and squash-merges it with gh as above. `main` moves every hour or two all night; one giant merge at the end is what we are avoiding.
    - A green gate is the only condition. The project lead's authorisation stands for tonight.
    - Keep each pull request narrow, with a real description: what landed, which issues it closes, the gate counts and the proof links. A judge reads that history.
    - Anything red or surprising is a NEEDS-PROJECT-LEAD line, not a merge.
    - If gh hits a permission wall, post BLOCKED with the exact error text; don't work around it.
  - **CI:** orch-cs adds `.github/workflows/ci.yml`, which runs typecheck, the bun tests and forge on every pull request. It runs offline tests only: no secrets and no testnet calls in CI.
  - A lane folding its own worker branches into its lane branch is review-and-commit, not a merge.
- `main` stays put until the project lead gives the word, relayed by the firstmate.
- **After merging `cs/int` into any branch, every worktree runs `bun install` at its root** before typechecking, testing or starting a dev server. A merge that adds a dependency otherwise leaves the worktree broken: a missing ajv install is what broke the UI build earlier.
- **Delivery gate and scope (project lead, 16:25 IST):**
  - The hub keeps its JSON-schema delivery gate with ajv exactly where it is.
  - The build has no paid-mainnet dependency and no third-party attestation step.
- **On-chain slip hash: APPROVED (project lead, 16:35 IST).** Use the existing contract: `release(jobId, slipHash, sellerSig)` stores `job.slipHash` and emits `Released(jobId, slipHash, payee, paid, toll)`. No redeploy and no contract change.
  - The release path never passes `bytes32(0)`. The `slipHash` released is exactly the hash the hub mints the slip with, so the seller signs the very receipt the buyer receives.
  - **Hash rule:** the committed hash covers the slip body *without* the settlement receipt. A hash that includes the settlement tx cannot exist before release, so including it deadlocks. The verifier reconstructs the hash the same way. orch-cs writes this rule in `docs/decisions.md`.
  - **Verifier:** fetch the `Released` event for the job and assert that `event.slipHash` equals the locally computed hash. That makes the check a proof, not a link. It works on Arc and on Whitechain (chain 1874), which share the contract.
  - **Slip view:** a fifth check, phrased as the chain holding this slip's hash, with the event reference.
  - **Negative test:** a tampered slip body whose own internal hash still matches must fail the on-chain check.
  - No other anchoring beyond this, unless the project lead says so.
- **Escrow v2 (project lead, 06 Nov 17:35 and 17:50 IST): one contract revision, one testnet redeploy.**
  - **The bond:** a delivery that fails the gate slashes the bond to the buyer; silence returns it to the seller.
  - **Buyer acceptance with an optimistic review window:**
    - the seller releases only after the buyer accepts, or after the window passes with no dispute;
    - `dispute` blocks release and routes the job to refund;
    - the deadline refund is unchanged;
    - the window lives in the offer terms.
  - **Order:** cs-19 (bond), then cs-20 (acceptance) on top of it, then a single redeploy: Arc through Studio, Whitechain 1874 with forge.
  - **Addresses:** old addresses stay valid for old slips, and both sets go in `docs/proof.md`.
  - **Review:** cs-w1 plus the firstmate's cross-model review of the contract diff, before deploying.
  - Steer: `$M/STEER-1750-acceptance.md`.
  - **Update (project lead, 18:15 IST):** the review and dispute half is issue #98, held by Rajdeep.
    - cs-19 keeps the bond only.
    - One editor at a time on `CountersignedEscrow.sol`: cs-19 first, then Rajdeep from the `cs/int` sha orch-cs posts on #98. The fleet keeps out until his PR lands.
    - The combined redeploy runs under #98.
    - Steer: `$M/STEER-1815.md`.

## Workers

- **One packet, one worker, one worktree.**
  1. Create the worktree: `git -C $R worktree add $WT/<lane>-<nn> -b cs/<lane>-<nn> <base>`.
  2. Commit the packet to `.packets/` on the lane branch.
  3. Copy it to `$M/briefs/tasks/<label>.md`.
  4. Launch exactly as PLAN §8: `tmux new-session -d -s ds-<label> "bash $M/ds-run.sh <worktree-name> <label> $M/briefs/tasks/<label>.md"`. The label is `<lane>-<nn>-<slug>`.
- **New writers run on the second machine (project lead, 21:40 IST).** The second machine (`<second-machine>`, 11 cores) is idle. It holds a clone of origin at `~/Developer/countersign`, with bun, forge and the keys in `~/.config/countersign` at 0600. Every new ds writer and its gate run there. Running packets finish where they are.
  - **Launch a writer from the build machine.** Copy the packet over first: `scp <packet> <second-machine>:Developer/countersign-mac/briefs/<label>.md`. Then:
    ```
    ssh <second-machine> "tmux new-session -d -s ds-<label> 'bash ~/Developer/countersign-mac/ds-run-mac.sh <branch> <worktree-name> <label> ~/Developer/countersign-mac/briefs/<label>.md [base]'"
    ```
    It builds `~/Developer/countersign-wt/<worktree-name>` from `origin/<branch>`, or from `origin/<base>` (default `cs/int`) when origin has no such branch yet. LAUNCH and EXIT lines land in this RUN-STATE, and the log goes to `~/Developer/countersign-mac/logs/<label>.log`.
  - **Gate on the Mac** (at most two at a time):
    ```
    ssh <second-machine> "cd ~/Developer/countersign-wt/<wt> && bash ~/Developer/countersign-mac/gate-lock.sh <label> -- bash -c 'bun install --linker hoisted && bun run typecheck && bun test && forge test'"
    ```
    Add the web build where it applies.
    - **Never `git stash` in a worker, on either machine.** All worktrees of a clone share one stash stack, so one worker's pop can apply another session's work (cs-truth, 16:15Z, on the Mac). Every packet's Constraints section says: "never run git stash; use a temporary commit or a second worktree". Never drop another lane's stash entry.
    - **Always install with `--linker hoisted` on the Mac.** For this lockfile, bun 1.3's default linker is isolated, and the isolated layout fails the typecheck on `scripts/hedera/agent-run.ts` for no code reason (cs-hd, 16:11Z). the build machine's long-lived installs are hoisted.
    - `ds-run-mac.sh` now installs hoisted when it creates a worktree.
    - A Mac worktree made before 16:15Z needs one `bun install --linker hoisted` before its gate.
  - **Review and push from the Mac.**
    - Review the diff with `ssh … git -C ~/Developer/countersign-wt/<wt> diff`.
    - **Push Mac branches through cs-w4's sweep.** It fetches the Mac clone's `cs/*` into `refs/mac/`, scans, and pushes from the build machine. A push run on the Mac over ssh cannot reach the Mac's keychain ("User interaction is not allowed"), so it fails. Fetching needs no credentials: the repo is public, and `ds-run-mac.sh` retries a failed fetch four times.
    - The clone pulls from origin and never pushes main: its pre-push hook refuses `refs/heads/main`, and its primary checkout only fast-forwards to `origin/main`. Nobody edits the primary checkout.
  - **Load rule per machine.** A Mac launch waits while the Mac's first load number is above 16. A the build machine launch waits above 24. Check with `ssh … sysctl -n vm.loadavg`.
  - **What stays on the build machine:** anything that needs the live services:
    - the relay;
    - the phone tunnel;
    - the deploys;
    - the live runners;
    - the production e2e runs.
- **Fleet-wide cap: at most 8 writers alive at once, across both machines.** The project lead raised it from 5 at 21:20 IST; the history follows. This is the project lead's recorded deviation (06 Nov 18:12 IST) and holds for the rest of the night; PLAN §8 said 3. Every `ds-*` session counts, and so does any subagent or Opus session writing code or docs in a worktree.
  - **The clock (project lead, 20:45 IST; replaces the 22:00 freeze and the 23:00 recording).**
    - We build until 04:00. Midnight is a checkpoint, not a freeze. We record from 04:00 to 06:00, submit from 06:00 to 08:30, and the deadline is 09:00.
    - The closure list, its owners and its deadlines are in `$M/STEER-2050-closure.md`. Nothing on it is silently dropped.
    - A lane that finishes early takes the next item from that list, never a new idea.
    - The PR queue comes first: #164, then #97 (a DeepSeek packet; tests are never rewritten to pass), then #165.
    - Reports: 22:00 per pull request; 22:30, 23:30 and 01:00 per closure item.
    - Never deploy a half-audited contract: if it is not green, it is marked IN PROGRESS. No new claim lands without evidence.
  - **The reality rule (project lead, 21:20 IST, until submission; it overrides convenience).**
    - A claim is real only if one of these exists: a green end-to-end flow that touches the real chain, a live URL the project lead can open logged out, or a signed transaction link.
    - Anything else is IN PROGRESS and stays out of the pitch, the README headline and the demo script.
    - `docs/status.md` opens with a simulation ledger: every remaining stand-in and its owner.
    - The sweep list and its order are in `$M/STEER-2120-reality.md`. Report at 23:00 with one artefact per item: a run id, a URL or a transaction hash.
  - **No silent waiting (project lead, 18:12 IST).**
    - A lane queued for more than 10 minutes posts one line: `WAITING <what for> — next: <the first thing it does the moment it gets a slot>`. It posts again only if that changes.
    - A lane blocked on the project lead posts one line: `NEEDS-PROJECT-LEAD <the one decision or action, with the options>`. The firstmate relays it in the same turn.
  - When the cap is full, queue the packet and wait for a slot. Never switch to a Claude subagent to get around the cap: the project lead's instruction is that DeepSeek workers write the code.
  - An orchestrator takes a packet itself only after one corrective packet has failed.
  - Before every launch, also check `sysctl -n vm.loadavg`; if the first number is above 24, wait.
  - If the cap is what's holding the clock back, post a DEVIATION saying so. The firstmate will ask the project lead about raising it.
  - **Exception (project lead, 06 Nov 17:35 IST): three light builds start now, each in a one-time extra slot:**
    - the phone runner (the cs-phone lane);
    - the seller bond (an orch-cs ds packet);
    - the rail router (an orch-cs ds packet).

    The exception covers those three and their single correctives only. Wait if load is above 24.
  - **Exception (project lead, 06 Nov 16:15 IST): `hd-06-mpp-rail` starts now as a fourth writer, without waiting for a slot.** This is one-time and for that packet only. Every other packet still waits for a regular slot.
- **Model doctrine (project lead, 06 Nov 18:00 IST):** orchestration, review, design, the threat model and any decision that changes the money path run on Opus 5.5 at max effort. DeepSeek executes decided packets. Sonnet only for mechanical roles such as pushing and formatting. **Cost:** DeepSeek packets are cheap and stay the default for bounded implementation; the expensive model is reserved for decisions and review, which is where a wrong answer costs us the build.
- **Thinking tasks are Opus work (project lead, 06 Nov 17:55 IST, standing).** These are designed by an Opus 5.5 lane at max effort with real reasoning:
  - the escrow state machine and the dispute design;
  - the ratings and reputation model;
  - the rail router policy;
  - envelope semantics;
  - the threat model;
  - any architecture decision.

  The design is written down **before** any worker packet, in `docs/spec/*` or `docs/decisions.md`: states, transitions, who may call what, timings, events, failure cases.
  - Workers only execute against a decided design.
  - A packet that leaves a worker to "pick" or "choose" a mechanism is invalid and must be rewritten.
  - On the money path, a plausible average answer is exactly what we cannot afford.
- Workers never push, merge, deploy or hold keys.
- **Workers never read this file, so every packet states the browser ban in its Constraints section:** no browser of any kind on this machine (no headless Chrome, Playwright, Puppeteer or screenshot tools). UI checks go back to the lane, which raises NEEDS-BROWSER.
- **Review** is the full `git diff` plus the gate. Green and correct means commit. Red means one corrective packet; if that also fails, do the work yourself.
- If DeepSeek fails (balance or rate limit), fall back to `opencode/deepseek-v4.1-flash-free` in a copy of the script and log a DEVIATION.

## GitHub cadence (the project lead's standing requirement, 16:05 IST)

- **Every lane commits at least every 20 minutes and is pushed within 20 minutes.** No branch exists only on this machine.
  - cs-w4 sweeps every `cs/*` branch at least every 15 minutes: gitleaks the new range, check the dates, then push without force.
  - PUSH-REQ lines still get an immediate push.
- **Draft pull request `cs/int` into `main`:** orch-cs opens it now and keeps its body current as commits land. The body lists what is green, what is left and the proof links. Nobody merges it: merging into `main` is the project lead's alone.
- **Lane pull requests into `cs/int`:** when a lane posts `READY integrate`, it also opens a pull request from its branch into `cs/int`, so review history lives on GitHub.
  - cs-w1 posts its review on that pull request as well as on RUN-STATE.
  - After the gate passes and cs-w1 shows 0 blockers, orch-cs merges it with a merge commit (no squash), without asking anyone. Only `main` waits for the project lead.
- **Rajdeep is a teammate with push access.** His slate since 17:05 IST:
  - #20: ratings from slips, `/ratings`, `/stats`;
  - #25: Circle CLI interop and discovery consumption;
  - #28: ENS seller names and payee lock;
  - #29: mainnet config that fails closed, plus the runbook;
  - #30: threat model, seller and buyer guides, interop doc;
  - #98: escrow v2 review and dispute. #99 is closed as its duplicate, so refer to #98 only;
  - **added 18:20 IST:**
    - #18: the receipt tree ledger, `/trees/:root` and the tree view;
    - #27: lineage, and refusing a cycle before payment;
    - #53: the OpenAI-compatible endpoint.

  **Dropped from the fleet** because of those three:
  - packet `cs-12-trees-lineage`, which was never launched;
  - `cs/cs-14`, which stops at `f06bf3e` with no corrective. Its state is on #53 for him, and nobody pushes to it again;
  - cs-w1's pre-review of `cs/cs-14`. His pull request gets the review instead.

  **His open pull requests into `cs/int`:** #91 (ENS), #97 (a mainnet hub refuses to boot) and #100 (the threat model and guides). cs-w1 reviews them now. Reviews take no writer slot.

  #7, Railway, is the fleet's.
  - **Keep out of his areas:** no lane dispatches a worker onto any of his areas:
    - ratings or stats;
    - Circle CLI interop or discovery consumption;
    - ENS;
    - the mainnet config guard;
    - those docs;
    - the contract's review and dispute half;
    - receipt trees or `/trees`;
    - lineage cycle refusal;
    - the OpenAI-compatible endpoint. Discovery *publishing* (#36) stays orch-cs's.
  - If a lane finds it already has commits in one of those areas, it says so on his issue instead of continuing.
  - e2e may test his features once they land, but never builds them.
  - Nobody assigns him anything else without checking RUN-STATE.
  - #1, #3 and #4 are back with the fleet, owned by orch-cs.
  - Before any lane works in one of those four areas, check the issue's assignee and coordinate: a RUN-STATE line plus a short comment on the issue. Never race him.
  - His work arrives as pull requests into `cs/int`. Gate them, have cs-w1 review them exactly like a lane branch, and post the review on his pull request. Merge into `cs/int` under the same integration rule as any lane.
  - The Gateway rail (PR #34, issue #3) landed early and stays, owned by orch-cs. What is left: a real nanopayment proof on Arc testnet and the slip naming the rail.
  - The subgraph (#4) is owned by orch-cs. It needs a deploy account: identify the indexer that supports Arc testnet and the account it needs, raise NEEDS-BROWSER for any sign-in, and NEEDS-PROJECT-LEAD for any credential.
- **Issues:** one issue per PLAN §5 row still to do, plus one per packet, opened when the packet starts.
  - Each body names the acceptance test.
  - Commits say `refs #N`. The pull request that finishes the work says `Closes #N`.
  - Labels: `lane:cs`, `lane:wc`, `lane:hd`, `lane:ui`, `plan-row`, `packet`.
- **Public text only:** issue, pull request and commit text is public. No keys, private paths, account details or project lead-private notes.

## Scope for the event (project lead, 06 Nov 16:15 IST)

The project lead wants the full surface. Cutting anything is his decision, recorded in `docs/decisions.md`, never an omission.

- **In scope:**
  - the assistant, the per-offer skill page and the publish wizard (cs-ui);
  - the OpenAI-compatible endpoint, which runs buyer-side on localhost because keys stay on the device (orch-cs);
  - the ENS name policy, with the resolver that makes it true: this is #28, held by Rajdeep, so lanes stay out;
  - the marketplace terms doc (cs-readme);
  - the MPP rail (cs-hd). Project lead, 17:10 IST: it leads with MPP's native Tempo testnet method, and acceptance is a real settlement with a receipt. The Stripe SPT method stays behind a flag, gated on a Stripe sandbox business profile;
  - the Hedera scheduled checkout (cs-hd, hd-08);
  - Railway preview environments, once the project lead installs the GitHub app;
  - the on-chain slip hash (done, on main).
- **Awaiting the project lead's call:** paid sessions and unified balance. Nobody starts either until he rules.

## Front door (project lead, 06 Nov): the highest-priority UI work, in this order

1. **Production tracks `main`.** Until the Railway GitHub app is installed, cs-ui redeploys both services from `origin/main` within 10 minutes of every merge into `main`. orch-cs posts a `DONE <sha> main` line after each merge. A stale deploy is worse than none.
2. **The root (`#/`) is a real overview, never empty, never a redirect.** It shows:
   - what countersign is, in one line;
   - the live offer count and the rails, from the hub;
   - the last few settlements, with explorer links;
   - how the envelope and the countersignature work, in three steps;
   - links to the repository and the docs.
3. **Delete the Demo tab and the `#/demo` route entirely.** The video is recorded on the real screens. This supersedes PLAN's `#/demo` state machine.
4. **Registry** is a real list of sellers and their offers from the hub. Give it identity and reputation columns ready for ERC-8004, and an honest empty state before data arrives.
5. **Assistant.** A person types what they need, and it:
   - searches the live offers on the hub;
   - shows why each match fits;
   - applies the envelope;
   - hands back a countersign card.

   It must be real against the hub, with a clear fallback when nothing matches. A decorative chat box is worse than none.
6. **Then the full emil ladder plus Mobbin references on all five, at 390 and 1440, light and dark.** The firstmate sends the project lead screenshots before anyone calls it done.

orch-cs supplies any hub endpoints these need, as non-view packets: an offer search, a sellers list, recent settlements.

## UI quality bar (the project lead's standing rule, 16:45 IST, until submission)

**0. The direction (project lead, 06 Nov 17:00 IST): a clearing desk, not a dashboard.** `$M/ui/DESIGN-NOTE.md` is binding for every screen.
- **Light and dark:** paper and ink in light mode; near-black in dark.
- **Hairline rules** instead of floating cards.
- **Type:** monospace for every hash, address and atomic amount; tabular numerals wherever money appears.
- **Colour, as meaning only:** one red for refusal, one green for settled, blue only where money moves.
- **Density and order:** dense but quiet. Every screen answers, in order: what is this, what did it cost, what is proven.
- **Before a pixel is drawn:** at least three Mobbin references per screen, logged with what you take and what you avoid in your lane's `DESIGN-LOG.md`.
- **Nothing is done** until it looks designed by someone with taste, not generated.

**1. Opus makes every pixel decision.**
- cs-ui and cs-wc (for `/merchant`) write all view code themselves, on Opus 5.5. This overrides the DeepSeek-writes-code rule for views only.
- No DeepSeek worker writes or reviews view code. Workers may generate mechanical pieces only: test fixtures and types.
- Layout, spacing, type, colour, motion and copy are an Opus decision.
- Any view packet already queued for DeepSeek is withdrawn.

**2. The emil ladder, used deliberately.** If your session has not loaded a skill, read its `~/.claude/skills/<name>/SKILL.md` directly.
- **Lane start (doctrine):** `emil-design-eng`.
- **Base pass:** `emil-design-foundations`, `emil-typography`, `emil-color`, `emil-surfaces`.
- **Shaping interaction:** `emil-animations`, `emil-mobile-native`, `emil-touch-and-accessibility`.
- **Countersign, refund and publish flows:** `emil-forms-and-inputs`.
- **Before a screen is called done:** `emil-unslop-design`, then `emil-ui-polish`.
- **Before the demo:** `emil-ui-review` and `emil-prep-for-prod`. Check `emil-performance` against the measured cold-load numbers:
  - buyer content at 157 ms (first paint 172 ms);
  - slip verdict at 338 ms (first paint 308 ms);
  - at 390 px: first byte 71 ms, DOMContentLoaded 231 ms, first paint 356 ms.

**3. Mobbin.**
- The firstmate pulls the reference screens at the start of each screen and sends a short brief: the pattern, what to take, what to avoid, and which Emil principle it exercises.
- Ask with `NEEDS-MOBBIN <screen> | <the decision it informs>` before you start the screen.
- Priority screens: buyer checkout, receipt, merchant ledger, seller dashboard, empty states.

**4. The bar.** The project lead reviews every screen at 390 and 1440, in both themes, and sends screens back until they hold up.
- No gradients, no glassmorphism, no emoji, no centred hero.
- Prices in tabular numerals.
- Red only for refusal, green only for settled, blue only where money moves.
- Every screen readable at 390 px wide, with the header not clipping.

## Gates

- Every full gate runs through `bash $M/gate-lock.sh <label> -- <cmd>`. A full gate is `bun run typecheck && bun test && forge test`, plus the web build where it applies.
- A test that times out under load is re-run alone before anyone calls it a failure.

## Commits

- Use real timestamps only. Never set `GIT_AUTHOR_DATE` or `GIT_COMMITTER_DATE`. Never amend, rebase or rewrite a commit that has been pushed.
- Small present-tense messages, no emoji, no `Co-authored-by`. The author is the machine's git identity.
- orch-cs keeps the newest commit on `cs/int` under an hour old all night.

## Secrets

- Use fresh wallets for this project only. Generate them on this machine into `~/.config/countersign/<lane>.env` (file mode 0600, directory 0700).
- Never print, echo, log or commit a key, and never pass one in argv. Only addresses and tx hashes appear in logs and chat.
- Worktree `.env` files are gitignored. cs-w4 runs gitleaks before every push.
- **mppx validate hazard (found by hd-06, 06 Nov).** `npx mppx validate` auto-discovers a Stripe key through the local stripe CLI config, which may hold the other company's key. It also resolves a local Tempo payer wallet on mainnet, and with funds and `--yes` it would pay. Standing rule until the project lead rules otherwise:
  - run every `mppx` command with the stripe CLI off PATH (it **is** on PATH on this machine) and every `MPPX_STRIPE_*` / `STRIPE_*` variable unset;
  - only against our own localhost endpoint;
  - never `--yes` until the amount and the chain have been read;
  - Tempo **testnet only** (Moderato, chain 42431, pathUSD). Never mainnet.
  - Nobody runs the `stripe` CLI or reads its config directory. `docs/mpp.md` carries the safe recipe.
- **MPP secrets (project lead, 06 Nov 17:10 IST).** cs-hd, never a worker, creates `~/.config/countersign/mpp.env` with `umask 077`. It holds:
  - `MPP_SECRET_KEY` from `openssl rand -base64 32` (the challenge HMAC secret);
  - a fresh Tempo testnet recipient key and address.

  Never print or commit either; only the addresses appear anywhere. No Stripe key is needed tonight.

## Outward-facing actions

- **Allowed without asking:** testnet deploys, explorer verification, faucet requests, and cs-w4 pushing `cs/*` feature branches.
- **Everything else is NEEDS-PROJECT-LEAD:** `main`, public hosting, sharing links, mainnet, posting anywhere.
- **Hosting is Railway (project lead decisions, 15:30 and 15:45 IST).** The public console deploys from this machine, where the Railway CLI is logged in as ss251.
  - Console deploys are approved. No other host: not Vercel, and not Studio's Share.
  - **Railway hosting is issue #7, owned by the fleet (17:00 IST).**
    - cs-ui deploys both services, the console (`apps/web`) and the hub (`apps/hub`), from this machine into the `countersign` project. orch-cs supplies the hub's start command and env names.
    - Secrets go in Railway variables, never in the repo.
    - The firstmate verifies every route from a clean client.
    - orch-cs puts the URLs in the README. cs-ui posts them on #7.
  - **Railway deploy model (project lead, 17:30 IST):**
    - **Now:** deploy production by hand with `railway up` from this machine. Keep the domains stable: the generated `*.up.railway.app` names never change once they are in the README.
    - **Target:** Railway's GitHub app.
      - Production follows `main`.
      - Each pull request gets an ephemeral environment with its own URL, posted on the pull request and torn down when it closes.
      - Turn on PR environments and wait-for-CI, so nothing red deploys. No hand-rolled previews.
    - **Install click:** installing the GitHub app on ss251/countersign is an account-level permission grant that needs the project lead. When cs-ui reaches that step, it posts `NEEDS-PROJECT-LEAD railway github app install` and waits.
    - **Preview secrets rule.** Write it into `docs/deploy.md` before any preview environment exists. cs-ui owns that file.
      - A preview hub runs in fixture mode or with testnet-only demo keys. It never carries the Whitechain relayer key, a Hedera operator key, the deployer key or any key that holds funds.
      - PR environments must be based on a sanitised `preview` environment, never on `production`: Railway copies the base environment's variables into each PR environment.
      - **Never put a secret in a `VITE_*` variable.** Vite inlines those into the public bundle, and once pushed that cannot be undone.
- **Studio is the contract and preview surface.** The README carries both links: the Railway console URL and the Studio project URL `https://studio.arc.io/app/16e0b317-ec5f-406a-8d7d-24bf6d96533b`. Studio appears on screen in the video.
- **Driving Arc Studio, by CLI only, never the browser.**
  - `arc-studio` is logged in as the project lead. Its credentials sit in `~/.arc-studio/credentials.json`: never print, echo, copy or log them.
  - Until your session restarts with the registered skill, run `arc-studio agent-guide` and follow it.
  - One task is one session. Always use the existing session `countersign` (app `16e0b317-ec5f-406a-8d7d-24bf6d96533b`), and never any other session listed by `arc-studio sessions`.
  - Pass context with `--file`: a plain path is a read-only reference, and `src:dest` places the file in the sandbox for editing there.
  - Ask for `--output json`. Bring results back with `arc-studio pull --changed`. Check `arc-studio deployments` for deployed contracts. Use `arc-studio pause` if you hit the active-sandbox limit.
  - Studio cannot see our repository. Never ask it to edit our files: it only produces work that we pull in and review like any packet.
  - Only orch-cs drives the `countersign` session (one session, one driver). Other lanes ask orch-cs.
  - The Studio link and Studio on screen are issue #1, owned by orch-cs. It is blocked by Studio's share limits: the README carries both links and the risk sits in `docs/decisions.md`.
- **Browser work is never done on this machine.** That covers every faucet, captcha, sign-in page, explorer verify form and dapp UI. This is the project lead's standing rule.
  - No headless scraping, no Playwright or Puppeteer, and no driving a browser over ssh.
  - Route the need up instead with one line: `NEEDS-BROWSER <url> | <what to do> | <exact inputs: addresses, amounts, network> | <what to report back>`. The firstmate drives it in a real browser on the project lead's machine, then answers with a tmux message.
  - While you wait, stay on code. Never block a lane on a browser answer.
  - A verify form with an API or CLI equivalent (for example `forge verify-contract`) is not browser work, so use the CLI.
  - **Every browser and screenshot ask goes to the firstmate (project lead, 19:40 IST).** The project lead no longer has a browser.
    - The firstmate shoots it and saves the files as `~/Developer/firstmate/tmp/ui-shots/<round>/<route>-<width>-<theme>.png` on the project lead's machine.
    - The project lead reviews from those files and sends specific notes.
    - Never raise a browser ask as NEEDS-PROJECT-LEAD.
  - **UI checks:** ask with a port and a route, not for a screenshot, for example `NEEDS-BROWSER http://127.0.0.1:<port>/#/<route> | phone or desktop, light or dark, any interaction | ... | ...`. Keep the dev server listening on this machine. The firstmate tunnels to it, loads it at the requested size and sends back the screenshots and anything visibly broken. Open the route once yourself first, so the request isn't a blank page.

## RUN-STATE.md

- `$M/RUN-STATE.md` is append-only, one line per event: `<UTC ISO> <session> <TYPE> <text>`.
- TYPE is one of `START`, `DONE <sha>`, `BLOCKED`, `WAITING`, `DEVIATION`, `FAIL`, `NEEDS-PROJECT-LEAD`, `NEEDS-BROWSER`, `NEEDS-MOBBIN`, `NEEDS-CONTEXT`, `READY`, `IDLE`, `CLOCK`, `REVIEW-REQ`, `REVIEW`, `PUSH-REQ`, `PUSHED`.
- Append with `echo "$(date -u +%FT%TZ) <session> <TYPE> <text>" >> $M/RUN-STATE.md`.
- Keep it sparse: events, not progress. Each lane also keeps `$M/<lane>/LOG.md`.

## Supervision

- The firstmate steers you with tmux keystrokes. Treat those messages as your supervisor speaking.
- Never address the project lead. Anything that needs the project lead goes in a NEEDS-PROJECT-LEAD line with the exact question and the options.
- Never end a turn without a background waiter (Monitor or a background shell) watching your workers' EXIT lines and new RUN-STATE lines addressed to you.

## Clock

- Re-run `TZ=Asia/Kolkata date` before trusting any block in PLAN §9.
- The kill lines in §9 apply as written. Log each kill as a DEVIATION.
