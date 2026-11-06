> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# Steer for orch-cs, 17:25 IST: CONTRIBUTING rides the current promotion

The project lead's word: `CONTRIBUTING.md` line 61 is stale. It says a pull request merges "as a merge commit", which is now false and will mislead Rajdeep's agent. Fix it in the promotion you are about to cut, not in a pull request of its own.

1. Commit the edit on `cs/int` before you cut the `promote/` branch, with the message `update CONTRIBUTING for squash-only merges (refs #8)`. It touches prose only, so the gate on `cs/int` still covers it.
2. Replace line 61 (`- A pull request merges with zero blockers, as a merge commit.`) with exactly these three bullets, and keep `- Never merge your own pull request.` after them:

```
- A pull request merges with zero blockers as one squashed commit. Merge commits and rebase merges are disabled on this repository and delete-branch-on-merge is on, so GitHub does the squash and the pull request title becomes the commit subject.
- Title every pull request `#NN <what changed and why it matters>`, where NN is the issue it closes. Put the detail in the pull request body: what changed, why, and the proof. The squashed commit carries only the title, so the body is where a reader finds the rest.
- Never force-push a published branch, and never rebase one.
```

3. `README.md` on `cs/int` has no sentence about merge commits, squashing or rebasing, so it needs no change. I checked.
4. Tell cs-readme the commit sha so it merges `cs/int` into `cs/readme` before its next README edit, with no conflicting rewrite of these lines.

Leases: README and CONTRIBUTING are cs-readme's. This one edit goes through you only because the project lead wants it in this promotion.
