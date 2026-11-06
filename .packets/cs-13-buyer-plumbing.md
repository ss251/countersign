# cs-13-buyer-plumbing — the buyer phone reads live: jobs by buyer, a signed envelope mirror, human approvals through the hub (refs #21)

## Setup

Run `bun install` at the worktree root before anything else.

## Goal

The phone shows the buyer's real purchase history, its limits and its spend, and it can approve a held call. The human's limits stay authoritative on the agent's machine, so the hub can never loosen them:

- **History**: the hub serves its job rows for a buyer address.
- **Envelope mirror**: after every journal change the buyer agent publishes `{envelope, spent, signedAt}` to the hub, signed by the agent key. The hub stores only what verifies, and the phone reads it. Nothing on the hub can change the agent's envelope.
- **Approvals**: when a call is above `askAbove`, the agent posts an agent-signed approval request to the hub and waits. The human decides on the phone with a bearer token. The agent then proceeds or journals a refusal. The hard cap and per-merchant limits are checked locally before any request is made, so an approval can only clear the ask-above hold.

## Lease

You may create or change only these paths:

- `apps/hub/src/buyerplumbing.ts` (new), `apps/hub/src/store.ts` (new tables and read/write methods only), and `apps/hub/src/app.ts` (route registration and new options through `HubDeps`)
- `apps/hub/test/buyerplumbing.test.ts` (new)
- `packages/buyer/src/**` except `packages/buyer/src/hedera/`, and `packages/buyer/test/**`. Never edit `packages/buyer/test/w1-attacks.test.ts`.
- `.packets/reports/cs-13-buyer-plumbing.md`

Do not edit any `package.json`, `bun.lock`, `packages/core/**` or anything else.

## What to build

### Hub (`apps/hub/src/buyerplumbing.ts`)

1. `GET /jobs?buyer=<address>&limit=<1..100, default 20>` returns `{jobs: [{jobId, offerHash, title, amount, rail, network, status, at, settleTx, closeTx, slipHash, explorer}]}`, newest first.
   - Compare the buyer case-insensitively.
   - `explorer` is the stored slip's `settlement.url` when there is a slip. Otherwise it comes from the rail's `explorerTx` filled with the close or settle tx, and it is `null` when the template is empty.
   - Without `buyer`: 400 `bad-request`.
2. Envelope mirror:
   - `PUT /envelopes/:agent` takes body `{envelope, spent, signedAt, sig}`. `sig` is the agent's EIP-191 `personal_sign` over `canonicalJson({envelope, spent, signedAt})`.
     - Verify that `recoverMessageAddress` equals `:agent` and equals `envelope.agent`, case-insensitively.
     - `signedAt` must be within 300 s of now and newer than any stored mirror.
     - Store it and return 200 `{ok: true}`. A bad signature gives 401, and a stale one gives 409.
   - `GET /envelopes/:agent` returns `{envelope, spent, signedAt, sig, verified: true}`, or 404 `unknown-agent`.
3. Approvals, in a new `approvals` table with columns id, agent, offerHash, title, amount, rail, terms_json, status (`pending`, `countersign` or `decline`), created_at and decided_at:
   - `POST /approvals` takes body `{agent, offerHash, title, amount, rail, terms, requestedAt, sig}`, where `sig` is the agent's `personal_sign` over `canonicalJson` of the body without `sig`. Verify it, require `requestedAt` within 300 s, store the row and return 201 `{id}` with a random 16-byte hex id. A bad signature gives 401.
   - `GET /approvals?agent=<addr>&status=<pending|decided|all, default pending>` returns `{approvals: [...]}`, newest first.
   - `GET /approvals/:id` returns one approval, or 404.
   - `POST /approvals/:id/decision` takes body `{decision: "countersign" | "decline"}` and requires `Authorization: Bearer <token>`. The token is compared in constant time with `HubDeps.humanApprovalToken`.
     - When that option is unset, the route answers 503 `no-approver`.
     - A wrong or missing token gives 401.
     - An approval already decided gives 409.
     - Otherwise set the status and `decided_at`, and return 200.
   - Pending approvals older than 15 minutes read as `expired` and cannot be decided.
4. `HubDeps` gains `humanApprovalToken?: string`. `apps/hub/src/index.ts` is outside your lease: say in the report that it must read `HUMAN_APPROVAL_TOKEN`.

### Buyer (`packages/buyer`)

1. `src/mirror.ts` exports `publishEnvelope({hub, account, envelope, spent, now})`, which signs and PUTs the mirror. On any error it logs one line and continues. It never throws into `buy()`.
2. `src/approvals.ts` exports `requestApproval({hub, account, offerHash, title, amount, rail, terms, now, timeoutMs = 120_000, pollMs = 2_000, fetchImpl})`. It posts the signed request, then polls `GET /approvals/:id` until the status is `countersign`, `decline` or `expired`, or the timeout passes. It returns `"countersign" | "decline" | "expired" | "timeout"`.
3. `buy()` gains an option `approvals?: "local" | "hub"`, default `"local"`, which keeps today's behaviour: refuse without `approve`. With `"hub"`, when `needsHuman` is true and `approve` is not set:
   - call `requestApproval` after all local checks pass (cap, per-merchant, terms) and before signing;
   - on `countersign`, continue to sign;
   - otherwise append `refused` with reason `human-declined`, `human-expired` or `human-timeout`, and throw `BuyError("Held. The human did not countersign this call.")`.
4. After every journal append in `buy()`, and after `resume()`, call `publishEnvelope` when `--hub` is given. The publish must not change the outcome of the buy.
5. CLI: `buy ... --approvals hub` selects the hub path. A new `publish-envelope` command publishes once.

## Tests

- Hub:
  - `/jobs?buyer=` returns only that buyer's rows, newest first, with `explorer`;
  - a missing buyer gives 400;
  - the envelope PUT accepts a valid signature and refuses a wrong signer (401), a stale `signedAt` (409) and an older mirror (409); GET returns the stored mirror;
  - approvals cover the full round trip: create (signed), list pending, decide with the token (200), decide again (409), a wrong token (401), no configured token (503) and expiry.
- Buyer:
  - `requestApproval` against a fake hub returns `countersign` after two polls, and `timeout` with a short timeout;
  - `buy()` with `approvals: "hub"` signs only after `countersign`, and on `decline` journals `refused` with `human-declined` and never signs;
  - the cap is still enforced before any approval request: an over-cap call makes no request;
  - `publishEnvelope` failures never fail a buy;
  - every existing buyer test, `w1-attacks` included, passes unedited.

## Constraints

- **Never launch a browser of any kind on this machine**: no Chrome or Chromium, headless or not, no Playwright, Puppeteer or screenshot tools. UI checks go back to the lane, which raises NEEDS-BROWSER.
- No view code. No network in tests. Use only fixed anvil test keys. TypeScript strict, no `any`.
- Never log the bearer token, a signature or a key.

## Acceptance

From the worktree root:

```
bun install && bun run typecheck && bun test apps/hub packages/buyer && bun test && forge test
```

Every command passes, with no skipped tests apart from those already skipped on `cs/int`.

## Stop conditions

- You need to edit outside the lease: stop and write the report.
- One problem has blocked you for more than 20 minutes: stop, commit what passes, and write the report.

## Finish

Commit with small present-tense messages ending `(refs #21)`, and no trailers. Write `.packets/reports/cs-13-buyer-plumbing.md`. Do not push, merge or deploy.
