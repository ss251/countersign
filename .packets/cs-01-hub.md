# cs-01-hub — the hub: offers, x402 challenge, paid calls, runner link

## Goal

Build `apps/hub`: a Bun + Hono server that lists offers, answers an unpaid call with an x402 v2 `402`, takes a paid call through a `Rail`, hands the job to the seller's runner over the runner's dial-out WebSocket, checks the output and the slip, releases the escrow, and returns the output with the slip. A janitor refunds funded jobs whose deadline has passed.

## Lease

You may create or change only these paths:

- `apps/hub/src/**`
- `apps/hub/test/**`
- `.packets/reports/cs-01-hub.md` (your report)

Do not edit `package.json`, `bun.lock`, `packages/**` or anything else. Do not add dependencies. You have `hono`, `viem`, `@countersign/core`, `@countersign/rail` and Bun built-ins (`bun:sqlite`, `bun:test`, `Bun.serve`).

## Read first

- `packages/core/src/types.ts`: Offer, PaymentRequirements, PaymentRequired, PaymentPayload, SettleResult, Slip and SlipBody.
- `packages/core/src/wire.ts`: header names, `toBase64Json`/`fromBase64Json`, `runnerAuthMessage`, `publishMessage`, `JobOrder`, `HubToRunner`/`RunnerToHub`, `PublishRequest`, `CallRequest`, `CallResult`, `ErrorBody`, `slipBodyFor`.
- `packages/core/src/schema.ts`: `checkSchema` and `assertSchema`.
- `packages/core/src/offer.ts`: `assertOffer` and `offerHash`.
- `packages/core/src/slip.ts`: `slipHash` and `slipSigner`.
- `packages/core/src/canonical.ts`: `canonicalHash`.
- `packages/rail/src/rail.ts`: `Rail`, `RailDeclaration`, `EscrowOps` and `explorerUrl`.

Import everything from `@countersign/core` and `@countersign/rail`.

## What to build

### Files

- `apps/hub/src/store.ts`: `class Store`, backed by `bun:sqlite` (`new Database(path)`; tests use `":memory:"`). It has three tables:
  - `offers(offer_hash TEXT PRIMARY KEY, seller TEXT, offer_json TEXT, published_at INTEGER, delisted_at INTEGER NULL)`
  - `jobs(job_id TEXT PRIMARY KEY, offer_hash TEXT, rail TEXT, buyer TEXT, amount TEXT, deadline INTEGER, status TEXT, payment_json TEXT, settle_tx TEXT NULL, close_tx TEXT NULL, slip_hash TEXT NULL, created_at INTEGER)`. Status is one of `funded`, `paid`, `released`, `settled`, `failed` or `refunded`.
  - `slips(slip_hash TEXT PRIMARY KEY, job_id TEXT, slip_json TEXT, created_at INTEGER)`

  Use typed methods, for example `putOffer`, `getOffer`, `listOffers`, `putJob`, `getJob`, `updateJob`, `putSlip`, `getSlip` and `fundedJobsPastDeadline(now)`.
- `apps/hub/src/runners.ts`: `class RunnerLink`, the registry of connected runners.
  - It handles WebSocket open, message and close. On open it sends `{t:"challenge", nonce}` with 16 random bytes in hex.
  - On `hello` it checks that `recoverMessageAddress({message: runnerAuthMessage(nonce), signature: sig})` equals `seller`. It serves only the listed offers that are published, not delisted, and whose `offer.seller` equals `seller` (case-insensitive). It replies `{t:"ready", seller, offers: <accepted>}`.
  - On a bad signature it sends `{t:"error", message}` and closes.
  - `isOnline(offerHash)` reports whether a runner serves the offer.
  - `dispatch(order: JobOrder, timeoutMs): Promise<{output, slip} | {fail: string}>` sends `{t:"job", order}` to the runner serving `order.offerHash` and resolves on that job's `result` or `fail`. When the time runs out it resolves `{fail: "timeout"}`.
  - It sends `ping` every 20 s and drops a runner that has not answered with `pong` within 45 s. On close it unregisters.
- `apps/hub/src/call.ts`: the paid-call pipeline (below).
- `apps/hub/src/janitor.ts`: `runJanitor(deps)` refunds every `funded` job whose deadline has passed through `rail.escrow.refund(jobId)`, and sets its status to `refunded` with `close_tx`. The server runs it every 30 s; tests call it directly.
- `apps/hub/src/app.ts`: `createHub(deps: HubDeps)` returns `{ app: Hono, websocket, runners: RunnerLink }`, using `createBunWebSocket` from `hono/bun`.
  - `HubDeps = { store: Store; rails: Rail[]; now: () => number /* unix seconds */; publicUrl: string; jobTimeoutMs?: number }`.
  - Enable CORS for every route with `hono/cors`, origin `*`, exposing the three `PAYMENT-*` headers.
- `apps/hub/src/rails.ts`: `railsFromEnv(env): Rail[]`. Return `[]` for now and leave a comment `// rails are wired by orch-cs`.
- `apps/hub/src/index.ts`: boot.
  - Read `PORT` (default 8787), `HUB_DB` (default `data/hub.sqlite`; create the directory) and `HUB_PUBLIC_URL` (default `http://127.0.0.1:<port>`).
  - Start `Bun.serve({ port, fetch: app.fetch, websocket })` and the janitor interval, then log one line with the URL.

### Routes

Every non-2xx response except `402` has an `ErrorBody` JSON body `{code, message}`. Messages are short and declarative, have no exclamation marks, and refusals start with `Refused.`.

- `GET /healthz`: `{ ok: true, rails: rails.map(r => r.declaration), runners: <connected count> }`.
- `POST /offers`, with body `PublishRequest`:
  - malformed offer, or a schema that `assertSchema` rejects: 400 `bad-offer`;
  - `recoverMessageAddress({message: publishMessage(offerHash(offer)), signature: sig})` is not `offer.seller`: 401 `bad-signature`;
  - otherwise store it and return 201 `{ offerHash }`, or 200 if it was already stored.
- `GET /offers`: `{ offers: Listing[] }`, without delisted offers, newest first. `Listing = { offerHash, offer, online, status: "listed" | "delisted" }`; define the type in `apps/hub/src/types.ts`.
- `GET /offers/:offerHash`: a `Listing`, delisted ones included, or 404 `unknown-offer`.
- `GET /rails`: `{ rails: rails.map(r => r.declaration) }`.
- `GET /slips/:slipHash`: the stored `Slip` JSON, or 404 `unknown-slip`.
- `GET /jobs/:jobId`: `{ jobId, offerHash, rail, status, deadline, settleTx, closeTx, slipHash }`, or 404 `unknown-job`.
- `GET <RUNNER_PATH>`: the WebSocket upgrade into `RunnerLink`.
- `POST /offers/:offerHash/call`, with body `CallRequest`: the pipeline below.

### The paid-call pipeline (`call.ts`), in this order

1. Load the offer. If it is missing or delisted: 404 `unknown-offer`.
2. Input gate: `checkSchema(offer.input, body.input)`. If it fails, return 422 `bad-input` with message "Refused. The input does not match the offer's schema." and also `errors`. No rail method is called.
3. If `!runners.isOnline(offerHash)`: 503 `seller-offline`, message "The seller is offline. Nothing was charged."
4. Build `accepts`: for each rail id in `offer.rails` order that has a configured rail (`rail.declaration.id`), call `rail.challenge(offer, {resource, now})`. If `accepts` is empty: 503 `no-rail`.
5. If there is no `PAYMENT-SIGNATURE` header: answer 402 with body `PaymentRequired {x402Version: 2, resource: {url, description: offer.title, mimeType: "application/json"}, accepts}` and header `PAYMENT-REQUIRED: toBase64Json(body)`.
6. Decode the header with `fromBase64Json<PaymentPayload>`. If decoding fails: 400 `bad-payment`.
7. Pick the `accepts` entry with the same `scheme` and `network` as `payment.accepted`, and its rail. If there is none: 402 with `error` "Refused. This offer does not take that rail." If `payment.accepted.amount !== entry.amount`: 402 with `error` "Refused. The price moved after you signed." If `payTo` or `asset` differ: 402 with `error` "Refused. The payment does not match this offer." In each of these cases, call no rail method.
8. `rail.verify(payment, entry)`. If it is not valid: 402 with `error: invalidReason`.
9. `rail.settle(payment, entry)`. If it does not succeed: 402 with `error: errorReason`.
   - `jobId`: if `payment.payload.authorization.nonce` is a 32-byte hex string, use it; otherwise use `keccak256(toBytes(settle.transaction))`.
   - Store the job with status `funded` when `rail.escrow` exists, otherwise `paid`, and `settle_tx`.
10. Build the `JobOrder`:
    - `jobId`, `offerHash` and `input` from the steps above; `rail: decl.id`; `network: decl.network`;
    - `buyer: settle.payer ?? verify.payer`;
    - `payTo: entry.payTo`, `asset: entry.asset`, `amount: entry.amount`;
    - `deadline`: `payment.payload.terms.deadline` when present, otherwise `now + offer.deadline`;
    - `escrow` and `chainId` from `entry.extra` when present;
    - `lineage: body.lineage ?? []`.

    Then `dispatch(order, timeoutMs)`, where `timeoutMs = min(jobTimeoutMs ?? 120_000, (deadline - now - 5) * 1000)`.
11. Check the result. Every check must pass:
    - `slip.hash === slipHash(slip.body)`;
    - `slip.body.outputHash === canonicalHash(output)`;
    - `slip.body.inputHash === canonicalHash(input)`;
    - every field of `slipBodyFor(order, offer.seller, inputHash, outputHash, slip.body.deliveredAt, slip.body.children)` equals `slip.body` (compare with `canonicalJson`);
    - `checkSchema(offer.output, output)` is ok;
    - `slipSigner(slip)` equals `offer.seller`.

    On a `fail`, a timeout or any failed check: set the job to `failed` and return 502 `failed-delivery` with message "Refused. The seller's output does not match the offer. Your money returns at the deadline." Do not release.
12. If `rail.escrow` exists, call `rail.escrow.release(jobId, slip.hash, slip.sellerSig)`. If it fails: 502 `release-failed`. The closing tx is the release tx on escrow rails and the settle tx on others.
13. Store the full `Slip`: `{body, hash, sellerSig, payment, settlement: {transaction: closeTx, network, url: explorerUrl(decl, closeTx)}}`. Set the job to `released` (escrow) or `settled` (direct), with `close_tx` and `slip_hash`. Respond 200 with `CallResult {output, slip}` and header `PAYMENT-RESPONSE: toBase64Json(<the closing SettleResult>)`.

## Tests (`apps/hub/test/`)

Write a `FakeRail implements Rail` in the test folder:

- `declaration`: `{id: "escrow", network: "eip155:5042002", scheme: "countersign", kind: "escrow", ...}`.
- `challenge` returns `{scheme: "countersign", network, amount: offer.price, asset: "0x3600000000000000000000000000000000000000", payTo: offer.seller, maxTimeoutSeconds: offer.deadline, extra: {escrow: "0x4444444444444444444444444444444444444444", chainId: 5042002}}`.
- `verify` and `settle` record their calls and succeed unless the test sets a flag.
- `escrow.release` and `escrow.refund` record their calls.

The payment payload is `{x402Version: 2, accepted: <entry>, payload: {authorization: {nonce: <32-byte hex>}, terms: {deadline: now + 60}}}`.

Run a real server with `Bun.serve({port: 0, fetch, websocket})`. Write a test runner client with a real `WebSocket` that signs `hello` with a viem `privateKeyToAccount` seller key, and answers `job` with an output and a slip it builds with `slipBodyFor` and signs with `seller.signTypedData(slipTypedData(body))`.

Cover at least:

1. Publish: valid gives 201, then 200 on repeat; a wrong signer gives 401; a malformed offer gives 400.
2. Unpaid call gives 402; the `PAYMENT-REQUIRED` header decodes to the same body; `accepts` follows `offer.rails`.
3. Bad input gives 422, and no rail method was called.
4. Seller offline gives 503.
5. Paid happy path:
   - 200 with output and slip;
   - `release` was called with `(jobId, slip.hash, slip.sellerSig)`;
   - the `PAYMENT-RESPONSE` header is present;
   - `GET /slips/:hash` and `GET /jobs/:jobId` show `released`.
6. Moved price: `payment.accepted.amount` differs from the current price, giving 402 with "Refused. The price moved after you signed.", and `verify` and `settle` were never called.
7. Output that fails the output schema gives 502 `failed-delivery`, release is not called and the job is `failed`. Then advance `now` past the deadline (`now` is injected), call `runJanitor`, and see that `refund` was called and the job is `refunded`.
8. A runner hello with a bad signature gets an `error` frame and is not counted online.
9. A runner claiming another seller's offer is not online for that offer.

## Constraints

- TypeScript strict. No `any`: use `unknown` and narrow. Amounts stay strings or bigint and are never numbers.
- Never log request bodies, signatures or headers. Log one line per call: offer hash, rail, status code.
- Keep each file under about 300 lines.
- Do not change `@countersign/core` or `@countersign/rail`. If you need a helper they lack, write it in `apps/hub/src/util.ts` and name it in your report.

## Acceptance

From the worktree root:

```
bun install && bun run typecheck && bun test apps/hub && bun test && forge test
```

Every command passes, with no skipped or todo tests in `apps/hub/test`.

## Stop conditions

- You need to edit anything outside the lease: stop and write the report.
- `hono/bun` WebSocket upgrades do not work under `Bun.serve` in tests after two attempts: switch to Bun's native `websocket` handler in `Bun.serve` with a manual `server.upgrade(req)` in `fetch`, and say so in the report.
- One problem has blocked you for more than 20 minutes: stop, commit what passes, and write the report.

## Finish

Commit on your branch with small present-tense messages. Write `.packets/reports/cs-01-hub.md` with:

- what you built;
- the acceptance output, with the last lines of each command;
- anything you could not do;
- any helper you added.

Do not push, merge or deploy.
