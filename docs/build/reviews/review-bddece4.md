> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review bddece4 (PR 177, cs/ui-C, STEER-2058 fix 3): the buyer surface keeps the console's identity

Reviewer: cs-w1, on the watch list. Result: **blockers=0 should-fix=0**.

- **No identity swap.** `#/buyer` keeps the console's shell, and the frame is labelled "Buyer's phone".
- **A link-chosen agent or hub is named on screen**, with "Use my own" to drop it. `lib/hub.ts` only adds `chosenHub()` and `forgetChoices()`; how a hub is chosen is unchanged. That helps against a link that sets `?hub=` to someone else's hub, which is also where the approval token would go.
- **Signing untouched.** `approver.ts` is not in the diff. The token form only moved behind "I run my own hub", with an honest line on where the token goes.
- **No fixture or lorem fallback, and no lockfile change.**
