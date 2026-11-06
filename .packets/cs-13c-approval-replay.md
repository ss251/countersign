# cs-13c-approval-replay — one human decision clears exactly one held call (refs #21)

## Setup

Run `bun install` at the worktree root before anything else. You are on `cs/cs-13`. It holds cs-13, cs-13b and cs-w1's failing test `W1 B14` in `packages/buyer/test/w1-approval-replay.test.ts`.

## The design is decided

Read `docs/decisions.md`, "D10, amended". Implement exactly that, and do not redesign it.

**The blocker (cs-w1 B14).** The decision body binds only values that a second call to the same offer repeats, plus an `approvalId` the hub chooses. A hostile hub can answer a new request with an old id and serve the stored decision again: one human yes, two payments above ask-above.

## Lease

You may create or change only these paths:

- `packages/core/src/approval.ts` and `packages/core/test/approval.test.ts`
- `packages/buyer/src/approvals.ts`, `packages/buyer/src/state.ts` (the consumed ids only) and `packages/buyer/test/plumbing.test.ts`. Never edit `w1-attacks.test.ts` or `w1-approval-replay.test.ts`.
- `apps/hub/src/buyerplumbing.ts`, `apps/hub/src/store.ts` (one new nullable `request_json` column by migration, plus its methods) and `apps/hub/test/buyerplumbing.test.ts`
- `docs/spec/envelope.md`: the decision section
- `.packets/reports/cs-13c-approval-replay.md`

## What to build

### 1. Core (`approval.ts`)

- **`ApprovalRequest`.** The type is `{agent, offerHash, title, amount, rail, terms, requestedAt, nonce}`, where `nonce` is 32 random bytes as 0x hex.
- **`approvalRequestHash(request)`** is `keccak256(toBytes(canonicalJson(request)))`, lowercase. The request is taken without `sig`.
- **`ApprovalDecisionBody` becomes version 2:**

  ```
  {kind: "countersign-approval-decision", v: 2, approvalId, agent, offerHash, amount, rail, termsHash, requestHash, decision, decidedAt}
  ```

- **`approvalDecisionBody(...)`** takes `requestHash`.
- **Tests:**
  - the request hash is stable across key order;
  - changing `nonce`, `title` or `requestedAt` changes it;
  - a decision signed for one `requestHash` does not verify for another.

### 2. Buyer (`approvals.ts` and `state.ts`)

- **`requestApproval`**
  - It generates the `nonce` with `crypto.getRandomValues` and includes it in the signed request.
  - It computes `requestHash` from **its own** request.
  - When it verifies a `countersign` decision, it rebuilds the body with that `requestHash`.
- **Consumed approval ids.** Keep them in the state dir (`approvals-consumed.json`, mode 0600, an array).
  - Record an id the moment a verified `countersign` is used.
  - An id already present makes the outcome `"unverified"`, and nothing is signed.
- **Tests:**
  - `W1 B14` passes unedited;
  - `W1 B12` still passes;
  - a decision for call 1 served for call 2 ends in `human-unverified`;
  - one approval id can never clear two buys.

### 3. Hub (`buyerplumbing.ts` and `store.ts`)

- **`POST /approvals`.**
  - Require `nonce`, 0x followed by 64 hex characters. Otherwise answer 400 `bad-request`.
  - Store the whole signed request without `sig` in `request_json`.
- **The decision route.**
  - Rebuild `requestHash` from the stored request, and verify the approver's signature over the v2 body.
  - Read the body with the same 16 KiB-limited reader as the other write routes (`readJsonLimited`).
- **The approval views,** per id and in the list, return `request` (the stored signed request) and `requestSig`, so the phone can check the agent's signature over exactly what it shows.
- **Tests:**
  - a missing or malformed nonce gives 400;
  - a v2 decision with the right `requestHash` gives 200;
  - one signed for another request's hash gives 401;
  - the view carries `request` and `requestSig`;
  - an oversized decision body gives 413.

### 4. Docs

Update `docs/spec/envelope.md`, "Approving a held call from another device":

- the nonce;
- the `requestHash`;
- version 2 of the decision body;
- the consumed-id rule;
- that the phone checks `requestSig` before it signs.

## Constraints

- **Never launch a browser of any kind on this machine**: no Chrome or Chromium, headless or not, no Playwright, Puppeteer or screenshot tools. UI checks go back to the lane, which raises NEEDS-BROWSER.
- No view code. No network in tests. Use only fixed anvil test keys. TypeScript strict, no `any`. Never log a token, a signature or a key.

## Acceptance

From the worktree root:

```
bun install && bun run typecheck && bun test packages/core packages/buyer apps/hub && bun test && forge test
```

Every command passes. `W1 B12` and `W1 B14` both pass.

## Stop conditions

- You need to edit outside the lease: stop and write the report.
- One problem has blocked you for more than 20 minutes: stop, commit what passes, and write the report.

## Finish

Commit with small present-tense messages ending `(refs #21)`, and no trailers. Write `.packets/reports/cs-13c-approval-replay.md`. Do not push, merge or deploy.
