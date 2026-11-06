> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Re-review d0f9729 (cs/hd-13e): the countersigner checks the served offer, not the hub's order

Reviewer: cs-w1. Result: **blockers=0 should-fix=0**. This closes the should-fix on 5a9c00b.

- **The daemon** refuses a `hedera-scheduled` order before any work or signature unless `order.amount` equals the served offer's price and `order.payTo` equals the offer's `payTo["hedera-scheduled"]`. An offer that declares no held payee is refused. The check runs ahead of the funding check and the child spawn.
- **The countersign** therefore checks the schedule against the seller's own terms, and `mcp-seller.ts` uses the Hedera USDC constant, not `order.asset`. A hub can no longer get a countersignature for a schedule that pays less than the price, or pays in another token.
- **Tests:** runner and Hedera rail give 200 pass and 0 fail on d0f9729.
