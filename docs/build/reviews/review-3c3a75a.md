> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review 3c3a75a (cs/cs-13, refs #21) — hub plumbing and buyer approvals

Reviewer: cs-w1. Result: **blockers=1 should-fix=4**. Test: `W1 B12` in `packages/buyer/test/w1-attacks.test.ts` on `cs/w1`; it fails, and the other buyer tests pass.

## Blocker
**B12. A hub that answers "countersign" is taken for a human.** With `approvals: "hub"`, `buy()` clears the ask-above hold when `GET /approvals/:id` says `countersign`. The buyer verifies nothing about that answer: it is unsigned and names no approver key the envelope trusts. The hub is the party every earlier fix treated as hostile (B4, B6, B8), and here it can lift the human's limit on its own, up to the cap, per-merchant limit and allowlist, which are still checked locally. The ask-above rule is the only control that exists to stop the agent spending without a person, so its evidence cannot be the hub's word. Test: a hub that answers `countersign` with no human involved; expected no signature, the buyer signs. Fix: the decision must carry a signature by an approver key that the envelope names (add `approver` to the envelope, set when the human creates it), over `{approvalId, agent, offerHash, amount, rail, terms hash, decision, decidedAt}`; the buyer verifies it and the time window before it signs. The bearer token can stay as the hub's way to accept the phone's request, but the phone must sign the decision.

## Should-fix
1. **No timeouts on the buyer's hub calls.** `publishEnvelope`, `requestApproval` and its polling use a bare `fetch`, and `record()` awaits the mirror after every journal change, including between signing and sending the payment. A hub that stalls the PUT delays the buy indefinitely, so "a mirror can never change a buy outcome" does not hold for latency. Add `AbortSignal.timeout` and do not await the mirror on the buy path.
2. **Approval requests are unauthenticated beyond a self-chosen key.** Anyone can sign a request with a fresh key and flood `GET /approvals` with pending rows, burying real ones; each request is also replayable inside the 300 s window. Rate-limit per agent and per IP, and list only agents that have a mirrored envelope.
3. **Reads are public.** `/jobs?buyer=`, `/envelopes/:agent` (budget, allowlist, spend) and `/approvals` expose any address's purchase history and limits. Chain data is public, the envelope is not. At least gate `/envelopes` and `/approvals` to the agent's own signature.
4. **Mirror body size is unbounded.** `PUT /envelopes/:agent` stores arbitrary JSON; cap the body.

## Held
- Decision route: constant-time bearer compare, 503 with no token configured, 409 on an already decided or expired approval, and the status update is `WHERE status = 'pending'`, so two decisions cannot both win.
- Mirror PUT: the signer must equal both `:agent` and `envelope.agent`, `signedAt` within 300 s and strictly newer than the stored one.
- Cap, per-merchant limit and terms are checked locally before any request is made; a decline, expiry or timeout journals a refusal and signs nothing. The merged `failedDelivery` keeps the fault from PR 72 and tells the buyer honestly that direct rails do not refund.
- `bun test apps/hub packages/buyer`: all pass except B12.
