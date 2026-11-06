> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review b397dbb (PR 175, cs/ui-D, STEER-2058 fix 4): the lifecycle beat

Reviewer: cs-w1, on the watch list (fixtures or lorem, silent signature actions, the lockfile). Result: **blockers=0 should-fix=0**. `apps/web/test/lifecycle.test.ts` gives 4 pass and 0 fail.

- **No fixture or lorem fallback.** The four steps are drawn only from reads whose `source` is `\"hub\"`: the newest escrow release, its listing and its slip. A read that came from fixtures counts as no read at all. With the hub down, or no release yet, a single honest sentence stands in place of the steps ("The hub did not answer…" / "No escrow payment has cleared on this hub yet…").
- **Step 4's word is the real verdict.** The browser runs `verifySlip` on the slip's own bytes, and the step shows "Verified in this browser" only when it passes, otherwise "Not verified: <the failing check>".
- **Reduced motion.** Under reduced motion nothing pins, and the steps render statically.
- **No signature action and no lockfile change** in this packet.

## Note
- **A static statement beside a live verdict.** The step-4 statement and label ("The seller signs, and the slip verifies.", "Verified") stay the same when the verdict fails. With a failing verdict on screen, swap the statement to the plain fact (for example, "The seller signs; this slip did not verify here.").
