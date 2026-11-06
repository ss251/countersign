# cs-76-e2e-v2-arbiter: on escrow v2, a local hub that is not the arbiter reports NOT RUN, not red

Lane: cs-e2e. Base: `cs/e2e`. Branch: `cs/cs-76`.

## Evidence

The first e2e run on Arc escrow v2 (partial run 20261106-203459-8301, `E2E_ESCROW_VERSION=2`,
`E2E_ARC_ESCROW_V2=0x10A3c07cc6A519C0106e315D2C42010eCbEFF3CE`):

- `runner-restart`, `arc-wrong-amount` and `refusals` pass.
- The v2 fund works.
- `arc-spine` fails at "countersign, fund, deliver, release", because the hub's release reverts
  `ReleaseNeedsArbiter`.

The cause is the v2 contract itself. `release` begins with `if (msg.sender != arbiter) revert
ReleaseNeedsArbiter(jobId);`. Arc v2's arbiter is the production hub's relayer
(`0xE37F64A73225f5eA06BABcb1cc5440F01446C267`). The suite's local hub signs with its own submitter key
(`E2E_ARC_SUBMITTER_KEY`, address `0xEE4d89C544D09968dA97842e6F7be4904fbF3934`), by design, so it never
races production's nonce. An `eth_call` of `release` from the submitter reverts `ReleaseNeedsArbiter`.
From the arbiter, the same call passes that check.

So on this escrow, no local-hub flow can settle on v2. That is a fact about the deployment, not a product
bug and not a test failure. Until the project decides between an e2e deployment and production on v2,
the suite must say so instead of spending funds on a release that cannot land.

## Changes

### `e2e/lib/chains.ts`

1. `export function arbiterReason(version: 1 | 2, arbiter: Address | null, submitter: Address): string | null`,
   a pure function:
   - Return `null` when `version` is 1, or when `arbiter` equals `submitter` (case-insensitive).
   - Otherwise return
     `escrow v2 releases only from its arbiter ${arbiter}, and this suite's hub signs as ${submitter}`.
2. `export async function arcArbiter(): Promise<Address | null>`:
   - On v2, read `arbiter()` from `ARC.escrow` with the ABI fragment
     `function arbiter() view returns (address)`.
   - Return `null` on v1.

### `e2e/lib/actors.ts`

Add `export function submitterAddress(ctx: FlowCtx): Address`. It returns the address of
`ctx.env.secrets.key("E2E_ARC_SUBMITTER_KEY")` through viem's `privateKeyToAccount`. It returns only the
address and never logs the key.

### Flows: `arc-spine`, `arc-deadline-refund` and `ratings`

Make this the very first thing in `run`, before `startHub` and before anything is funded:

```ts
const blocked = arbiterReason(ARC.escrowVersion, await arcArbiter(), submitterAddress(ctx));
if (blocked) throw new NotRun(blocked);
```

`NotRun` comes from `e2e/lib/flow.ts`. On v1 this is a no-op, because `arcArbiter()` returns null and
`arbiterReason` returns null. Nothing else in these flows changes. `slip-onchain-arc` needs `arc-spine`,
so it reports NOT RUN by itself.

## Tests (`bun test e2e/test`)

`arbiterReason`:

- version 1 gives null;
- version 2 with the same address in different case gives null;
- version 2 with a different address gives a string that names both addresses.

## Docs

In `docs/e2e.md`, section "Escrow version", add one paragraph. v2 releases only from its arbiter, and the
Arc v2 escrow's arbiter is the production hub. A run with a local hub therefore reports `arc-spine`,
`arc-deadline-refund` and `ratings` as NOT RUN, naming both addresses. They run once the suite's hub is
the arbiter, through an e2e deployment, or once production serves v2.

## Gate (paste the tails)

1. `bun install --linker hoisted && bun run typecheck` clean.
2. `bun test e2e/test` and `bun test e2e/human/test` all pass.
3. `bun run e2e -- --list` lists every flow.

## Constraints

- No browser of any kind on this machine. Do not run any flow (`--list` only); flows move real funds.
- **Never run `git stash`;** use a temporary commit or a second worktree.
- Touch only `e2e/lib/chains.ts`, `e2e/lib/actors.ts`, the three flow files, `e2e/test/**` and
  `docs/e2e.md`. Never read or print a key.
- Never push, merge or deploy. Make small present-tense commits on `cs/cs-76`, with no emoji, no
  Co-authored-by and no trailers.
- If something cannot be done as written, stop and say exactly what and why.

## Report

`.packets/reports/cs-76-e2e-v2-arbiter.md`: the changes with line ranges, and the gate outputs.
