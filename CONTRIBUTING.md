# Contributing to countersign

countersign is a payment protocol for software agents: one countersignature binds an offer, a payee and an amount, and the call leaves a receipt that verifies without the hub.
This guide is for anyone sending a pull request: the hub, the rails, the agents, the contracts, the console or the docs.

## Toolchain

You need [bun](https://bun.sh) 1.3 and [foundry](https://getfoundry.sh). CI pins bun 1.3.14 and foundry v1.5.1.

```sh
git clone https://github.com/ss251/countersign.git
cd countersign
bun install --frozen-lockfile
bun run gate
```

Solidity dependencies come from `bun install` as well. There are no git submodules.

## Branches and pull requests

```sh
git fetch origin
git switch -c fix/escrow-refund-message origin/cs/int
```

- Branch from `origin/cs/int` and name the branch `type/slug`, for example `feat/hedera-payto` or `docs/slip-spec`.
- Never commit to `main` or `cs/int`.
- Open the pull request against `cs/int`. Its title becomes the commit subject, so write it as `#NN <what changed and why it matters>`, where `#NN` is the issue it closes. Put the detail in the body: what landed, why, the gate counts, proof links and `Closes #NN`.

  ```sh
  gh pr create --base cs/int --title "#12 refuse a release whose slip hash is zero" --body-file pr.md
  ```

- Every pull request is squash-merged, so it lands as one commit. Small commits on your branch are fine.
- After your pull request is merged, merge `origin/cs/int` into your branch before you start new work, so your next pull request shows only new work:

  ```sh
  git fetch origin
  git merge origin/cs/int
  ```

- `cs/int` is where work integrates. `main` follows it after every green gate.

## Commits

- An imperative, present-tense subject: `add the gateway balance script`, not `added` or `adds`.
- One idea per commit.
- Name the issue: `refs #N`. The pull request that finishes the issue says `Closes #N`.
- No agent co-author trailers.
- Real timestamps only. Never set `GIT_AUTHOR_DATE` or `GIT_COMMITTER_DATE`, and never rewrite a commit that has been pushed.

## The gate

```sh
bun run typecheck
bun test
forge test
bun run web:build     # when apps/web changes
```

- CI runs the same steps on every pull request, offline, with no secrets.
- A red gate never goes to review.
- Run `bun install` after every merge or pull. A merge that adds a dependency leaves your tree broken until you do.

## Review

- Findings arrive as comments on the pull request.
- Address them with new commits on the same branch.
- A pull request merges with zero blockers as one squashed commit. Merge commits and rebase merges are disabled on this repository and delete-branch-on-merge is on, so GitHub does the squash and the pull request title becomes the commit subject.
- Title every pull request `#NN <what changed and why it matters>`, where NN is the issue it closes. Put the detail in the pull request body: what changed, why, and the proof. The squashed commit carries only the title, so the body is where a reader finds the rest.
- Never force-push a published branch, and never rebase one.
- Never merge your own pull request.

## Secrets and safety

- No keys and no `.env` files in the tree. `.gitignore` excludes every `.env*` except `.env.example`.
- The maintainers scan every push they make with gitleaks. CI does not run it, so run it yourself before you push:

  ```sh
  gitleaks git --log-opts="origin/cs/int..HEAD" .
  ```

- Use a fresh testnet wallet per chain for this project only.
- Never put a key in argv or a log. The CLIs print only addresses and transaction ids.

## Where things live

| Path | What |
|---|---|
| `contracts/` | `CountersignedEscrow`, `FeeSplit`, Foundry tests, deployments |
| `packages/` | `core` (types, canonical JSON, offer, countersignature, envelope, slip), `rail`, `buyer`, `runner`, `verify`, `relay` |
| `apps/` | `hub` (the server) and `web` (the console) |
| `docs/` | `status.md` (what is built and what is not), `spec/` (one page per protocol object), `decisions.md`, `proof.md`, `hedera.md`, `whitechain.md` |
| `examples/catalogue` | the skills the demo sellers serve |
| `scripts/` | Hedera and Gateway operator scripts |

Every issue carries its own acceptance criteria, and every pull request body links its issue.
