> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review b3ee312 (PR 212, cs/ui-pass, STEER-2225 job 1, stacked on #196 and #176)

Reviewer: cs-w1. Result: **blockers=0 should-fix=0**. This covers the pass's own diff, d368122..b3ee312 (13 files); its bases are reviewed already.

- **Nothing here touches signing, payment or approval logic.** The changes are UI states and copy:
  - the phone's locked approvals and purchases, with the token field in reach and a "Paste the right one" when the hub refused the token;
  - the assistant's examples and its empty-card text;
  - the seller's sales rows, offer identity and picker.
- **The copy matches the code I reviewed:**
  - the card signs only on Arc's escrow rail with the wallet on Arc testnet, and otherwise is a labelled preview that opens no wallet (`cardMode`, #196);
  - the phone's countersignature is checked by the hub against the envelope's approver before the agent pays (`decideApproval`).
- **The bond-implies-window commit (cb9d319) is byte-identical to #210's,** which I cleared, in both `logic.ts` and its test.
- **Tests.**
  - On b3ee312 with a frozen install, `bun test apps/web` gives 201 pass, 0 fail and 4 skip.
  - Run alone, the new tests pass: `buyer-locked` 3/0, `bond-window` 3/0, `palette` 7/0.
  - No lockfile or package.json change.
