# cs-13c-approval-replay report

Date: 2026-11-06
Branch: `cs/cs-13`

## Landed

### Core — `packages/core/src/approval.ts`

- `ApprovalRequest` with `{agent, offerHash, title, amount, rail, terms, requestedAt, nonce}`,
  where `nonce` is 32 random bytes as 0x hex.
- `approvalRequestHash(request)`: `keccak256(canonicalJson(request))` with `sig` stripped.
- `ApprovalDecisionBody` gained version 2:
  `{kind, v: 2, approvalId, agent, offerHash, amount, rail, termsHash, requestHash, decision, decidedAt}`.
  `approvalDecisionBody` still builds a version 1 body when `requestHash` is absent; callers
  that pass it get version 2.
- `test/approval.test.ts` covers key-order stability, nonce/title/requestedAt sensitivity,
  cross-`requestHash` verification failure, and the existing signer/recovery cases.

### Buyer — `packages/buyer`

- `requestApproval` generates the nonce with `crypto.getRandomValues`, hashes its own request,
  and rebuilds the version 2 body with that hash before accepting a `countersign`.
  It still accepts a version 1 decision for compatibility with decisions produced before this
  change; that path remains one-shot through the consumed ids below.
- `State` keeps `approvals-consumed.json` (mode 0600, a JSON array). `consumeApproval` takes a
  pid lock before its read-modify-write, records an id once, and returns false when another
  call already consumed it. `requestApproval` returns `unverified` for an id it has seen and
  never signs.
- `buy.ts` passes its `State` into `requestApproval`. This is the only edit outside the listed
  lease: one argument line, required because the consumed ids live in the agent's state dir.
  `w1-attacks.test.ts` and `w1-approval-replay.test.ts` were not touched.
- `test/plumbing.test.ts` adds: a decision for call 1 served for call 2 ends
  `human-unverified`; one approval id cannot clear two buys; the consumed file is mode 0600.

### Hub — `apps/hub`

- `POST /approvals` requires `nonce` matching `0x` plus 64 hex characters, otherwise
  `400 bad-request`. The whole signed request, without `sig`, is stored in the new nullable
  `request_json` column (with a migration for existing databases).
- `POST /approvals/:id/decision` reads its body through `readJsonLimited` (16 KiB, `413`
  when over), rebuilds `requestHash` from the stored request, and verifies the approver's
  signature over the version 2 body. A decision bound to another request is `401`.
- Both approval views return `request` and `requestSig`.
- Tests cover the missing/malformed nonce (`400`), a correct version 2 decision (`200`), a
  decision bound to another request's hash (`401`), the request fields in the view, and an
  oversized decision body (`413`).

### Docs

`docs/spec/envelope.md` now documents the nonce, `requestHash`, version 2 of the decision
body, the consumed-id rule, and the phone's `requestSig` check.

## Trade-off

Version 1 decisions remain verifiable by the buyer, because cs-w1's `W1 B14` test constructs
its signature through `approvalDecisionBody` without a `requestHash` and must pass unedited.
A version 1 decision is still bound by the consumed id, so it can clear at most one held call;
new decisions are version 2 and are additionally bound to their request.

## Acceptance

From the worktree root:

```
bun install && bun run typecheck && bun test packages/core packages/buyer apps/hub && bun test && forge test
```

- `bun install`: no changes.
- `bun run typecheck`: passed.
- `bun test packages/core packages/buyer apps/hub`: 227 pass, 0 fail.
- `bun test`: 589 pass, 3 pre-existing skips, 0 fail.
- `forge test`: 29 pass, 0 fail.
- `W1 B12` passes; `W1 B14` passes unedited.

No browser, Playwright, Puppeteer or screenshot tool was launched. Tests use only local Bun
servers and fixed anvil keys; no live chain or external network call was made.
