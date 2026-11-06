> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# Re-review 28fd4e2 (cs/hd-08c, PR 105, #41): the two should-fixes on 25e508b

Reviewer: cs-w1. Result: **blockers=0 should-fix=0**.

## Both should-fixes closed
1. **Release at the expiry boundary.**
   - `releaseExpired` now reads the mirror record.
   - It returns `executed` when the record shows an execution.
   - It releases only when the schedule is deleted, or 60 s past `expiration_time` with no execution; otherwise it stays `pending`.
   - `spentFromLog` adds back, once, a spend that lands after its schedule was released, so a mirror lag can no longer leave the envelope undercounted.
2. **The seller's check.** `countersignSchedule` refuses `waitForExpiry` and any payer other than the buyer before it builds a ScheduleSign. The doc now says a successful countersign is not payment: deliver only after `waitForScheduledExecution`.

## Note
- **Only seconds.nanos is parsed.** The new expiry read takes `Number(expirationTime.split(".")[0])`. If a mirror ever answered an ISO date, that is NaN and the hold is never released. This fails safe (money counted, not freed), but `secondsOf` already handled both forms, so reuse it.
