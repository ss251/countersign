# cs-13b-approval-signatures report

Date: 2026-11-06
Branch: `cs/cs-13`

## Landed

### Core — `packages/core`

- `Envelope.approver?: Address` in `src/types.ts`, documented as the key whose signature
  countersigns a held call from another device.
- `src/approval.ts` exports:
  - `ApprovalDecisionBody` / `ApprovalDecisionInput`, with `agent` and `offerHash` lowercase
    and `termsHash = keccak256(toBytes(canonicalJson(terms)))`;
  - `termsHashOf(terms)`;
  - `approvalDecisionBody({approvalId, agent, offerHash, amount, rail, terms, decision, decidedAt})`;
  - `approvalDecisionMessage(body) = canonicalJson(body)`;
  - `approvalDecisionSigner(body, sig)`, returning the recovered address or `null` for a
    malformed signature.
- Exported from `src/index.ts`.
- `test/approval.test.ts` uses fixed anvil keys and covers: signer recovery, a different
  recovery for every changed field, key-order-independent `termsHashOf`, and a malformed
  signature returning `null`.

### Hub — `apps/hub/src/buyerplumbing.ts`, `store.ts`

- `POST /approvals`:
  - bodies over 16 KiB are `413 too-large`;
  - an agent without a mirrored envelope is `409 unknown-agent` with the requested message;
  - a replayed request signature is `409 duplicate-request`;
  - the twentieth pending approval fills the quota, and the twenty-first is `429 too-many-pending`;
  - the request signature is stored in `request_sig`.
- `POST /approvals/:id/decision`:
  - bearer check unchanged;
  - requires `{decision, decidedAt, sig}`, with `decidedAt` within 300 s of the hub clock
    (`400 bad-request` otherwise);
  - requires the agent's mirrored envelope to name `approver` (`409 no-approver` with the
    requested message);
  - rebuilds `approvalDecisionBody` from the stored row and checks the signature against
    the approver case-insensitively (`401 bad-signature`);
  - stores `decided_at` as the signed value and the signature in `decision_sig`.
- Approval views (per-id and list) include `decisionSig`; `decidedAt` is the signed value.
- `PUT /envelopes/:agent` rejects bodies over 16 KiB with `413 too-large`.
- `GET /envelopes/:agent` and `GET /approvals` now require the approver bearer token:
  `503 no-approver` when the hub has none, `401` when missing or wrong.
  `GET /approvals/:id` stays open; `/jobs?buyer=` stays public.
- Store migration adds nullable `request_sig` and `decision_sig` columns and a unique
  index on `request_sig`; it works on both new and existing databases. New approval
  methods: `hasApprovalRequestSig`, `countPendingApprovals`, and `decideApproval` with the
  decision signature.

### Buyer — `packages/buyer`

- `requestApproval` now takes `approver`. On a `countersign` poll it requires `decidedAt`
  and `decisionSig`, rebuilds the decision body from the agent's own request values, checks
  the signature against the approver, and enforces the requested time window. A failure is
  the new `"unverified"` outcome. `decline`, `expired` and `timeout` remain unsigned.
- Every approval fetch uses `AbortSignal.timeout(10_000)`, injectable through
  `fetchTimeoutMs`; a poll timeout is pending.
- `buy()` with `approvals: "hub"`:
  - refuses locally with `no-approver` and makes no request when the envelope names no
    approver;
  - publishes the mirror (forced, even when background mirroring is off) right before the
    request;
  - maps a request that cannot be posted to `refused` / `approval-unavailable`;
  - maps an unverified countersign to `refused` / `human-unverified`;
  - only a verified countersign continues to signing.
- The mirror publishes once in a `finally` after the outcome is journalled (when mirroring
  is enabled), and no longer after every journal append; nothing is published between
  signing and sending the payment.
- `publishEnvelope` uses `AbortSignal.timeout(5_000)`, injectable through `timeoutMs`, and
  keeps a process-local `signedAt` high-water mark per agent so repeated publishes in one
  buy are strictly newer. `buy()` exposes the timeout through `mirrorTimeoutMs`.
- `resume()` still publishes once at its end.

### Docs

`docs/spec/envelope.md` gains the `approver` row and the “Approving a held call from
another device” section covering the decision body, the signer, the buyer's checks, and
that the hub's word alone never clears a hold.

## Test changes to cs-13's own plumbing tests

### `apps/hub/test/buyerplumbing.test.ts`

- Envelope reads now use a token hub and send `Authorization`; added explicit read-auth
  coverage (`401` missing/wrong, `200` with token, `503` when the hub has no token) and an
  oversized `PUT` (`413 too-large`).
- Approval tests seed a mirrored envelope first, because `POST /approvals` now requires one.
- `createApproval` moved from positional `(url, requestedAt, signer)` to an override object,
  and a shared `approvalRequest` helper makes replay tests reuse the exact signed request.
- Decisions are now signed through `approvalDecisionBody` / `approvalDecisionMessage` with
  a fixed approver key; the helper returns the exact signature for the `decisionSig` view
  assertion.
- Added: decision with no `sig` (`400`), non-approver signature (`401`), decision time away
  from the hub clock (`400`), agent without a mirror (`409 unknown-agent`), envelope without
  an approver (`409 no-approver`), replay (`409 duplicate-request`), twenty-first pending
  approval (`429 too-many-pending`), and oversized approval POST (`413 too-large`).
- The existing “bad signature / stale request”, “no configured approver”, and expiry tests
  now seed a mirror, use token reads, and sign decisions where the request reaches the
  decision route.

### `packages/buyer/test/plumbing.test.ts`

- Added the fixed anvil approver key; `envelope()` now names the approver by default.
- The fake buy hub records the agent's own approval request and signs decisions with the
  approver over those values. Options cover a wrong signer, a changed amount in the hub's
  copy, pending polls before the decision, a rejected approval POST, a hanging mirror PUT,
  and a callback at mirror time.
- `requestApproval` calls now pass `approver`; the “two polls” test uses the shared fake hub.
- Added buyer tests for: wrong-key countersign ending `human-unverified`, a hub that signs
  over a changed amount ending `human-unverified`, an envelope without an approver making no
  approval request, a hub that cannot take the request ending `approval-unavailable`, a
  hanging mirror delaying a buy by at most the injected timeout, and the mirror publishing
  once after the outcome.
- Existing cap, decline, mirror-failure and mirror-payload tests keep their intent.

`packages/buyer/test/w1-attacks.test.ts` was not edited; `W1 B12` passes.

## Acceptance

From the worktree root:

```
bun install && bun run typecheck && bun test apps/hub packages/buyer packages/core && bun test && forge test
```

- `bun install`: no changes.
- `bun run typecheck`: passed.
- `bun test apps/hub packages/buyer packages/core`: 209 pass, 0 fail.
- `bun test`: 558 pass, 3 pre-existing skips, 0 fail.
- `forge test`: 29 pass, 0 fail.

No browser, Playwright, Puppeteer or screenshot tool was launched. Tests use only local Bun
servers and fixed anvil keys; no live chain or external network call was made. No file
outside the lease was changed.
