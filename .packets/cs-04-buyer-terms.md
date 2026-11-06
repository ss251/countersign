# cs-04-buyer-terms — the buyer signs only what the offer and a pinned rail say

## Setup

Run `bun install` at the worktree root before anything else.

This is a corrective packet on the existing buyer branch. Your worktree already holds `packages/buyer` (from cs-03), plus the reviewer's failing tests in `packages/buyer/test/w1-attacks.test.ts`. Read the review at `/Users/thescoho/Developer/countersign-mumbai/reports/review-8a18d5d.md` first.

## Goal

Make `buy()` refuse, before anything is signed or journalled as `countersigned`, any 402 entry whose terms differ from the offer the buyer asked for, or whose rail is not one the buyer knows. Close the reviewer's three should-fix items as well.

## Lease

You may create or change only these paths:

- `packages/buyer/src/**`, except `packages/buyer/src/hedera/`
- `packages/buyer/test/**`, but you must not weaken or delete any test in `w1-attacks.test.ts`
- `.packets/reports/cs-04-buyer-terms.md`

## What to build

1. `src/known-rails.ts`:
   - `export interface KnownRail { network: Network; scheme: "countersign"; chainId: number; escrow: Address; token: Address; tokenName: string; tokenVersion: string; rpcUrl: string }`
   - `export const KNOWN_RAILS: KnownRail[]` holds exactly two entries:
     - Arc testnet: `eip155:5042002`, chainId 5042002, escrow `0x44d11b8909485e3f575F6628b689383E4420f54a`, token `0x3600000000000000000000000000000000000000`, `"USDC"`/`"2"`, rpc `https://rpc.testnet.arc.network`.
     - Whitechain Sepolia: `eip155:1874`, chainId 1874, escrow `0x9279D3edeef4c3738a0b200D762e2985Ff3B7eb4`, token `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7`, `"Tether USD"`/`"1"`, rpc `https://rpc.testnet.whitechain.io`.
   - `knownRailFor(req, known)` returns the entry whose network, chainId, escrow, token, tokenName and tokenVersion all equal the requirement's. Compare addresses checksummed. If none matches, return `undefined`.
   - Tests and the CLI may pass an extra list. The CLI reads an optional `<state>/rails.json` holding `KnownRail[]` and appends it, so a local anvil can be used.
2. `src/terms.ts`: `checkTerms(offer, offerHash, entry, known): {ok: true; rail: KnownRail} | {ok: false; message}`. Refuse, with a message starting `Refused.`, when:
   - the scheme is not `countersign`, or `knownRailFor` finds nothing: "Refused. This rail is not one this agent knows.";
   - `extra.offerHash !== offerHash`, compared case-insensitively;
   - `entry.payTo` (checksummed) is not `offer.payTo?.[extra.rail] ?? offer.seller`;
   - `entry.amount !== offer.price` (both rails use 6-decimal tokens, so no scaling; refuse anything else);
   - `extra.deadlineSeconds !== offer.deadline`;
   - `entry.maxTimeoutSeconds > offer.deadline`.
3. `buy()`: call `checkTerms` right after picking the entry and before the envelope check. On refusal, append a `refused` entry with `reason: "terms"` and throw `BuyError(message)`. The payer must receive the matched `KnownRail` and use its escrow, token, tokenName, tokenVersion and chainId when it builds the authorisation, never `entry.extra`'s. Change `countersignPayer` accordingly.
4. Should-fix 2, reservation under a lock:
   - `Journal` gets `reserve(entry, decide: (spend) => EnvelopeDecision)`. Under an exclusive lock it re-reads the journal, runs the decision on the fresh spend, and on `ok` appends `{kind: "countersigned", ...}` before any signature exists. For the lock, `openSync(path + ".lock", "wx")`, retried for up to 5 s, then unlinked.
   - `buy()` uses `reserve` in place of the separate envelope check and `countersigned` append.
   - If signing then fails, append `failed` for that jobId so the reservation is released.
   - The jobId is not known before signing, so reserve with a client-generated `reservationId`, and add `jobId` in a follow-up `signed` entry. `spend()` counts reservations by `reservationId`. Keep `open()` working from the jobId of the `signed` entry.
5. Should-fix 3: `resume` must not trust the hub for refunds.
   - When the hub says `refunded`, read `jobOf(jobId)` on the matched rail's `rpcUrl` with viem `createPublicClient` and `readContract`. The minimal ABI is `jobOf(bytes32) returns (address buyer, uint64 deadline, uint8 status, address payee, uint256 amount, bytes32 offerHash, bytes32 slipHash)`, a tuple with those components; status 3 means refunded.
   - Append `refunded` only when the chain says 3. Otherwise append nothing and report "hub says refunded; chain does not".
   - Inject the read function so tests can stub it.

## Tests

- Every test in `w1-attacks.test.ts` passes, unchanged.
- Add tests for:
  - an unknown escrow, refused before signing;
  - an unknown token, refused;
  - a known rail entry from `rails.json`, accepted;
  - two concurrent `buy()` calls under a cap that fits only one: exactly one countersigns and the other is refused by the envelope;
  - resume, where the hub says refunded but the stubbed chain says released: no `refunded` entry;
  - resume, where the hub says refunded and the stubbed chain says 3: a `refunded` entry.
- Existing tests keep passing. Update their fake 402s to name a known rail by passing an extra known list.

## Constraints

Never launch a browser of any kind (Chrome, Chromium, Playwright, Puppeteer, headless or not), never take screenshots, never call a faucet, never use a private key from anywhere but test fixtures. TypeScript strict, no `any`. The buyer key never reaches argv or a log. Keep files under about 250 lines.

## Acceptance

From the worktree root:

```
bun install && bun run typecheck && bun test packages/buyer && bun test && forge test
```

Every command passes, with no skipped or todo tests.

## Stop conditions

- You need to edit outside the lease: stop and write the report.
- One problem has blocked you for more than 20 minutes: stop, commit what passes, and write the report.

## Finish

Commit on your branch with small present-tense messages and no trailers. Write `.packets/reports/cs-04-buyer-terms.md`. Do not push, merge or deploy.
