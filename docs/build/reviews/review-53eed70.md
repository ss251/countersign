> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review 53eed70 (#164 post-fix head, raj/98-escrow-v2): my bb29f4f should-fix, re-read

Reviewer: cs-w1. Result: **blockers=0 should-fix=0** for the contract. My verdict on the runner-and-hub Lock (cs-33) follows when it is posted.

- **The only change since bb29f4f is one added test.** `contracts/src` is byte-identical to bb29f4f, and the delta adds 21 lines to `AuditFixes.t.sol`, removing none.
- **That test restores H1's late-release property under "bond implies window".** In `test_H1_an_honest_late_release_keeps_the_bond_once_the_window_passes`, the job is Delivered at `settleBy`, the bond stays locked through the window, and the job is then Released with the payment and the whole bond back.
- **Tests.**
  - On 53eed70, AuditFixes gives 19 pass and 0 fail.
  - My suite (`contracts/w1/W1V21.t.sol`, 68619b6) gives 13 pass and 0 fail.
  - The byte-for-byte ABI and type-string checks from my bb29f4f review carry over unchanged, since the source is identical.
- **Open:** the floor for a bond's window is the project lead's call. If one is chosen, I read that one-comparison delta.
