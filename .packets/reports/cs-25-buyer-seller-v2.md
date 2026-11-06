# cs-25-buyer-seller-v2 — report

Status: done. Refs #98.

The buyer countersigns escrow v2's bond and review window only from a rail it pinned as v2, and the seller's runner registers the offer's bond terms with `bond terms`.

## What changed

### Buyer (`packages/buyer/src`)

- **`known-rails.ts`.** `KnownRail` gains `version?: 1 | 2`, documented as coming from the agent's own pin and defaulting to 1. No listed rail is marked v2; a deployment is marked v2 by the agent's pin (`KNOWN_RAILS` or `rails.json`).
- **`terms.ts`.** `checkTerms` reads the pinned version:
  - a v2 pin requires `extra.escrowVersion === 2`, `extra.bond === (offer.bond ?? "0")` and `extra.reviewWindow === (offer.reviewWindow ?? 0)`; a bond or window mismatch refuses with `Refused. The bond or review window in the payment terms is not the offer's.`;
  - a v1 pin facing `extra.escrowVersion === 2` refuses with `Refused. The escrow version is not the one this agent pinned.` The same sentence covers a v2 pin facing a 402 that does not say `escrowVersion: 2`.
  - Because `Offer` in `@countersign/core` has no `reviewWindow`, the buyer reads it as an optional extension (`Offer & { reviewWindow?: number }`); `packages/core` is outside this lease and is untouched.
- **`payer.ts`.** A rail pinned as v2 puts `bond` and `reviewWindow` into `CountersignTerms`, so `jobIdOf`, `authorizationTypedData` and `checkCountersign` derive the v2 `jobId` that is actually signed. A v1 pin constructs exactly the v1 terms as before.
- **`buy.ts` / `journal.ts`.** The `signed` entry carries `bond` and `reviewWindow` when the signed terms have them. `JournalEntry` gains the two optional fields.
- **`review.ts`.** `disputeJob` signs `Dispute(jobId)` as before and hands it to the hub. With `direct: true`, when the hub does not relay it, the agent sends `dispute(jobId, "")` from its own key as `msg.sender == buyer`. The default sender is a viem wallet client on the pinned rail's RPC, defined with the rail's chain id; a test-only `transport` hook injects the node. The result and the journal line carry the tx. Without `direct`, a hub failure is rethrown and nothing is sent.
- **`cli.ts`.** `--direct` is accepted on `dispute <jobId>` and passed with the agent account; the CLI prints the direct tx when one was sent. The usage line and default output are otherwise unchanged.

### Runner (`packages/runner/src`)

- **`bond.ts`.** `bond terms` parses `--offer`, `--price`, `--bond`, `--review-window`, `--min-duration`, `--escrow` and `--rpc`, and `--show` selects the read mode:
  - `setTerms(offerHash, price, bond, reviewWindow, minDuration)` is submitted from the seller's own key through the same account, public-client and wallet-client pattern `bond deposit` uses;
  - `--show` reads `termsOf(payee, offerHash)` for the seller's address and prints one JSON line: `{"price":"…","bond":"…","reviewWindow":600,"minDuration":120}`;
  - local refusals happen before any transaction: `bond > price`, `reviewWindow > 86400`, and a missing `--escrow`. No v2 escrow is deployed, so this build has no default escrow and `--escrow` is required.
  - `TERMS_ABI` is a hand-written `setTerms`/`termsOf` fragment with a header saying the generated ABI replaces it when the contract lands. `setTermsArgs` returns the five arguments in order.
  - `runBond` takes an optional `BondRunOptions` seam: `writeTerms` records a submission without a node, and `transport` supplies a stand-in RPC for `termsOf`.
- **`cli.ts`.** Header usage documents the two `bond terms` forms. The command dispatch already routed every `bond` subcommand through `bondFromEnv`.

### Tests

- **`packages/buyer/test/v2.test.ts`** (new). Fixed anvil keys and a fake hub:
  - a v2 pin with a matching 402 signs terms carrying the offer's `bond` and `reviewWindow`, the authorization nonce equals `jobIdOf` of those v2 terms (and differs from the v1 derivation), and the `signed` journal line keeps both;
  - a 402 with `bond + 1` or `reviewWindow + 1` refuses with the exact sentence, signs nothing, and journals `refused`/`terms`;
  - a v1 pin facing `escrowVersion: 2` refuses with the version sentence; a v2 pin facing a 402 with no `escrowVersion` refuses too;
  - a v1 pin with a v1 402 signs exactly as before: no bond or window in the terms, the v1 `jobId`, and no extra journal fields.
- **`packages/buyer/test/dispute-direct.test.ts`** (new). A hub that will not relay plus a custom viem transport:
  - with `--direct`, the agent signs `Dispute`, the tx recovers to the buyer's address, its `to` is the pinned escrow, and its data is exactly `dispute(jobId, "")`; the journal line carries the tx;
  - without the flag, the hub error is rethrown and no transaction is built.
- **`packages/runner/test/bond.test.ts`** (extended):
  - `bond terms` encodes `setTerms` with exactly `[offerHash, price, bond, reviewWindow, minDuration]`, and the injected submission receives the same five arguments from the seller's key;
  - `bond > price` and `reviewWindow > 86400` refuse in the parser, and a command built past the parser is still refused by `runBond` before the writer is called;
  - a missing `--escrow` and a malformed offer hash refuse;
  - `--show` decodes `termsOf` over a stand-in transport and prints the expected JSON.

## Tests run

From the worktree root, the acceptance sequence passed:

```
bun install
bun run typecheck                 # clean
bun test packages/buyer packages/runner   # 198 pass, 0 fail
bun test                          # 955 pass, 3 skip, 0 fail
forge test                        # 47 pass, 0 fail
```

No browser, Playwright, Puppeteer or screenshot tool was launched. No deploy, faucet or public RPC was used. The only chain tests are the runner bond suite's local anvil with fixed test keys; the new buyer and runner terms tests use fake 402s and injected transports/clients.

## Lease

No files outside the lease were created or changed: no `contracts/**`, `packages/core`, `packages/rail`, or `apps/**`; no `w1-*.test.ts`. No new dependencies.
