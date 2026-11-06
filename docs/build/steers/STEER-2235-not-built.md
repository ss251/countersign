> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# STEER-2235: build all nine NOT BUILT rows

From the project lead at about 22:35 IST. Only two of the rows are externally blocked.

**Order of work:**
1. The contract audit fixes and the deploy stay first, because they gate Whitechain.
2. Then Privy and the Hedera wallet.
3. Then this list, in the order below.

A free lane takes its next item from this list, never from a new idea.

**Report at 23:30:** one line per item, with its artefact: a run id, a URL or a tx hash. Each owner posts its line in RUN-STATE by 23:20.

| # | Row | The project lead's spec | Owner | Deadline (IST) |
|---|---|---|---|---|
| 1 | **erc8183 escrow rail with a JobHook committing the slip** (#24) | Design it as a rail like the others: an adapter over the existing 8183 escrow if the interface allows, with the hook emitting the slip hash. A DeepSeek packet writes it against an Opus spec. It needs a test that a settle emits the hook. | cs-truth writes the Opus spec, after tr-04 | spec 23:45, landed 01:30 |
| 2 | **Refund on direct rails** | Hedera is already covered by the held rail, so the remaining one is Gateway. Either implement settle-after-delivery for Gateway (the buyer's signed authorization is held and submitted only after the gate passes), or drop Gateway from the rails the production hub declares. Status says which. | orch-cs decides | decision 23:15, done 00:30 |
| 3 | **Delisting with a canary** (#26) | PR #186 is open: land it, then add the automatic delist when a runner misses its canary. | cs-truth (#186 and the automatic delist); cs-phone (phone-04, so an online phone answers the canary and is never delisted by it) | 23:30 |
| 4 | **Cycle refusal before payment** (#27) | Lineage is already carried, so refuse a call whose offer lineage contains its own offer hash, with a test. | It is on cs/int through #182 (a call nested in a purchase of the same offer or seller is refused before payment). cs-truth confirms or adds the test for exactly "lineage contains its own offer hash"; orch-cs promotes and deploys. | 23:00 promotion |
| 5 | **Receipt trees** (#18) | `/trees/:root` and the tree view, with the children list actually populated when a job buys another offer. | orch-cs writes the spec: the hub route, the runner or buyer recording the parent job, and the slip's children. DeepSeek packets write the hub and runner halves; cs-ui draws the tree view after the screens pass (Opus pixels). | 01:00 |
| 6 | **The hub in Circle's own catalogue** | Externally blocked: Circle's catalogue held no testnet services. Mark it blocked by the ecosystem, with the evidence, rather than pretending. Do not spend a minute on it. | cs-readme (status value "BLOCKED (ecosystem)", with the evidence and the date; add that value to the legend) | now |
| 7 | **The Arc Studio public link** | Try the Netlify or Hugging Face deploy from Studio once. If it cannot open logged out, the pitch marks it NOT BUILT. | The firstmate, once, in the project lead's signed-in Chrome; then orch-cs and cs-readme for the pitch and status | 23:15 |
| 8 | **Railway's GitHub app** | One click from the project lead. | The firstmate asks the project lead; orch-cs confirms that production then follows main | when he clicks |
| 9 | **Anything else still NOT BUILT** when status is next read | Same treatment. | cs-readme re-reads status after every promotion and posts each NOT BUILT row with a proposed owner. The openapi adapter (#178) and cycle refusal (#182) are on cs/int: they flip when promoted and deployed. | after each promotion |
