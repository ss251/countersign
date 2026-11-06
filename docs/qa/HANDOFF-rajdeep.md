# Handoff for Rajdeep: the 07 Nov QA findings

The findings are in [2026-11-07-grok-qa.md](2026-11-07-grok-qa.md), and the full report is [2026-11-07-grok-qa-report.pdf](2026-11-07-grok-qa-report.pdf).

Each section below gives the facts the copy needs, where each fact comes from, and the files to change. The changes are copy and empty states only, with no redesign.

For this round only, the project lead assigned the five fixes to the fleet (STEER-0215), so some may already be live when you read this. The PR column says where each one went.

| Defect | Who fixes it this round | Where |
|---|---|---|
| C1 rail taxonomy | cs-ui (console), cs-readme (docs wording) | `apps/web/src/routes/home/Evidence.tsx`, `apps/web/src/routes/registry/index.tsx`; README, status.md, terms.md |
| C2 Buyer empty state | cs-truth (hub route), cs-ui (Buyer screen) | a new hub route `POST /envelopes/session`; `apps/web/src/routes/buyer/**` |
| C3 Studio demo label | the firstmate, in Arc Studio | the Studio project, not this repository |
| C4 unnamed seller | cs-ui | `apps/web/src/routes/registry/index.tsx`, `apps/web/src/routes/buyer/Approvals.tsx`, the offer page |
| C5 Studio ledger lag | the firstmate, in Arc Studio | the Studio project, not this repository |

## C1: "3 rails live" against five rail filters

**The facts.**

- **Live** means declared by the production hub: `GET https://hub-production-e85e.up.railway.app/rails`.
  - On 07 Nov it lists exactly three: `escrow` (Arc), `whitechain` (Whitechain · USDT) and `hedera-scheduled` (Hedera · scheduled). The same three are in [status.md](../status.md) "Rails".
  - Gateway and plain Hedera x402 are off on production by flag (`GATEWAY_RAIL=0`, `HEDERA_RAIL=0`), because both debit the buyer before the seller runs.
- **Listed** means a rail that is present in discovery or in sellers' offers, but not live.
  - Older offers still name `gateway` and `hedera`. Production's offers name five rails between them: `escrow`, `gateway`, `hedera`, `hedera-scheduled`, `whitechain`.
- **Where the numbers come from.**
  - The hero's count is `rails?.length` from the hub's `/rails` (`apps/web/src/routes/home/Evidence.tsx`, lines 181 and 195). It is already read at run time, so it says 3.
  - The Registry's filters are every rail named by any listed offer (`apps/web/src/routes/registry/index.tsx`, line 138). That gives five, labelled through `RAIL_LABEL` in `apps/web/src/lib/format.ts`.

**The copy.** Group the Registry filters under two labels: "Live (3)" for the rails in `/rails`, and "Listed only (2)" for the rest. A listed-only rail is one a seller's offer names, but which the production hub does not settle today. The hero keeps "3 rails live", and the docs use the same two words.

## C2: the Buyer screen asks for a token and never says how to get one

**The facts.**

- **The token, now.** A person signed in with Privy clicks "Create an envelope" on the Buyer page. That gets an envelope and an approval token scoped to it from `POST /envelopes/session`, with tight defaults: cap 1 USDC, 0.5 per seller, ask above 0.05, 24 h. It is live on production, proven by [`e2e/human` run `20261106-212520-210c`](../../e2e/human/runs/20261106-212520-210c.md). Before it, the only token was the operator's `HUMAN_APPROVAL_TOKEN`.
- **The envelope** is the agent's spending limits, set by its owner:
  - a total cap;
  - a per-seller limit;
  - an allowlist;
  - an expiry;
  - an "ask above" amount, above which a payment waits for the owner's approval.

  The agent signs nothing outside it ([spec/envelope.md](../spec/envelope.md), [guides/buyer.md](../guides/buyer.md)).
- **The old message** was "Paste the token first." (`apps/web/src/routes/buyer/Approvals.tsx`, `TokenForm`). The Buyer screen now explains the envelope in two sentences and keeps "Paste a token" as the second option.
**What is left for the copy.** The flow is fixed. A restyle can keep the two sentences and the primary "Create an envelope", with "Paste a token" second. For an agent run from a terminal, link [docs/onboarding.md](../onboarding.md), "Hire a tool from your agent".

## C3: the Studio demo reads as a live listing

**The facts.** The Arc Studio share page and its Vercel app are an Arc Studio project. Their source is not in this repository. [status.md](../status.md) "An Arc Studio project link that opens logged out" says the Studio app keeps the existing escrow addresses.

- The share page: `https://studio.arc.io/share/countersign-automated-software-marketplace-9tfb9kfte9`.
- The app: `https://arc-studio-16e0b317ec5f406a8d7d24bf.vercel.app/`.
- The ready "Extract line items from a PDF invoice" offer at 4.50 USDC is a sample, regenerated on each load, with an empty seller.

**The copy.**

- A visible "Demo" label.
- One line: "This is a sample, not a live listing."
- One pinned offer hash.
- A named seller filled in.

## C4: "Unnamed seller"

**The facts.**

- **No name field.** An offer has no display name.
- **Where a name can come from:**
  - **ENS:** the seller proves an ENS name on Sepolia with `--ens`, and every EVM payee must be that address ([guides/seller.md](../guides/seller.md));
  - **ERC-8004:** the seller has an identity, which the hub shows on `/sellers`.
- **Where the label comes from.** Without either, the console has only the address. The label "Unnamed seller" is in `apps/web/src/routes/registry/index.tsx` (line 261) and `apps/web/src/routes/buyer/Approvals.tsx` (line 217). The `named: false` flag is set in `apps/web/src/lib/api.ts`.

**The copy.** Print "anonymous by design" next to the address when the seller has no name. Keep the address.

## C5: the Studio ledger falls behind silently

**The facts.** The same Studio app reads Arc testnet through `https://rpc.testnet.arc.io/`, which answered HTTP 429 during the test. Its ledger showed "Syncing, 2201 blocks behind", down from about 30,201.

**The copy.**

- Show "last synced block N".
- While it is behind, show "catching up, N blocks behind".
- Back off on 429s, so it never sits behind without saying so.
