# cs-13b-approval-signatures — a held call clears only with the approver's signature (refs #21)

## Setup

Run `bun install` at the worktree root before anything else. You are on `cs/cs-13`. It holds cs-13's work and cs-w1's failing test `W1 B12` in `packages/buyer/test/w1-attacks.test.ts`.

## The blocker (cs-w1 B12)

With `approvals: "hub"`, `buy()` clears the ask-above hold as soon as `GET /approvals/:id` says `countersign`. Nothing in that answer is signed, so a hostile hub can lift the human's limit on its own. The fix: the human's decision is signed by an **approver key that the envelope names**, and the buyer verifies that signature before it signs anything.

cs-w1 also asked for these, and they are in scope:

- timeouts on every buyer call to the hub, and no mirror call between signing and sending a payment;
- a cap on the size of request bodies;
- approval requests only from agents with a mirrored envelope, a limit on pending requests, and no replays;
- the envelope and approval list readable only with the approver token.

## Lease

You may create or change only these paths:

- `packages/core/src/types.ts`: only `Envelope.approver`
- `packages/core/src/approval.ts` (new), and `packages/core/src/index.ts` to export it
- `packages/core/test/approval.test.ts` (new)
- `apps/hub/src/buyerplumbing.ts`, `apps/hub/src/store.ts` (approvals columns and methods only), `apps/hub/test/buyerplumbing.test.ts`
- `packages/buyer/src/**` except `packages/buyer/src/hedera/`, and `packages/buyer/test/**` except `w1-attacks.test.ts`, which you must not edit
- `docs/spec/envelope.md`
- `.packets/reports/cs-13b-approval-signatures.md`

## What to build

### Core (`packages/core`)

1. **`Envelope.approver?: Address`** in `types.ts`. Document it as: "The key whose signature countersigns a held call from another device. Absent: a held call can be approved only on the agent's machine."
2. **`src/approval.ts`** exports:
   - The type `ApprovalDecisionBody`:

     ```
     {kind: "countersign-approval-decision", v: 1, approvalId, agent, offerHash, amount, rail, termsHash, decision, decidedAt}
     ```

     - `agent` and `offerHash` are lowercase hex.
     - `termsHash` is `keccak256(toBytes(canonicalJson(terms)))`, lowercase.
     - `decision` is `"countersign" | "decline"`.
     - `decidedAt` is in unix seconds.
   - `termsHashOf(terms: unknown): Hex`.
   - `approvalDecisionBody({approvalId, agent, offerHash, amount, rail, terms, decision, decidedAt})`. It lowercases the addresses and computes `termsHash`.
   - `approvalDecisionMessage(body): string`, which is `canonicalJson(body)`. The approver signs it with EIP-191 `personal_sign`.
   - `approvalDecisionSigner(body, sig): Promise<Address | null>`. It returns the recovered address, or `null` if the signature is malformed.
3. **`test/approval.test.ts`**, using a fixed anvil key:
   - a signature recovers to its signer;
   - changing any single field (amount, offerHash, rail, terms, decision, decidedAt, approvalId) recovers a different address;
   - `termsHashOf` does not depend on key order;
   - a malformed signature gives `null`.

### Hub (`apps/hub/src/buyerplumbing.ts`, `store.ts`)

1. **`POST /approvals`**
   - Bodies over 16 KiB get 413 `too-large`.
   - The agent must have a stored envelope mirror. Otherwise answer 409 `unknown-agent`: "Refused. Publish this agent's envelope before asking for approvals."
   - At most 20 approvals may be pending per agent. Otherwise answer 429 `too-many-pending`.
   - The same request signature twice gives 409 `duplicate-request`. Store the request signature in a new nullable `request_sig` column with a unique index, added by a migration that also works on existing databases.
2. **`POST /approvals/:id/decision`**
   - The bearer check is unchanged.
   - The body is `{decision, decidedAt, sig}`. `decidedAt` must be within 300 s of the hub's clock; otherwise answer 400 `bad-request`.
   - The agent's stored mirror must name `envelope.approver`. Otherwise answer 409 `no-approver`: "Refused. This agent's envelope names no approver key."
   - `approvalDecisionSigner(approvalDecisionBody({approvalId: row.id, agent: row.agent, offerHash: row.offerHash, amount: row.amount, rail: row.rail, terms: row.terms, decision, decidedAt}), sig)` must equal that approver, case-insensitively. Otherwise answer 401 `bad-signature`.
   - Store the status, `decided_at = decidedAt` (the signed value) and the signature in a new nullable `decision_sig` column.
3. **The approval views** (`GET /approvals/:id` and the list) gain `decisionSig` (string or null). `decidedAt` is the signed value.
4. **`PUT /envelopes/:agent`**: bodies over 16 KiB get 413 `too-large`.
5. **Reads**
   - `GET /envelopes/:agent` and `GET /approvals?agent=…` now need the same bearer token as decisions:
     - 503 `no-approver` when the hub has no token;
     - 401 for a missing or wrong token.
   - `GET /approvals/:id` stays open, because its random 128-bit id is a capability that only the agent and the phone hold.
   - `/jobs?buyer=` stays public, because it shows only what the chains already show.

### Buyer (`packages/buyer`)

1. **`requestApproval`**
   - It takes `approver: Address`.
   - `ApprovalOutcome` adds `"unverified"`.
   - When a poll reads `status: "countersign"`:
     - The answer must include `decidedAt` and `decisionSig`.
     - Rebuild the body from **the agent's own request values**, never from the hub's copy: the approval id from the POST, its own address, offerHash, amount, rail and terms, the decision `"countersign"`, and the hub's `decidedAt`.
     - Verify that `approvalDecisionSigner` equals `approver`.
     - `decidedAt` must lie between `requestedAt - 30` and `requestedAt + 900`, and must be no later than the current clock plus 30.
     - If any of these fails, the result is `"unverified"`.
   - `decline`, `expired` and `timeout` need no signature, because refusing is always safe.
   - Every fetch uses `AbortSignal.timeout(10_000)`, injectable for tests. A poll that times out counts as pending.
2. **`buy()` with `approvals: "hub"`**, after the local checks:
   - If `envelope.approver` is unset, append `refused` with reason `no-approver` and throw `BuyError("Held. This envelope names no approver key, so a held call can be approved only on this machine.")`. Make no request.
   - Publish the mirror, awaited, with its timeout, right before `requestApproval`, so the hub knows the approver.
   - If the request cannot be posted (network error, timeout or a non-2xx answer), append `refused` with reason `approval-unavailable` and throw `BuyError("Held. The hub could not take the approval request; nothing was signed.")`.
   - On `unverified`, append `refused` with reason `human-unverified` and throw `BuyError("Held. The hub's answer is not signed by your approver key; nothing was signed.")`.
   - On `countersign` with a valid signature, continue to signing.
3. **The mirror**
   - `publishEnvelope` uses `AbortSignal.timeout(5_000)`, injectable for tests.
   - `signedAt` is the current unix second, raised to the agent's last `signedAt + 1` when needed. Keep that in a process-local map per agent address. This fixes a bug: today every publish in one `buy()` reuses `a.now`, so the hub refuses every publish after the first as not newer.
   - `buy()` no longer publishes after every journal append. It publishes once when it finishes, in a `finally`, after the outcome is journalled, and also on the approval path before the request.
   - Nothing is published between signing and sending the payment.
   - `resume()` publishes once at its end, as today.

### Docs

`docs/spec/envelope.md` gains:

- the `approver` row;
- a short section, "Approving a held call from another device", covering:
  - the decision body;
  - who signs it;
  - what the buyer checks before it signs;
  - that the hub's word alone never clears a hold.

## Tests

- **Core:** as above.
- **Hub:**
  - a decision with no `sig` gives 400;
  - a signature from a key that is not the approver gives 401;
  - the approver's signature gives 200, and `GET /approvals/:id` returns `decisionSig` and the signed `decidedAt`;
  - `POST /approvals` from an agent with no mirror gives 409;
  - a decision for an agent whose mirror has no approver gives 409 `no-approver`;
  - the 21st pending request gives 429;
  - a replayed request gives 409;
  - `GET /envelopes/:agent` with no token gives 401, and with the token gives 200;
  - an oversized PUT gives 413.
- **Buyer:**
  - `W1 B12` passes unedited;
  - a hub that answers `countersign` signed by a different key ends in `human-unverified`, and nothing is signed;
  - a hub that changes the amount it shows (it signs over the hub's copy) ends in `human-unverified`;
  - the approver's real signature over the agent's own values leads to signing and paying;
  - an envelope with no `approver` makes no request;
  - a mirror PUT that never answers delays a buy by at most the mirror timeout (inject a short one);
  - `buy()` publishes the mirror once, after the outcome;
  - every existing hub and buyer test passes. Update cs-13's own plumbing tests only where these rules change them, and list each change in the report.

## Constraints

- **Never launch a browser of any kind on this machine**: no Chrome or Chromium, headless or not, no Playwright, Puppeteer or screenshot tools. UI checks go back to the lane, which raises NEEDS-BROWSER.
- No view code: `apps/web` belongs to cs-ui, which will sign decisions on the phone with `approvalDecisionMessage`.
- No network in tests. Use only fixed anvil test keys. TypeScript strict, no `any`.
- Never log the bearer token, a signature or a key.

## Acceptance

From the worktree root:

```
bun install && bun run typecheck && bun test apps/hub packages/buyer packages/core && bun test && forge test
```

Every command passes, with no skipped tests apart from those already skipped on `cs/int`.

## Stop conditions

- You need to edit outside the lease: stop and write the report.
- One problem has blocked you for more than 20 minutes: stop, commit what passes, and write the report.

## Finish

Commit with small present-tense messages ending `(refs #21)`, and no trailers. Write `.packets/reports/cs-13b-approval-signatures.md`. Do not push, merge or deploy.
