> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# PLAN — Countersign

Self-contained build plan for a clean session. This file is the whole brief: product, prize targets, brand, stack, ledger, contract, rails, fleet mechanics, hours, video and submission. Nothing else needs reading first.

**Nothing in the product is optional.** The full capability surface is in §5 as a ledger. The tiers decide order, not whether a module exists.

Clock at writing: **14:25 IST, Fri 06 Nov. Deadline 09:00 IST, Sat 07 Nov.** Re-run `TZ=Asia/Kolkata date` on start.

---

## 0. Ground rules

- No timestamp outside 05–07 Nov. No commit in the future.
- Never print a private key. `.env` only; addresses and tx hashes in chat.
- No push to `main` without the project lead's word.
- No analytics in the client. Human voice in the video. No TTS, no speed-up.
- Every README claim true at submission; delete rather than soften.

## 1. Product

Checkout for software that sells itself. A seller publishes an **offer** — price, input schema, output schema, deadline, bond. A buyer's agent reads it, the human's **envelope** (budget cap, per-merchant limit, allowlist, revoke) approves, and the buyer **countersigns**: one signature binding the offer hash and the amount. Stablecoin moves to an **escrow** keyed to that countersignature. Delivery **releases** it and mints a **slip**. A missed deadline lets anyone **refund** it. A settlement at any other price **reverts**.

The marketplace is the storefront; the protocol is the product. Sellers keep custody of code, prompts and keys — execution happens on their machine, only schema and price are published. Buyers are agents, so every call is metered, capped and receipted. A seller can itself buy mid-run.

Three refusals carry the demo, in order: the price moved and the chain refuses; the hub died and the slip still verifies; the deadline passed and the money returns with no dispute desk.

Vocabulary, fixed: offer, countersignature, escrow, slip, release, refund, toll, envelope, adapter, rail, runner, registry. Nothing else.

### Catalogue is the sponsors' real artifacts

| Adapter | Serves | Upstream | Licence |
|---|---|---|---|
| `skill` | `use-arc`, `use-usdc`, `use-gateway`, `use-smart-contract-platform`, `bridge-stablecoin` | `github.com/circlefin/skills` | Apache-2.0 |
| `skill` | `whitechain-dev` | `github.com/whitechain-labs/skills` | none published — reproduce verbatim, note it in `NOTICE` |
| `mcp` | `HederaMCPToolkit` in `RETURN_BYTES` mode | `@hashgraph/hedera-agent-kit-mcp` | Apache-2.0 |
| `mcp` | paid proxy to Circle's MCP server | `https://api.circle.com/v1/codegen/mcp` | n/a |
| `openapi` | merchant invoice + refund | this repo | MIT |

Skill output is guidance text; MCP output is a JSON tool result; both are input-gated and output-schema-checked before settlement. Undescribed output is a failed delivery and refunds.

Discovery is bidirectional: the hub publishes an A2A card, a skills index and OpenAPI so Circle's discovery API indexes us, and our buyer queries theirs.

---

## 2. Prize targets

Select exactly three partners on the form: **Arc, Whitechain, Hedera**. Several tracks at one partner cost one pick, so enter every track listed. Opt for **Finalist and Partner Prizes**.

Every requirement below is mandatory and is checked before submitting. An entry that misses one is an entry that does not place, whatever the product does.

### Arc — three tracks, one pick

- **Best Smart Contracts with Advanced Stablecoin Logic** ($3,000) — conditional escrow, onchain dispute-free release, software-to-software payments, contracts other builders can reuse. This is the core of the product.
- **Best Mobile Web Consumer Agent Using the Marketplace Discovery API** ($3,000) — the agent discovers offers **through Circle's discovery API**, pays per use with Nanopayments, and the consumer sees a spend limit, approvals and purchase history. Mobile-first. The hub publishes compatible discovery metadata (A2A card, skills index, OpenAPI) so we appear in that index rather than only in our own.
- **Best DeFi / Onchain Finance App Built End to End in Arc Studio** ($3,000).

All three require a shareable **Arc Studio project URL**, Studio on screen in the demo, a working frontend **and** backend, an architecture diagram and a repo link. A Studio URL that 404s is a disqualification on all three, so the Studio project is created in the first hour.

### Whitechain — two tracks, one pick

- **Scale · Payments Nobody Notices** ($3,000) — the listed idea is literally ours: pay-per-request APIs where an agent pays a business in USDT over x402, settled on Whitechain through a facilitator we run. The buyer must show zero crypto steps: no gas, no seed phrase, no chain awareness.
- **Operate · Stablecoin Payments for Business** ($5,000) — merchant view and customer view, plus something past the first payment: a refund the merchant issues in one click, an export for the accountant.

Requirements, all mandatory: contracts on **Whitechain Sepolia, chain 1874**, verified on the explorer; at least one real **USDT** payment (`0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7`) in the main flow with the explorer link in the README; a README line on why this needs onchain settlement; a `WHITECHAIN_FEEDBACK.md`; a video showing **each party**; and a repo that shows steady progress through the hackathon rather than one upload at the end.

> ⚠️ Whitechain will not place "escrow on its own". The checkout and the one-click refund lead; escrow is the mechanism behind them.

### Hedera — one track, one pick

- **AI Agents That Pay: x402 on Hedera** ($6,500).

Requirements: an x402-protected endpoint settling on Hedera testnet through a facilitator (official x402, Ax402, Blocky402, or one we run); an agent that discovers it and completes a paid request **with no human approving**; a README covering setup, architecture and payment flow **including the Hedera transaction ID**; a video that shows the payment settling and links it on HashScan.

Extra points, and cheap here: spend budgets and per-merchant limits (already the envelope), ERC-8004 identity, and an **HCS topic as the tamper-evident spending log**. The `@hashgraph/hedera-agent-kit-mcp` listing is itself an extra-points item — an MCP server charging per call is the "metered MCP server" idea in their brief.

### Global rules

Public repo, MIT licence, continuous history, AI-usage disclosure, video 2–4 minutes at ≥720p with a human voice and no pre-recorded speed-up. One 3:30 video satisfies every track (Hedera's cap is 5).

---

## 3. Brand

**Name:** Countersign. Always lowercase, in prose and in the wordmark. Never capitalised mid-sentence.

**The mark:** two opposing strokes meeting on a vertical seam — left stroke ink, right stroke seal red, the seam a hairline gap. It reads as a signature cut in half and rejoined. Ship it as `marks/countersign-mark.svg` (2 paths, 24×24) and `marks/countersign-wordmark.svg` (text path or live text, mono face, lowercase, `-0.02em`). A text-only wordmark is acceptable; a bad drawing is not.

**Palette** — instrument paper, not dashboard dark:

| Token | Light | Dark |
|---|---|---|
| `--paper` | `#F3F0E9` | `#121210` |
| `--ink` | `#17170F` | `#EFEDE6` |
| `--slate` | `#6A675C` | `#A5A197` |
| `--seal` (countersign / refusal) | `#A8341C` | `#D9573B` |
| `--settle` | `#1D6B45` | `#3FA574` |
| `--usdc` | `#1B4F8F` | `#5E97D0` |
| `--line` | `#DAD5C9` | `#2E2D28` |

Colour law: blue is money, green is settled, red is refused or countersigned, and nothing else borrows them. **No gradients, no glow, no glassmorphism.**

**Type:** platform sans for the human voice; monospace strictly for values read glyph by glyph — hashes, addresses, atomic amounts, JSON. Prices, fees and counts are sans with `font-variant-numeric: tabular-nums`.

**Tone:** declarative, short, no exclamation marks, no "revolutionary". A refused call says *"Refused. The price moved after you signed."* A released call says *"Released. Slip minted."*

**Surfaces:** the buyer screen is a phone, the merchant screen is a desktop. Different routes, different densities, both in the demo.

Design from outside references only — Mobbin, Circle's own docs, Poncho. No old mockups.

---

## 4. Stack and layout

Bun + Hono + viem + Foundry + Vite/React. No Effect, no TanStack Start, no build tooling beyond Bun workspaces. `bun install` under 60 seconds.

```
apps/hub/        offers, x402 challenge, slips, trees, registry, discovery, stats
apps/web/        / /buyer /merchant /seller /offer/:id /slip/:id /verify /registry /demo
packages/core/   types, atomic amounts, schemas, tree + slip codec, canonical JSON
packages/rail/   Rail interface; eip3009, gateway, erc8183, whitechain, hedera, mpp
packages/runner/ daemon, cli, adapters skill|mcp|openapi, scrubbed child, cost ceiling
packages/buyer/  cli, mcp client, journal, envelope, resume
packages/verify/ standalone slip verifier, zero hub imports
packages/relay/  Whitechain gas relayer
contracts/       CountersignedEscrow.sol, FeeSplit.sol, JobHook.sol, test/
subgraph/        ledger entities + mappings + deploy
docs/spec/ .packets/ docs/decisions.md
```

---

## 5. Capability ledger

`S` spine (by 17:00) · `D` demo-visible (by 02:00) · `P` parity/deep (by 05:00) · `R` runbook only.

| # | Module | Tier | Acceptance |
|---|---|---|---|
| 1 | Workspace, core types, atomic math, canonical JSON | S | unit tests |
| 2 | `CountersignedEscrow` + Foundry tests + Arc deploy | S | 8 tests in §6 |
| 3 | Hub `/offers` POST/GET, x402 challenge, `/healthz` | S | bought and served |
| 4 | Runner `skill` adapter + dial-out daemon | S | a real `SKILL.md` served |
| 5 | Buyer cli: discover, envelope, countersign, pay | S | end-to-end |
| 6 | Slip mint + `verify` cli, no hub imports | D | `VALID` with hub stopped |
| 7 | Wrong-amount settle reverts; deadline refund | D | both proven |
| 8 | Receipt tree ledger + `/trees/:root` + tree view | D | root commits children |
| 9 | `gateway` rail — session deposit, verify, debit | D | one nano payment |
| 10 | `eip3009` rail as the direct-USDC path | D | one settled call |
| 11 | ERC-8004 identity, operator grant, feedback | D | mint + settle + feedback |
| 12 | Ratings from slips, `/ratings`, `/stats` | D | derived, not self-reported |
| 13 | Web: offer card, confirm hold, envelope, refund | D | both human views |
| 14 | Web: seller dashboard + publish wizard | D | publishes a skill |
| 15 | Rail declaration + per-rail receipt view | D | rail named on every slip |
| 16 | `whitechain` rail 1874 + USDT + relayer | D | real USDT payment + refund |
| 17 | `hedera` rail, facilitator, HCS spend log | D | agent-paid call, HashScan |
| 18 | `erc8183` escrow rail + `JobHook` commit | P | hook event on settle |
| 19 | Subgraph: entities, mappings, deploy, `/graph/stats` | P | indexed query |
| 20 | Circle CLI interop + discovery consumption | P | scripted proof |
| 21 | Canary, automatic delisting, reconnect rules | P | delisted without a paid pass |
| 22 | Lineage + cycle refusal before payment | P | cycle refused |
| 23 | ENS seller names + payee lock (Sepolia) | P | resolve, mismatch refuse |
| 24 | Mainnet config fails closed + runbook | R | boot refuses while pending |
| 25 | Threat model, seller/buyer guides, interop doc | R | written |
| 26 | `mpp` rail: Stripe Machine Payments Protocol, the fourth rail (§7). Starts only after the spine and never ahead of the three partner rails. | D | `npx mppx@latest validate` passes on the local endpoint; slip records the MPP receipt id; unit tests green against a mock until test keys land |

---

## 6. Contract

`CountersignedEscrow.sol` — one file, no proxy, no admin pause, immutable `treasury` and `tollBps`:

```
fund(bytes32 offerHash, Countersignature cs)
release(bytes32 jobId, bytes32 slipHash, bytes sellerSig)
refund(bytes32 jobId)
```

`fund` verifies the buyer's signature over `(offerHash, amount, nonce, expiry, chainId, address(this))`, pulls by `transferWithAuthorization`, stores the job, emits `Funded`. `release` is seller-payee only and pre-deadline, pays `amount - toll` to the seller and `toll` to treasury, emits `Released`. `refund` is permissionless post-deadline, returns the full amount, emits `Refunded`.

Tests, all required: replay of a nonce fails; wrong amount fails; release after deadline fails; refund before deadline fails; refund by a stranger succeeds; double release fails; double refund fails; reentrancy on the payee path is closed.

`FeeSplit.sol` splits the toll. `JobHook.sol` is an ERC-8183 hook committing `slipHash` at settlement.

---

## 7. Rails

One interface, three methods (`challenge`, `verify`, `settle`), one slip shape. Nothing above the rail knows the chain.

- **Arc** — 5042002, USDC `0x3600…0000`, 6dp, EIP-712 `USDC`/`2`. Escrow does the work; buyer signs `TransferWithAuthorization` naming the escrow.
- **Arc · gateway** — Circle Gateway deposit, verification, accepted transfer, buyer debit. Recipient credit arrives in a batch; say so in the README rather than implying instant credit.
- **Whitechain Sepolia** — 1874, USDT `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7`. Same contract deployed and verified on 1874. `packages/relay` holds WBT, submits the buyer's authorisation, exposes remaining WBT and a per-hour ceiling, refuses past it. Merchant refunds in one click.
- **Hedera** — HTS through a listed facilitator behind a thin rail; do not write a facilitator first. Agent account, no human approval, every spend appended to an HCS topic. Fallback to a direct HTS transfer with our own settle check.
- **erc8183** — the pinned escrow contract as an alternate settlement backend with the hook committing the slip.
- **Stripe MPP (fourth rail, added Fri 06 Nov ~15:30 by project lead decision)** — the Machine Payments Protocol, an open spec co-authored by Stripe and Tempo. It has the same declaration/challenge/verify/settle shape as the other rails, so an offer can list `mpp` next to arc, whitechain and hedera. The slip records the MPP receipt id.
  - **Flow:** the server answers with HTTP 402 plus payment requirements. The agent retries with a payment credential. The server verifies it and records it with `POST /v1/payment_intents`, then returns the resource with a receipt.
  - **Build:** the `mppx` npm package plus the `stripe` SDK. Call `Mppx.create({ methods: stripe.create({ client, networkId: <profile id>, <livestream flag> }).defaultMethods(), secretKey })`, then `mppx.charge({ amount })(request)` in the handler, and `response.withReceipt()` on success.
  - **Amount floors:** 0.01 USDC for stablecoin; 0.50 USD for card through a shared payment token.
  - **Validate locally:** `npx mppx@latest validate http://localhost:<port>`.
  - **References:** docs at https://docs.stripe.com/payments/machine/mpp, sample at github.com/stripe-samples/machine-payments.
  - **Clock:** after the spine, never before it. It never displaces Arc, Whitechain or Hedera. If any partner rail is behind its §9 gate, MPP pauses.

---

## 8. Fleet


Setup before anything else: create `$M/`, copy this file there as `PLAN.md`, make `cs/ tasks/ briefs/tasks/ reports/ logs/ oc-data/` under it, and touch `RUN-STATE.md`. The orchestrator reads this file from that path.

### Sessions

One tmux session per lane, each with its own directory, `CHARTER.md` and lane run log. Never two writers in one directory.

| Session | Model | Owns |
|---|---|---|
| `orch-cs` | Opus 5.5, max | whole build: packets, review, gates, commits. One only. |
| `cs-wc` | Opus 5.5, max | Whitechain rail, relayer, USDT payment, merchant view |
| `orch-hd` | Opus 5.5, max | Hedera rail, facilitator, HCS topic |
| `cs-ui` | Opus 5.5, max | brand, mark, screens, `#/demo` |
| `w1` | Sonnet 5.5 | reviewer of the escrow and every money path. Must produce a failing test before a fix. |
| `w4` | Sonnet 5.5 | pushes feature branches. `main` only on the project lead's word. |

Launch an orchestrator, verbatim:

```
M=$M
tmux new-session -d -s orch-cs -c $WT/cs-int \
  "claude --model claude-opus-5-5 --effort max --dangerously-skip-permissions \
   \"You are the Countersign orchestrator. Read $M/PLAN.md and $M/cs/CHARTER.md completely, then execute.\""
```

Workers get their own worktree on a branch cut from the shared base, and are launched one packet per session. First argument is the worktree name under `countersign-wt/`, second the task label:

```
tmux new-session -d -s ds-<label> "bash $M/ds-run.sh <worktree-name> <label> $M/briefs/tasks/<label>.md"
```

### Executor invocation

`deepseek/deepseek-flash` at `--variant max`, through DeepSeek's own API. Not `experientiallabs`, not OpenRouter — neither is configured on this machine. `ds-run.sh` wraps `ds-task.sh`, which:

- gives every run its own `XDG_DATA_HOME` under `countersign-mumbai/oc-data/<label>` — one shared opencode SQLite DB makes concurrent runs die with `database is locked`, and this is the fix;
- runs `opencode run --dir <worktree> -m deepseek/deepseek-flash --variant max --auto --title <label> "$(cat <packet>)"`;
- appends `LAUNCH` and `EXIT rc=` to the lane run log.


### Concurrency and load

- Three writers maximum, non-overlapping path leases.
- Before each launch, `sysctl -n vm.loadavg`; above 24, wait.

### Packets

A packet is a committed file at `.packets/<nn>-<slug>.md`: goal, exact paths in the lease, constraints, acceptance command, stop conditions. The worker may touch nothing outside the lease. Review is the full `git diff` plus `bun run typecheck && bun test && forge test`. Green and correct → commit. Red → one corrective packet, then take it yourself.

### Coordination

One append-only shared log, `countersign-mumbai/RUN-STATE.md`, plus a per-lane log. Sparse typed lines only: `START`, `DONE <sha>`, `BLOCKED`, `WAITING`, `DEVIATION`, `FAIL`, `NEEDS-PROJECT-LEAD`, `READY`, `IDLE`.

- The firstmate drives everything by `tmux send-keys -t <session> "<steer>"` then Enter. Orchestrators treat that as their supervisor speaking.
- The firstmate is woken by a background ssh poller every 60 s: tail `RUN-STATE.md` from a line cursor, filter the actionable lines, `tmux has-session` for every lane, grep lane logs for `Error:`, `database is locked`, `rate limit`, `insufficient`.
- A `NEEDS-PROJECT-LEAD` line is relayed to the project lead in chat, and the answer comes back as a steer. Orchestrators never address the project lead directly.
- An orchestrator must never end a turn without a pending background waiter on its workers' exit lines.
- Workers never push, merge, deploy, or hold keys. They commit on their own branch and write a report under `reports/`.

### Commits

Every landed packet, every fix, every doc. Newest commit never older than an hour; log runs past midnight. Small present-tense messages, no emoji, no `Co-authored-by`.

---

## 9. Hours

Two humans: **A** contracts/rails, **B** web/brand/demo.

| Time | A | B | Gate |
|---|---|---|---|
| 14:30–15:15 | repo, workspace, core, contract skeleton, deploy script | Arc Studio project, tokens, mark, wordmark, shell | `bun install` <60s |
| 15:15–17:00 | escrow + 8 tests + Arc deploy | hub offers/challenge, buyer cli, runner skill | **cold spine green**, Studio URL opens logged out |
| 17:00–18:30 | revert + refund + verify cli | slip view, verify page | three refusals green |
| 18:30–20:00 | gateway + eip3009 rails | tree view, rail declaration | nano payment settles |
| 20:00–21:30 | ERC-8004 + ratings + stats | envelope, confirm hold, merchant refund | 8004 feedback lands |
| 21:30–23:00 | runner `mcp` + `openapi`, input gate | seller dashboard, publish wizard, mobile buyer | real MCP offer served |
| 23:00–00:15 | Whitechain deploy, verify, relay | Whitechain merchant view | **real USDT payment** |
| 00:15–01:15 | Hedera rail, facilitator, HCS | copy pass | **agent-paid call, HashScan** |
| 01:15–02:15 | subgraph, circle cli interop, canary/delisting, lineage | `#/demo` state machine | indexed query |
| 02:15–03:00 | seed five real artifacts, five seller keys | final screens | every offer links upstream |
| 03:00–04:00 | rehearsal | rehearsal | cold 3:30 run |
| 04:00–05:30 | fixes | record, edit, upload | video URL live |
| 05:30–07:30 | README, threat model, guides, mainnet runbook, ENS, feedback, diagram | logged-out checks | docs complete |
| 07:30–08:30 | buffer | buffer | form ready |
| 08:30–09:00 | project lead submits | | submitted |

**MPP (fourth rail) on the clock:** it starts only once the spine is green (17:00 gate). The Hedera lane builds it against a mock first and runs it live once the project lead's test keys land. It pauses whenever a partner rail misses its gate, and it is the first thing cut.

**Hosting (project lead decision, Fri 06 Nov ~15:30):** the console runs on Railway, in a new `countersign` project under the ss251 account, and no other Railway project is touched. This Railway console is the live URL a judge opens. Studio cannot provide one: its project URL redirects to the Studio landing page when logged out, and its Share control only deploys through Netlify, Hugging Face or Vercel. So the README carries both the Railway console URL and the Studio project URL, and Studio appears on screen in the video. Record that risk in `docs/decisions.md`; never claim the Studio URL alone meets the Arc rule.

**Kill lines.** No cold spine by 17:30 → drop Hedera and put both humans on Arc. No Studio URL by 17:30 → it outranks every other Arc task until it exists, because all three Arc tracks die without it. No USDT by 00:15 → cut those beats, keep the pick. No Hedera call by 01:15 → cut the rail from the demo, keep the pick. Video starts 04:00 whatever is broken; a finished 3:30 cut beats a fixed bug. **Arc is never cut.**

---

## 10. Video — 3:30

Agents buy blind → publish a real `SKILL.md` → envelope approves → countersign → settle at the wrong price, watch it revert → deliver, release, slip → kill the hub, verifier prints `VALID` → miss a deadline, permissionless refund → Whitechain merchant checkout with USDT and a refund → Hedera agent-paid call and the HCS entry → *"Every call countersigned. Every call provable."*

Booths, 45 seconds, artifact first: **Arc** — the revert, the Studio URL. **Whitechain** — the refund, the gasless payer. **Hedera** — the facilitator, the HashScan link, the budget cap.

---

## 11. README

Name, one line, demo, video · what it is · quickstart · catalogue with upstream links · architecture · the three refusals · **Built during the event** · limits · **CROPS** (C/O/P/S) · why onchain settlement · proof links · AI disclosure.




`WHITECHAIN_FEEDBACK.md` written in the moment, not from memory.

---

## 12. Before submit

- Log unbroken, no gap over an hour, nothing future-dated, all inside 05–07 Nov.
- Live: Arc `Released`, Arc `Refunded`, a revert on a moved price, a Whitechain USDT payment and refund, a Hedera settled call with HashScan and HCS entries, verifier `VALID` with the hub stopped, one gateway nano payment, one ERC-8004 feedback.
- Every link opens logged out: repo, demo, video, Studio, explorers.
- Prize checklist, item by item: Studio URL in the README and on screen; the USDT payment's explorer link and the why-onchain line in the README; `WHITECHAIN_FEEDBACK.md` present; the Hedera transaction ID in the README; MIT `LICENSE`; AI disclosure; video 3:30, ≥720p, human voice, both Whitechain parties shown.
- Three partners selected on the form: Arc, Whitechain, Hedera. Every track at each entered. Finalist and Partner Prizes.

Then ask the project lead for the word.
