> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review a5779b4 (cs/cs-13, refs #21): approval signatures, the B12 corrective

Reviewer: cs-w1. Result: **blockers=1 should-fix=2**.

Test: `W1 B14` in `packages/buyer/test/w1-approval-replay.test.ts` on `cs/w1` (6eb0803). On a5779b4 with only that file added, the buyer, hub and core tests give 218 pass and 1 fail (B14). The B12 test passes.

## Blocker
**B14. One signed approval clears more than one held call.**

The problem:
- The decision body binds `approvalId, agent, offerHash, amount, rail, termsHash, decision, decidedAt`. Its only per-request value is `approvalId`, and the hub chooses it: `requestApproval` verifies against the `id` that `POST /approvals` returned.
- Nothing in a 402 entry has to differ between two calls to the same offer. `checkTerms` pins the amount, payee, delivery window and offer hash, and requires no per-call value. So a hostile hub can answer a later request for that offer with the id the human already decided, and serve the stored decision again.
- The time window does not stop this. `decidedAt >= requestedAt - 30` accepts a decision made up to 30 s before the new request. Two concurrent held calls need no window at all: the hub shows the phone only one of them.
- The result is a second payment above ask-above with no human decision on it. That is the property B12 exists to protect.

The test: the human countersigns call 1 (id `a1`). Ten seconds later, call 2 to the same offer gets `a1` and the stored decision back. Expected one payment signature; got two.

The fix:
- Bind the decision to something the agent chose for this request. Put a random `nonce` in the agent's signed request. Put a `requestHash` in the decision body: keccak of the canonical signed request, covering nonce, title, amount, terms and requestedAt. The agent rebuilds that hash from its own request.
- Journal each approval id once it is consumed, and refuse any id seen before.

## Should-fix
1. **The human approves a title the hub supplies.**
   - `title` is in the agent-signed request but not in the signed decision.
   - The approval view does not return `requestSig`, so the phone cannot check that what it shows is what the agent asked for. A hub can show "Weather lookup" for a research job with the same offer hash and amount.
   - Fix: once `requestHash` is in the decision (B14), expose `requestSig` in the view and have the phone verify it against the fields it displays before it signs.
2. **The decision route reads an unbounded body.** `decideApproval` uses `readJson`, not `readJsonLimited`. The route is bearer-gated, so the risk is low, but the 16 KiB cap should hold on every write route.

## Held
- **B12 is closed.**
  - A `countersign` answer counts only with a signature from the envelope's `approver`. The signature must cover the agent's own offer hash, amount, rail and terms hash.
  - The approver comes from the agent's local envelope, never from the hub's mirror.
  - With no approver, the call is refused and nothing is signed.
  - A decline, expiry or timeout signs nothing. An unsigned decline is fail-safe.
- **Decision time:** only safe integers are accepted. A time more than 30 s past the agent's clock, or outside [request - 30 s, request + 900 s], is refused.
- **Hub:**
  - Deciding needs both the bearer token and the approver's signature over the stored row.
  - The update runs `WHERE status = 'pending'`, so two decisions cannot both win.
  - A replayed request signature is refused by a unique index.
  - An agent may have at most 20 pending approvals.
  - Mirror and request bodies are capped at 16 KiB.
  - `/envelopes/:agent` and the `/approvals` list are gated.
  - Agent addresses are lowercased on every store path.
- **Mirror:** it publishes once before the approval request and once after the outcome, never between signing and sending. It has a 5 s timeout, and `signedAt` strictly increases.
- **Limits:** each hub fetch has a 10 s timeout, and the whole approval wait is bounded at 120 s. The cap, per-merchant limit and allowlist are checked again under the journal reservation after the approval.
