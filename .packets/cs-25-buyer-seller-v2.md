# cs-25-buyer-seller-v2: the buyer countersigns v2 terms, and the seller registers its bond terms (refs #98)

## Setup

Run `bun install` at the worktree root before anything else. You are on `cs/cs-25`, cut from `cs/int`.

## The design is decided (orch-cs)

Read these first:

- `docs/spec/escrow.md`, the section "Escrow v2";
- D16 in `docs/decisions.md`.

The contract half is Rajdeep's and not written yet. Build against the spec's interface. Never touch `contracts/**`, `packages/core`, `packages/rail` or `apps/**`.

**Core already does the v2 countersignature.** Terms carrying `bond` and `reviewWindow`, both even when zero, derive the v2 `jobId` through `jobIdOf`, `authorizationTypedData` and `checkCountersign`. Terms without them stay v1. A v2 rail's 402 carries `extra.bond` (atomic string), `extra.reviewWindow` (seconds) and `extra.escrowVersion: 2`.

## Build

### 1. The buyer countersigns v2 terms (`packages/buyer`)

- **`KnownRail` gains `version?: 1 | 2`,** default 1. The version comes from the agent's own pin, never from the hub.
- **When the chosen countersign rail is pinned as version 2:**
  - require `extra.escrowVersion === 2`;
  - require `extra.bond === (offer.bond ?? "0")` and `extra.reviewWindow === (offer.reviewWindow ?? 0)`;
  - otherwise refuse with "Refused. The bond or review window in the payment terms is not the offer's.", journalled as `refused`, with no signature.
  - Put `bond` and `reviewWindow` into the countersigned terms, so the v2 `jobId` is what gets signed.
- **When the chosen rail is pinned as version 1** and the 402 says `escrowVersion: 2`, refuse with "Refused. The escrow version is not the one this agent pinned." A hub cannot switch versions.
- **The `signed` journal entry** keeps `bond` and `reviewWindow` when present.
- **`dispute <jobId> --direct`** (cs-w1's should-fix on #130): when the hub does not relay a dispute, the agent submits `dispute(jobId, "")` itself from its own key, as `msg.sender == buyer`. It uses a viem wallet client on the pinned rail's RPC, and the CLI prints the tx. Keep it behind the flag. Default behaviour is unchanged.

### 2. The seller registers its bond terms (`packages/runner`)

- **`cli.ts bond terms`** gains the subcommand `bond terms --offer <offerHash> --price <atomic> --bond <atomic> --review-window <seconds> --min-duration <seconds> [--escrow <address>] [--rpc <url>]`.
  - It calls `setTerms(offerHash, price, bond, reviewWindow, minDuration)` on the v2 escrow from the seller's own key.
  - Reuse `bond.ts`'s existing account and transport pattern, the one `bond deposit` uses.
  - Refuse locally, before any transaction:
    - `bond > price`;
    - `reviewWindow > 86400`;
    - a missing `--escrow` when no default is set.
- **The ABI.** Keep a hand-written `setTerms` and `termsOf` fragment in `bond.ts`, with a header saying it is replaced by the generated ABI when the contract lands.
- **`bond terms --show`** reads `termsOf(payee, offerHash)` and prints it.

## Lease

You may create or change only:

- `packages/buyer/src/*`, plus `packages/buyer/test/*` except `w1-*.test.ts`;
- `packages/runner/src/{bond.ts,cli.ts}` and `packages/runner/test/bond.test.ts`;
- `.packets/reports/cs-25-buyer-seller-v2.md`.

## Tests

No network. Use fixed anvil test keys, fake 402s, and an injected transport or mocked wallet for transactions.

1. **Buyer v2:**
   - a v2-pinned rail with a matching 402 signs terms carrying `bond` and `reviewWindow`, and the authorization's nonce equals `jobIdOf` of those v2 terms;
   - a 402 whose bond or window differs from the offer's refuses and signs nothing;
   - a v1 pin facing `escrowVersion: 2` refuses;
   - a v1 pin with a v1 402 signs exactly as before.
2. **Dispute direct:** `--direct` builds `dispute(jobId, "")` sent from the agent's address. Without the flag, nothing changes.
3. **Runner terms:**
   - `bond terms` encodes `setTerms` with exactly the five arguments;
   - `bond > price` and `reviewWindow > 86400` refuse before any call;
   - `--show` decodes `termsOf`.
4. Every existing buyer and runner test passes.

## Constraints

- **Never launch a browser of any kind on this machine:** no Chrome or Chromium, headless or not, no Playwright, Puppeteer or screenshot tools. UI checks go back to the lane, which raises NEEDS-BROWSER.
- Never touch `contracts/**`, `packages/core`, `packages/rail` or `apps/**`. Never deploy, never call a faucet, never use a public RPC in tests.
- No view code. TypeScript strict, no `any`. No new dependencies.

## Acceptance

From the worktree root:

```
bun install && bun run typecheck && bun test packages/buyer packages/runner && bun test && forge test
```

Every command passes.

## Stop conditions

- You need to edit outside the lease: stop and write the report.
- One problem has blocked you for more than 15 minutes: stop, commit what passes, and write the report.

## Finish

Commit with small present-tense messages ending `(refs #98)`, and no trailers. Write `.packets/reports/cs-25-buyer-seller-v2.md`. Do not push, merge or deploy.
