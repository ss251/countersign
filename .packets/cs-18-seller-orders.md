# cs-18-seller-orders — the hub serves a seller's orders and jobs, so the merchant desk and seller dashboard read live (refs #32)

## Setup

Run `bun install` at the worktree root before anything else.

This branch starts from `cs/cs-13`, which adds `apps/hub/src/buyerplumbing.ts` with `GET /jobs?buyer=`. That branch is in review for `cs/int`.

## Goal

The captain's audit (STEER-1730) found that the seller dashboard and the merchant desk run on fixtures in production, because the hub serves no seller-side reads. Add these routes, in exactly the shape the merchant desk binds to:

- `GET /orders?seller=`
- `GET /orders/:id`
- `GET /jobs?seller=`

The shape is cs-wc's contract, `/Users/thescoho/Developer/countersign-mumbai/wc/orders-contract.md`. Read it first. Every field it names must be present with that name and type. Extra fields are allowed.

## Lease

You may create or change only these paths:

- `apps/hub/src/orders.ts` (new)
- `apps/hub/src/buyerplumbing.ts`: the `/jobs` handler only
- `apps/hub/src/store.ts`: new read methods only, with no schema change
- `apps/hub/src/app.ts`: route registration, plus a new optional `HubDeps.relayUrl?: string`
- `apps/hub/src/index.ts`: one line passing `relayUrl: process.env.WC_RELAY_URL`
- `apps/hub/src/openapi.ts`: the new paths
- `packages/rail/src/rail.ts`: an optional `tollBps?(): Promise<number>` on the escrow operations
- `packages/rail/src/escrow/index.ts`: implement it by reading the contract's `tollBps()` view once and caching the answer
- `apps/hub/test/orders.test.ts` (new), and new cases appended to `apps/hub/test/buyerplumbing.test.ts`
- `.packets/reports/cs-18-seller-orders.md`

## What to build

### 1. `GET /orders?seller=<address>&limit=<1..500, default 200>`

- **Answer** `{orders: Order[]}`, newest first (`created_at DESC, rowid DESC`).
  - The orders are the jobs whose offer's `seller` equals the address, case-insensitively.
  - A seller with no jobs gets `{orders: []}` with status 200.
  - An address that is not `0x` followed by 40 hex characters gets 400 `bad-request` with "Refused. Name the seller."
- **Each `Order`**, mapped from the hub's job, its offer and its rail:

  | Field | Value |
  |---|---|
  | `id` | the jobId |
  | `kind` | `"escrow"` when the rail's declaration kind is `escrow`, else `"exact"` |
  | `rail` | the job's rail id |
  | `network` | from the stored payment's accepted entry |
  | `networkName` | a fixed map: `eip155:5042002` "Arc testnet", `eip155:1874` "Whitechain Sepolia", `hedera:testnet` "Hedera testnet", `mpp:tempo` "Tempo testnet"; otherwise the network string |
  | `asset` | `{symbol, decimals}` from the rail's declaration (`{symbol: "USDC", decimals: 6}` when the rail is not configured on this hub) |
  | `explorer` | see below |
  | `customer` | the buyer |
  | `merchant` | the offer's seller |
  | `amount` | atomic string |
  | `fee` | see below |
  | `refunded`, `refundable` | atomic strings, below |
  | `status`, `closeKind` | below |
  | `createdAt`, `deadline` | in **milliseconds** (seconds × 1000) |
  | `receivedAt` | ms or null, below |
  | `closedAt` | ms or null |
  | `settleTx`, `closeTx` | the job's transactions (`closeTx` may be null) |
  | `refundTxs` | `[]` |
  | `slipHash` | or null |
  | `offerHash` | |
  | `description` | the offer title, or null |

  Also add `settleTxUrl` and `closeTxUrl`: absolute links from `explorerUrl(rail.declaration, tx)`, or null.
- **`explorer`.** If the rail's `explorerTx` template has the form `<base>/tx/{tx}`, use `<base>`. Otherwise use null, as for Hedera, whose links are not `/tx/`.
- **`status` and `closeKind`:**

  | Hub status | `status` | `closeKind` |
  |---|---|---|
  | `funded` | `held` | null |
  | `paid`, `settled`, `released` | `paid` | `release` when released, else null |
  | `refunded` | `refunded` | `deadline_refund` |
  | `failed` on an escrow rail | `refund_pending` | null |
  | `failed` on any other rail | `paid` | null |
  | anything else | `pending` | null |

  On a failed direct rail the money was settled before delivery.
- **`fee`.** For a released escrow order whose rail has `escrow.tollBps`, the fee is `amount * tollBps / 10000`, rounded down as the contract does. Otherwise it is `"0"`.
- **`refunded` and `refundable`.**
  - A refunded order has `refunded` equal to the amount; every other order has `"0"`.
  - `refundable` is `"0"`: the hub can refund nothing itself.
- **`receivedAt`.**
  - A released escrow order: `closedAt`.
  - `paid` on a direct or batched rail: `createdAt`.
  - Otherwise null.
- **Whitechain pass-through.** When `rail` is `whitechain` and `deps.relayUrl` is set, `GET ${relayUrl}/orders/${jobId}` with a 3 s `AbortSignal.timeout`.
  - On a 200 with a JSON object, take its `fee`, `refunded`, `refundable`, `refundTxs`, `status` and `closeKind` when present. Refunds after release happen only on the relay, so this is the only place they show.
  - On any failure, keep the hub's values and set `relayUnavailable: true` on that order.
  - Query the relay only for whitechain orders.

### 2. `GET /orders/:id`

- **Answer:** the same `Order`, plus `refunds: Refund[]`, from the relay's `refunds` for whitechain (passed through as is) and `[]` otherwise.
- **Unknown id:** 404 with exactly `{"code": "not_found"}`.

### 3. `GET /jobs?seller=`

`/jobs` accepts exactly one of `buyer` or `seller`.

- Both, or neither, give 400 `bad-request` with "Refused. Name the buyer or the seller."
- **Rows** keep today's shape and add `buyer` and `seller` to every row.
- **Seller selection** is the same as for `/orders`.

### 4. Store and rail

- **Store.** Add a read method that lists jobs by offer seller with a limit. Join the jobs to the offers on the offer hash, and compare the lowercased stored offer seller to the lowercased address. Check the real column names in `store.ts`.
- **Rail.** `tollBps()` reads the escrow contract's `tollBps()` view once per rail instance, then caches it.

### 5. OpenAPI

Add the three paths with their parameters and response schemas. All three are public reads and CORS-open, like `/offers`.

## Tests

**`apps/hub/test/orders.test.ts`**, with fake rails and a real `Store` on a temp sqlite file, seeded through public methods:

- **A seller with four jobs:**
  - an escrow job funded and then released, with a fake `tollBps` of 100, so the fee is the floor of 1%;
  - a gateway-style batched job that is settled;
  - a refunded escrow job;
  - a failed escrow job.

  Add another seller's job as well. Check:
  - only that seller's four orders come back, newest first;
  - the status, `closeKind`, `fee`, `refunded`, `receivedAt` and millisecond timestamps are right;
  - `explorer` is the template base;
  - an upper-case address matches;
  - an unknown seller gives `{orders: []}`;
  - a malformed address gives 400;
  - `limit=1` gives one order.
- **`/orders/:id`:** a known id gives the order with `refunds: []`; an unknown id gives 404 `{"code": "not_found"}`.
- **Whitechain**, against a fake relay (`Bun.serve`) that answers `/orders/<jobId>` with `refunded`, `refundable`, `refundTxs`, `status: "partially_refunded"` and `refunds`:
  - the order and `/orders/:id` carry the relay's values;
  - with the relay stopped, the order keeps the hub's values and has `relayUnavailable: true`.
- **Appended to `buyerplumbing.test.ts`:**
  - `/jobs?seller=` returns that seller's rows, each with `buyer` and `seller`;
  - passing both parameters gives 400;
  - the existing buyer queries still pass.

## Constraints

- **Never launch a browser of any kind on this machine**: no Chrome or Chromium, headless or not, no Playwright, Puppeteer or screenshot tools. UI checks go back to the lane, which raises NEEDS-BROWSER.
- No view code. No network in tests beyond localhost fakes. TypeScript strict, no `any`.
- Refunds are never a hub route.

## Acceptance

From the worktree root:

```
bun install && bun run typecheck && bun test apps/hub packages/rail && bun test && forge test
```

Every command passes, with no new skipped tests.

## Stop conditions

- You need to edit outside the lease: stop and write the report.
- One problem has blocked you for more than 15 minutes: stop, commit what passes, and write the report.

## Finish

Commit with small present-tense messages ending `(refs #32)`, and no trailers. Write `.packets/reports/cs-18-seller-orders.md`. Do not push, merge or deploy.
