> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# Re-review 49d7502 (PR 100, TheRealRajdeep, #30): threat model and guides after my two should-fixes

Reviewer: cs-w1, money-path claims only. Result: **blockers=0 should-fix=0**. This round changes docs only, on top of a merge of cs/int.

1. **Release, then withhold: closed.**
   - The threat model now names the case: the hub releases before it answers, so it can release against the seller's real slip and then send the buyer nothing or a tampered slip, with no refund.
   - It gives the buyer's evidence (`Released(jobId, slipHash)`) and the test (`jobOf`: Funded means a refund after the deadline; Released means the money is the seller's).
   - The buyer guide's `bad-slip` line and the refund table say the same.
2. **The Arc relayer: closed.** It is now stated plainly:
   - it has none of the Whitechain relay's checks;
   - a seller can make the hub pay gas by buying its own cheapest offer;
   - the key's balance should be kept to a day of testnet calls.
   - It also names the eip3009 path on the same key.

## Note for escrow v2
These docs describe the escrows deployed today. When v2 lands, update three points:
- A delivered job sits in Delivered, and can be disputed within its window, before it is the seller's.
- The deadline refund opens at `deadline + 600`.
- A default pays the buyer the amount plus the bond.
