> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# STEER-2130: the project lead's three decisions, and the independent audit's findings

From the project lead at about 21:30 IST. These findings outrank polish. In slot order they come right after the production Privy purchase, which is already running.

## Decisions

1. **cs-61, the e2e fixes: option (a).** Both assertion changes are accepted.
   - They make the tests correct; they do not weaken them. A refunded held call genuinely has no slip, and the HCS check still requires kind `expired`, the schedule, the create tx and the agent as the writer.
   - Put the old-to-new evidence in the PR body, exactly as cs-e2e wrote it in RUN-STATE (15:54:49Z), so the change can be audited and nobody can say a test was rewritten to pass.
2. **PR #178, the openapi adapter.** The `mcp.test.ts` example line is a unit-test fixture, not a product claim, so it may use synthetic values. The no-simulation rule binds the product surface, the README and the demo; it does not bind test fixtures. Merge when the gate is green.
3. **The iPhone test: yes.** The phone runner gets tested on the project lead's actual iPhone, against the production URL, with camera and location granted, running one job that releases on Arc, recorded.
   - It replaces the emulated-browser photo and is now on the proof list.
   - cs-phone arms the buyer only when the firstmate relays "starting".

## The independent audit: run against origin/main and the live deployment

The findings are listed in order of damage, with an owner for each.

| # | Finding | Owner | Done when |
|---|---|---|---|
| A1 | **The live offer page promises escrow, refund and release-gated payment unconditionally.** The live use-usdc offer lists gateway and hedera, and the README says direct rails pay first and nothing returns. | cs-ui (this absorbs the hub lane's "direct-rail honesty") | The offer page renders the terms from each rail's declaration (`/rails` kind) and branches its copy per rail kind: escrow, batched, direct, held. A test renders an offer with only gateway and hedera and finds no escrow, refund or release-gated promise. |
| A2 | **The buyer phone's envelope controls only mutate React state.** Save, revoke, allowlist and issue-new send no request, so "stops the agent at once" is false. | cs-ui (wire PUT /envelopes from every control); cs-truth (Opus, envelope semantics: revoke takes effect on the hub) | Every control's change is on the hub, read back after a reload. After a revoke, the hub refuses that agent's next call before any 402, and a test proves it. If any control cannot be made true tonight, its copy says exactly what it does. |
| A3 | **Hold to countersign in the assistant produces no signature, then says Countersigned.** | cs-ui | ui-A's honest copy is live: "Holding here signs nothing", and "Ready for <agent>. Run this on its machine". The next step: with a connected wallet, the card signs for real (ui-B's code) and posts it; otherwise it stays labelled. |
| A4 | **The held Hedera rail is not held against the seller.** The seller holds the second key and can submit the ScheduleSign itself, while the UI says the money waits. | cs-hd (Opus design: money path) | The fix is either to take that key, so that the hub's signature is also required and the seller alone cannot execute the schedule, or to say it plainly. **The plain copy ships at once on every surface** while the key change is designed. The key change lands only with a test and a live proof. |
| A5 | **The proof chain does not line up.** The published e2e run is on cs/e2e, the hub deploys cs/int, status is checked on cs/int, and the newest held released settlement links a SCHEDULECREATE with no token movement. **Also: the production deploy defaults to cs/int.** | orch-cs (the deploy script deploys main; production runs only main's commit); cs-e2e (publish a run on the deployed commit into main's `e2e/runs/LATEST.md`); cs-readme (status checked against main at the deployed sha); cs-hd (a held settlement links the schedule's execution transaction with its token transfer, never the SCHEDULECREATE) | The hub's `/healthz` (or deploy record) names main's sha, LATEST.md names the same sha, status.md names the same sha, and the held settlement's link opens a transaction that moved USDC. |
| A6 | **Privy `create_on_login` is off.** | cs-ui (ui-A2) | PrivyProvider sets `embeddedWallets.ethereum.createOnLogin: 'users-without-wallets'` as already instructed, and the e2e/human run asserts that the wallet exists after the first login. |
| A7 | **Fixture escrow addresses are not contracts.** | cs-ui | Fixtures use the real deployed escrow addresses, or are visibly labelled sample data with no explorer link presented as real. A test checks every fixture address that the UI links to. |

## Slot order

1. The production Privy purchase (in flight).
2. A1 and A3 (small UI honesty fixes).
3. A4's plain copy.
4. A5.
5. A2.
6. A7.
7. Then item 2 (the WalletConnect wallet) and the rest of the hub lane.

Load rule: no launch while the first load number is above 24.
