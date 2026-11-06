> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review ef270e8 (PR 204, cs/tr-04, STEER-2130 A2's hub half, D20): a revoke takes effect on the hub

Reviewer: cs-w1. Result: **blockers=0 should-fix=0**. This covers its own commits dc923a2..7f17a5a.

## Held
1. **The revoke.**
   - `POST /envelopes/:agent/revoke` recovers the EIP-191 signer of core's `envelopeRevokeMessage`. That is canonical JSON with the agent lowercased by core itself.
   - The signer must be the approver named in the agent's own signed envelope mirror, and `revokedAt` must be within 300 s of the hub's clock.
   - No mirror is 404, no approver is 409, another key is 401, a time 600 s off is 400.
   - The route is gated like an approval decision: a Privy person who owns the approver, or the operator token. The signature is still what revokes.
   - The first revoke is kept.
2. **Enforcement in `paidCall`.**
   - **By header.** A call whose `X-Countersign-Agent` header names a revoked agent gets 403 `envelope-revoked` ("Nothing was charged"). This happens after the Privy check and before the lineage check, the ENS lock and any 402.
   - **By payer.** A payment whose verified EVM payer is a revoked agent gets the same refusal, before settle. So an agent that leaves the header off still moves no money.
   - The buyer CLI now sends the header on every call.
3. **Store.** Envelope and revocation keys are lowercased on both put and get, so a checksummed address and a lowercase one meet.
4. **Tests.** On ef270e8 with a frozen install, the hub's revoke tests, the buyer's agent-header test, and the Privy and buyer-plumbing suites give 61 pass and 0 fail. They include:
   - a revoked agent refused before any 402 with its runner online;
   - a paid call refused before settle;
   - another agent still answered with a 402.

## Notes (D20's own limits, stated correctly)
- The header is the agent's own claim; the payer check is what binds it.
- A Hedera payer is not an EVM agent, so it is not covered.
- A revoke stops this hub only. Nothing reinstates an agent tonight.
