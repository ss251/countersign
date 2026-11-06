# cs-10-subgraph — the escrow ledger as a subgraph, plus /graph/stats (refs #4)

## Setup

Run `bun install` at the worktree root before anything else. `graph` (graph-cli) is installed on this machine. Run `graph --version` to confirm it.

## Goal

Index `CountersignedEscrow` on Arc testnet with a standard subgraph: jobs, their lifecycle and totals. Add a hub route `/graph/stats` that reads the subgraph when `GRAPH_URL` is set. Deploying to the hosted indexer (Goldsky) waits for a credential and is not part of this packet. This packet must build locally with `graph codegen && graph build` and pass its tests.

## Facts

- Escrow (deployed through Arc Studio) on Arc testnet, chain 5042002: `0x19c27d770969291e6a0a305dc1be1a845e7c1b76`. It was deployed by tx `0x06638eb4cfa8db52b5e097778160fbc913561e88f56aa8fc2ec195cb6d596c5a`; read its block from the receipt with `cast receipt <tx> blockNumber --rpc-url https://rpc.testnet.arc.network` and use it as `startBlock`.
- Events, from `packages/rail/src/escrow/abi.ts`:
  - `Funded(bytes32 indexed jobId, bytes32 indexed offerHash, address indexed buyer, address payee, uint256 amount, uint64 deadline)`
  - `Released(bytes32 indexed jobId, bytes32 indexed slipHash, address indexed payee, uint256 paid, uint256 toll)`
  - `Refunded(bytes32 indexed jobId, address indexed buyer, uint256 amount, bool byPayee)`
- Network name for Arc testnet in `subgraph.yaml`: `arc-testnet`.

## Lease

You may create or change only these paths:

- `subgraph/**` (new)
- `apps/hub/src/graph.ts` (new), and `apps/hub/src/app.ts` to register one route only
- `apps/hub/test/graph.test.ts` (new)
- `.packets/reports/cs-10-subgraph.md`

Do not edit any `package.json` outside `subgraph/`, `bun.lock`, `contracts/**` or anything else. `subgraph/` is not a Bun workspace. Give it its own `package.json` with `@graphprotocol/graph-cli` and `@graphprotocol/graph-ts` as devDependencies, and its own lockfile from `npm install` or `bun install` run **inside `subgraph/`**. The root workspaces are `apps/*` and `packages/*`, so the root lockfile is untouched. Add `subgraph/node_modules/` and `subgraph/generated/` and `subgraph/build/` to `subgraph/.gitignore`.

## What to build

1. `subgraph/abis/CountersignedEscrow.json`: the ABI. Generate it with `forge inspect CountersignedEscrow abi --json > subgraph/abis/CountersignedEscrow.json` from the repo root.
2. `subgraph/schema.graphql`:
   - `type Job @entity { id: Bytes! offerHash: Bytes! buyer: Bytes! payee: Bytes! amount: BigInt! deadline: BigInt! status: String! slipHash: Bytes paid: BigInt toll: BigInt refundedByPayee: Boolean fundedAt: BigInt! fundTx: Bytes! closedAt: BigInt closeTx: Bytes }`. Status is one of `funded`, `released` or `refunded`.
   - `type Totals @entity { id: ID! jobs: BigInt! released: BigInt! refunded: BigInt! volumeFunded: BigInt! volumeReleased: BigInt! volumeRefunded: BigInt! tolls: BigInt! }`, a single row with id `"all"`.
   - `type Payee @entity { id: Bytes! released: BigInt! refunded: BigInt! earned: BigInt! }`.
3. `subgraph/src/escrow.ts`: AssemblyScript handlers `handleFunded`, `handleReleased` and `handleRefunded` that keep `Job`, `Totals` and `Payee` consistent.
4. `subgraph/subgraph.yaml`: specVersion 1.0.0, a data source `CountersignedEscrow` on network `arc-testnet` at the address above, with `startBlock` and the three event handlers.
5. `subgraph/package.json` scripts: `codegen`, `build` and `test`, using matchstick-as if it installs cleanly. Otherwise write a plain `bun test` in `apps/hub/test/graph.test.ts` only and say so in the report.
6. `apps/hub/src/graph.ts` exports `graphStats(graphUrl, fetchImpl = fetch)`. It POSTs `{query: "{ totals(id: \"all\") { jobs released refunded volumeFunded volumeReleased volumeRefunded tolls } }"}` and returns those numbers as digit strings, or throws a clear error.
7. Route `GET /graph/stats`:
   - when `GRAPH_URL` is unset: 503 `{code: "no-indexer", message: "No indexer is configured for this hub."}`;
   - otherwise: `{source: GRAPH_URL, totals}`;
   - on an indexer error: 502 `{code: "indexer-error", message}`.

   Read `GRAPH_URL` from the deps or env passed to `createHub`. Do not read `process.env` inside a handler.

## Tests

- `apps/hub/test/graph.test.ts`:
  - a fake GraphQL server (`Bun.serve`) returns `totals`, and `/graph/stats` maps it;
  - with no `GRAPH_URL` the route gives 503;
  - a fake server error gives 502.
- `subgraph`: `graph codegen && graph build` succeeds from `subgraph/`. Put the command's last lines in the report.

## Constraints

- **Never launch a browser of any kind on this machine**: no Chrome or Chromium, headless or not, no Playwright, Puppeteer or screenshot tools. UI checks go back to the lane, which raises NEEDS-BROWSER.
- Never run `goldsky` or `graph deploy`, and never log in to anything.
- No view code. TypeScript strict, no `any`.

## Acceptance

From the worktree root:

```
bun install && bun run typecheck && bun test apps/hub && bun test && forge test && (cd subgraph && graph codegen && graph build)
```

Every command passes.

## Stop conditions

- You need to edit outside the lease: stop and write the report.
- One problem has blocked you for more than 20 minutes: stop, commit what passes, and write the report.

## Finish

Commit with small present-tense messages ending `(refs #4)`, and no trailers. Write `.packets/reports/cs-10-subgraph.md`. Do not push, merge or deploy.
