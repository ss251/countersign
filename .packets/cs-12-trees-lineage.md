# cs-12-trees-lineage — a seller buys mid-run: bundle adapter, receipt trees, cycle refusal (refs #18 #27)

## Setup

Run `bun install` at the worktree root before anything else.

## Goal

A seller can itself buy while serving a call. Its slip then commits the slips of what it bought as `children`, and anyone can walk the tree from the root.

- A `bundle` adapter in the runner buys each of its parts through the hub, using the buyer package under the seller's own envelope. It passes the lineage on, returns the parts' outputs, and lists the parts' slip hashes as `children`.
- The hub refuses, **before any payment**, a call that would loop back to a seller already in the chain, and caps the chain's depth.
- `GET /trees/:root` walks a stored slip and its children.

## Lease

You may create or change only these paths:

- `packages/runner/src/**` and `packages/runner/test/**`
- `apps/hub/src/lineage.ts` (new) and `apps/hub/src/trees.ts` (new)
- `apps/hub/src/call.ts`: the lineage check before the 402 only
- `apps/hub/src/app.ts`: route registration only
- `apps/hub/test/trees.test.ts` and `apps/hub/test/lineage.test.ts` (new)
- `.packets/reports/cs-12-trees-lineage.md`

Do not edit any `package.json`, `bun.lock`, `packages/core/**`, `packages/buyer/**` or anything else. `packages/runner/package.json` already declares `@countersign/buyer` (the integrator adds it before you start; check it). If it is missing, stop and report.

## Read first

- `packages/core/src/wire.ts`: `JobOrder.lineage` and `slipBodyFor(..., children)`.
- `packages/core/src/types.ts`: `SlipBody.children`.
- `packages/buyer/src/buy.ts`: `buy()` and its `lineage` argument.
- `packages/runner/src/daemon.ts`, `apps/hub/src/call.ts` and `apps/hub/src/store.ts`.

## What to build

1. **Runner `bundle` adapter.** The served spec is `{adapter: "bundle", parts: Array<{offerHash: Hex; input: unknown}>, hub: string}`. Its offer has adapter `"skill"`, because `AdapterKind` has no bundle. Set `upstream` to `undefined` and describe the parts in the summary.
   - It runs in the daemon process, not the scrubbed child, because it needs a key.
   - Its key is a separate buyer key from env `CS_RUNNER_BUYER_KEY`, never the seller key. Its envelope is a JSON file at `--bundle-envelope <path>`. Its journal and state live in `--state`.
   - For each part, in order, call `buy({hub, offerHash, input, payers: [countersignPayer(account)], envelope, journal, state, now, approve: true, lineage: [...order.lineage, order.jobId]})`.
   - Collect `{offerHash, title, output, slipHash}` for each part.
   - The bundle's output is `{parts: [...]}`. Its output schema is `{type: "object", properties: {parts: {type: "array"}}, required: ["parts"]}`.
   - The bundle's slip uses `slipBodyFor(order, seller, inputHash, outputHash, now, children)`, where `children` lists the parts' slip hashes in order.
   - If any part fails, the whole job fails with `"Refused. Part <n> could not be bought: <reason>"`. Parts already bought stay bought, and their slips stay in the journal.
   - CLI: `serve --bundle <path to bundle.json>` (repeatable), where `bundle.json` is `{title, summary, price, deadline, rails, parts}`.
2. **Hub lineage check** (`apps/hub/src/lineage.ts`), called in `call.ts` right after the input gate and before any 402 or payment:
   - `lineage` must be an array of 32-byte hex jobIds, at most 4 long. Otherwise 422 `bad-lineage`.
   - For each jobId the hub knows (`store.getJob`), look up that job's offer seller. If any equals this offer's seller (case-insensitive), answer 409 `cycle`, `"Refused. This call would loop back to a seller already in the chain."`, and call no rail method.
   - Unknown jobIds are allowed: they may be on another hub.
3. **Trees** (`apps/hub/src/trees.ts`). `GET /trees/:root` returns `{root, nodes: {[slipHash]: {slip, title, verified, depth}}}`.
   - Walk `slip.body.children` breadth first from the stored root slip, at most 3 levels deep and 50 nodes.
   - A child not stored on this hub appears as `{slip: null, title: null, verified: false, depth}`.
   - `verified` is true only when `slip.hash === slipCommitHash(slip.body)` and `slipSigner(slip)` equals `slip.body.seller`.
   - If the root slip is unknown, answer 404 `unknown-slip`.
   - Add one note field, `note: "children are listed by the seller who made the root slip; each child is checked as a slip, not as proof of who bought it"`.

## Tests

- **Lineage:**
  - a lineage naming a job of the same seller gives 409 `cycle` with no rail calls;
  - five entries give 422;
  - unknown jobIds pass;
  - a non-hex entry gives 422.
- **Trees.** Store a root slip whose children are two stored slips and one unknown hash. Check the node count and depths, that `verified` is true for the signed slips and false for a forged one, that the unknown child shows as null, and that an unknown root gives 404.
- **Runner bundle.** Use a fake hub that sells two parts as in the buyer tests, and a temp state and envelope. Serving a bundle job buys both parts with `lineage = [order.jobId]`, returns `{parts}`, and the slip's `children` are the two part slip hashes. When a part's hub refuses, the job fails with the part's reason.

## Constraints

- **Never launch a browser of any kind on this machine**: no Chrome or Chromium, headless or not, no Playwright, Puppeteer or screenshot tools. UI checks go back to the lane, which raises NEEDS-BROWSER.
- No view code. No network in tests. Use fixed anvil test keys only. TypeScript strict, no `any`.

## Acceptance

From the worktree root:

```
bun install && bun run typecheck && bun test packages/runner apps/hub && bun test && forge test
```

Every command passes, with no skipped tests.

## Stop conditions

- You need to edit outside the lease: stop and write the report.
- One problem has blocked you for more than 20 minutes: stop, commit what passes, and write the report.

## Finish

Commit with small present-tense messages ending `(refs #18)` or `(refs #27)`, and no trailers. Write `.packets/reports/cs-12-trees-lineage.md`. Do not push, merge or deploy.
