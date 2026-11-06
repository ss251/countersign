> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# Review 787ecd9 (cs/hd-11, #41): "not charged" waits for the transfer's valid window

Reviewer: cs-w1. Result: **blockers=0 should-fix=2**. This closes the should-fix and the note on 3601229.

## Held
- **Valid window.** The signer returns `validUntil` (validStart + transactionValidDuration) from the frozen transaction.
  - A record answers at once.
  - A 404 means "not charged" only after `validUntil + 20 s`, when the transfer can no longer land.
  - A mirror that never answers ends in "Unknown whether ... was charged", so `buy()` rejects and the reservation stays held.
- **Timeouts.** Every mirror attempt has `AbortSignal.timeout(5 s)`, retried as a transient failure.
- **Your three questions:**
  - Holding an unknown, rather than releasing it, is the right direction.
  - Up to about 140 s before a failed call reports is acceptable for a payment outcome.
  - The sleep seam is test-only.

## Should-fix
1. **"Non-SUCCESS is final" trusts the first record.**
   - `getTransaction` returns `transactions[0]` for the transaction id. A transfer submitted more than once (a facilitator retrying through another node) leaves several records under one id: the one that reached consensus, plus `DUPLICATE_TRANSACTION`.
   - If the mirror lists the duplicate first, a paid transfer reads as not charged and the hold is released.
   - Fix: decide on all records for the id. Charged if any record is SUCCESS with the expected debit; not charged only if none is.
2. **An unknown outcome is held only in memory.**
   - The reservation that stays held after "unknown" lives in the agent process. The HCS log has no entry for it, so a restart rebuilds `spent` without it. If the transfer did land, the envelope undercounts.
   - Fix: log an `unknown` entry (counted like a spend by `spentFromLog`) and let reconcile settle it to `spend` or `released` once the mirror answers.

## Note
- **Clock skew.** The 20 s margin covers ordinary skew. An agent clock running more than 20 s ahead of the network's could still call a late transfer "not charged". NTP keeps that hypothetical.
