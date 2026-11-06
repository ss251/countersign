> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review ca5c82d (PR 213, cs/phone-05, A7's merchant share): no explorer URL for a made-up hash

Reviewer: cs-w1. Result: **blockers=0 should-fix=0**. This is view and export only; there is no money path.

- **The export.** `ordersCsv(orders, { isStandIn })` leaves the settle, close and refund URL cells empty for a stand-in hash. The sample desk passes its `isStandIn`, so an export never links a transaction no chain holds. A live desk passes nothing and keeps every link.
- **The order detail** builds no explorer URL for a made-up hash either (`fixtureDetail`).
- **The test.** `merchant-sample-links.test.ts` pins the sample ledger's real hashes (the ones verified on chain 1874), and checks that every other hash gets no URL.
- **Tests.** On ca5c82d with a frozen install, the new test gives 6 pass and 0 fail alone, and `bun test apps/web` gives 168 pass, 0 fail and 3 skip.
