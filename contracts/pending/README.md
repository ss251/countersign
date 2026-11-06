# Pending: escrow v2 review window (#98)

Nothing here is compiled. `foundry.toml` builds only `contracts/src`, `contracts/test` and `contracts/script`.

- `Acceptance.t.sol` holds the six tests #98 requires, plus edge cases. It is written against the v2 interface in `docs/spec/escrow.md`:
  - `fundBonded(offerHash, cs, bond, reviewWindow)`, callable only by the arbiter;
  - `accept`, `dispute` and `releaseAfterWindow`;
  - `reviewOf(jobId) -> (window, deliveredAt, endsAt)`;
  - the `Delivered` and `Disputed` statuses, and the v2 events and errors.

  It moves into `contracts/test` in the same commit as the contract change. That waits until the seller bond (#93, `cs/cs-19`) merges into `cs/int`, because the contract has one editor at a time.
- `review-window-prototype.patch` is a throwaway implementation on top of `cs/cs-19` (22df20a). It was used only to check that the tests pass against a contract that follows the spec, and that they fail when the contract breaks the spec. It is a starting point, not the reviewed change. Delete it before the pull request.

This directory is removed when the contract lands.
