# cs-13-buyer-plumbing report

Date: 2026-11-06
Branch: `cs/cs-13`

## Landed

### Hub — `apps/hub/src/buyerplumbing.ts`

- `GET /jobs?buyer=<address>&limit=<1..100, default 20>` returns one buyer's job rows newest first, with
  `jobId`, `offerHash`, `title`, `amount`, `rail`, `network`, `status`, `at`, `settleTx`, `closeTx`,
  `slipHash` and `explorer`. Buyer comparison is case-insensitive; the limit is clamped to 1..100.
  Missing or blank `buyer` is `400 bad-request`.
- `explorer` is the stored slip's `settlement.url` when present. Otherwise it is the rail's `explorerTx`
  filled with `closeTx ?? settleTx`, or `null` when the rail template is empty.
- `PUT /envelopes/:agent` verifies the EIP-191 signature over `canonicalJson({envelope, spent, signedAt})`,
  requires the signer to equal both the path agent and `envelope.agent` case-insensitively, requires
  `signedAt` within 300 s, and requires it to be strictly newer than the stored mirror. Bad signatures
  are 401 and stale/older mirrors are 409. `GET /envelopes/:agent` returns the stored mirror with
  `verified: true`, or `404 unknown-agent`.
- `POST /approvals` verifies the agent's signature over the body without `sig`, checks `requestedAt`
  within 300 s, stores a `pending` row and returns `201 {id}` with a random 16-byte hex id.
  `GET /approvals?agent=&status=pending|decided|all` lists newest first; `GET /approvals/:id` returns one.
  `POST /approvals/:id/decision` requires a constant-time bearer-token match against
  `HubDeps.humanApprovalToken`, answers `503 no-approver` when unset, `401` for a missing/wrong token,
  `409` for an already-decided or expired request, and otherwise stores `countersign`/`decline` and
  `decided_at`. Pending rows older than 15 minutes read as `expired` and cannot be decided.

### Hub — store and wiring

- New `envelopes` and `approvals` tables with read/write methods in `apps/hub/src/store.ts`.
- `listJobsByBuyer(buyer, limit)` compares `lower(buyer)` and orders `created_at DESC, rowid DESC`.
- `HubDeps` gains `humanApprovalToken?: string`; `createHub` registers the new routes.

### Hub — failed-delivery message

`apps/hub/src/call.ts` now chooses the message by whether the chosen rail exposes `escrow`:

- escrow: "…Your money returns at the deadline."
- direct or batched: "…This rail settles before delivery, so the payment is not returned automatically;
  the slip records the failure."

### Buyer — `packages/buyer`

- `src/mirror.ts`: `publishEnvelope({hub, account, envelope, spent, now})` signs
  `canonicalJson({envelope, spent, signedAt})` and PUTs it to `/envelopes/:agent`. Any failure logs one
  line and returns `false`; it never throws into `buy()`.
- `src/approvals.ts`: `requestApproval(...)` posts the agent-signed request and polls `/approvals/:id`
  until `countersign`, `decline`, `expired`, or the timeout, returning one of those four values.
  `timeoutMs` defaults to 120 s, `pollMs` to 2 s, and `fetchImpl` is injectable.
- `buy()` gains `approvals?: "local" | "hub"` (default `"local"`). With `"hub"`, a held call passes the
  local envelope check (cap, per-merchant and the rest of `checkEnvelope`) before any request is posted,
  then asks the hub. `countersign` continues to signing; anything else appends `refused` with
  `human-declined`, `human-expired` or `human-timeout` and throws
  `BuyError("Held. The human did not countersign this call.")`.
- The agent key is taken from an explicit `account` or, when omitted, from the chosen payer, so existing
  call sites keep working. `publishEnvelope` runs after every journal append in `buy()`, including the
  reservation append, and after `resume()` when mirroring is on; it cannot change the buy's outcome.
- `Payer` exposes its optional `account` so the hub approval and mirror paths can sign without a second
  key argument.
- CLI: `buy ... --approvals hub` selects the hub path, `--hub` turns on mirror publishing, and the new
  `publish-envelope` command publishes once. `resume --hub` publishes after a resume.

## Out of lease

`apps/hub/src/index.ts` is outside this lane's lease and was not edited. To enable approvals in
production it must read `HUMAN_APPROVAL_TOKEN` and pass it through:

```ts
const { app, websocket } = createHub({
  store,
  rails,
  now,
  publicUrl,
  humanApprovalToken: process.env.HUMAN_APPROVAL_TOKEN,
});
```

Without that wiring the decision route correctly answers `503 no-approver`.

## Tests

- `apps/hub/test/buyerplumbing.test.ts`: jobs by buyer (filter, order, limit, explorer from slip and from
  the rail template, empty template, missing buyer 400); envelope mirror (valid, wrong signer, wrong
  agent in the envelope, stale, older than stored, unknown agent); approvals (signed create, pending and
  decided lists, per-id read, wrong/missing token, configured token, double decision, no configured
  token, 15-minute expiry); failed delivery on an escrow rail and on a direct rail.
- `packages/buyer/test/plumbing.test.ts`: `requestApproval` returns `countersign` after two polls and
  `timeout` with a short timeout; `buy()` with hub approvals signs only after `countersign`; a decline
  journals `human-declined` and never signs; an over-cap call makes no approval request; mirror failures
  do not fail a buy; mirror payloads carry the agent signature. Existing buyer tests, including
  `w1-attacks`, pass unedited.

No browser, Playwright, Puppeteer or screenshot tool was launched. Tests use only local Bun servers and
fixed anvil keys; no live chain or external network call was made.

## Acceptance

From the worktree root:

```
bun install && bun run typecheck && bun test apps/hub packages/buyer && bun test && forge test
```

- `bun install`: no changes.
- `bun run typecheck`: passed.
- `bun test apps/hub packages/buyer`: 120 pass, 0 fail.
- `bun test`: 508 pass, 3 pre-existing skips, 0 fail.
- `forge test`: 29 pass, 0 fail.
