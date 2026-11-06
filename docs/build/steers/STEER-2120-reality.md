> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# STEER-2120: the reality rule, and the simulation sweep

From the project lead at about 21:20 IST. It holds from now until submission and overrides convenience.

## The rule

**A claim is real only if one of three things exists:**

1. a green end-to-end flow that touches the real chain;
2. a live URL the project lead can open logged out;
3. a signed transaction link.

**Anything else is IN PROGRESS.** It does not appear in:

- the pitch;
- the README headline;
- the demo script (`$M/DEMO-SCRIPT.md`).

Every lane checks its own copy against this rule before it posts DONE:

- cs-readme: the README and status.md;
- orch-cs: the demo script and the pitch;
- cs-ui: the console's copy.

## The list, in the project lead's order

Slots and cs-w1's reviews follow this order. **Report at 23:00:** each item's artefact, which is a run id, a URL or a transaction hash. Nothing else counts as an artefact.

| # | Item | Owner | Artefact for 23:00 |
|---|---|---|---|
| 1 | **Privy in production:** sign in, an embedded wallet, funded on Arc, a real purchase, the slip verified. This is the demo's first thirty seconds, so it is first. | cs-ui (ui-A2), cs-truth (the hub's Privy check), cs-e2e (e2e/human) | the e2e/human run id, the fund tx and the slip link |
| 2 | **The Hedera user wallet over WalletConnect:** the headless wallet proves the protocol (STEER-2113 amendment), and a HashPack pairing happens on the project lead's Chrome. The pairing is the project lead's own hands: the firstmate does not create or import wallet accounts. | cs-hd | the session topic, the tx id and the mirror readback |
| 3 | **The phone runner on a real phone,** not an emulated browser. The project lead opens the console on his iPhone, grants camera and location, and runs one job that releases on Arc. It is a ten-minute manual test, recorded. | cs-phone (prep: a buyer ready to send one location job and one photo job, and the exact steps on one card), with the project lead | the two Arc release txs and the recording |
| 4 | **The e2e flows that say NOT RUN for want of a public hub:** point them at production and make them part of the run, so that erc8004, hedera-mcp and production-console are proven rather than parked. | cs-e2e | the run id with those flows green |
| 5 | **The Studio public link:** try Netlify or Hugging Face from Studio. If it truly cannot be done, the pitch drops the Studio track instead of apologising for it. | the firstmate, in the project lead's signed-in Chrome; orch-cs keeps the CLI path | a URL that opens logged out, or the track dropped from the pitch |
| 6 | **The two already in flight:** Hedera hold semantics (STEER-2050 Hedera) and the bonded escrow deployment (STEER-2050 Contract). | cs-hd and cs-e2e; orch-cs and cs-wc | the held-flow run id; the deploy txs and the bonded failDelivery tx |

**The simulation ledger.** Add a ledger at the top of `docs/status.md` that lists every remaining stand-in and its owner, so that nothing can hide again.

- Each stand-in gets a row: what is simulated or emulated, why, its owner, and the artefact that would retire it.
- Owner: cs-readme, with cs-truth supplying the sweep. Examples:
  - an emulated browser;
  - sample-data fallbacks;
  - a local signer standing in for a wallet;
  - flows not run against production;
  - a dormant contract version.

## How this fits the earlier steers

The closure list (STEER-2050), the console fixes (STEER-2058) and the PR queue still stand.

- Where they overlap with this list, this list's order wins for slots.
- Items already running finish.
- The 22:00, 22:30, 23:30 and 01:00 reports still happen.
- The 23:00 report is this list's.
