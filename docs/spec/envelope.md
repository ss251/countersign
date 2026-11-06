# Envelope

The human's limits on what the agent may spend. Code: `packages/core/src/envelope.ts`. Enforcement: `packages/buyer`.

| Field | Meaning |
|---|---|
| `agent` | The key allowed to countersign under this envelope. |
| `cap` | Total budget, atomic 6-decimal USD. |
| `perMerchant` | Default limit per seller. `merchantLimits` overrides it per seller address. |
| `allowlist` | Seller addresses or offer hashes that may be paid. Empty means any. |
| `askAbove` | Above this amount the agent holds the call until a human approves it: on the agent's machine with `buy --approve`, or from another device with the `approver` key (below). |
| `approver` | The key whose signature countersigns a held call from another device. Absent: a held call can be approved only on the agent's machine. |
| `revoked`, `expiresAt` | A revoked or expired envelope approves nothing. |

Order of checks: revoked, expired, allowlist, cap, per-merchant limit, then ask-above. The agent reserves the spend in its journal under a file lock before it signs anything, so two concurrent calls cannot both fit under one cap. A refund gives the spend back only after the escrow's `jobOf` on chain says the job was refunded. The hub's word is not enough.

Refusals read, for example: "Refused. This would spend 5.000001 of a 5 budget."

## Approving a held call from another device

With `approvals: "hub"`, a call above `askAbove` is held until the phone signs a decision
with the envelope's `approver` key.

The agent's signed request carries `{agent, offerHash, title, amount, rail, terms,
requestedAt, nonce}`, where `nonce` is 32 random bytes as 0x hex. `requestHash` is
`keccak256` of the canonical JSON request without `sig`. The hub stores that signed request
and returns it with `requestSig` in the approval views, so the phone checks that the agent
signed exactly what it displays, title included, before it signs.

The decision body is version 2:

```
{kind: "countersign-approval-decision", v: 2, approvalId, agent, offerHash,
 amount, rail, termsHash, requestHash, decision, decidedAt}
```

`agent` and `offerHash` are lowercase hex, `termsHash` is `keccak256` of the canonical JSON
terms, `requestHash` is the hash of this request, `decision` is `countersign` or `decline`,
and `decidedAt` is unix seconds. The message is the canonical JSON of the body, signed with
EIP-191 `personal_sign`.

Before it signs anything, the buyer rebuilds the body from its own request values — never
from the hub's copy — including its own `requestHash`, and verifies the signature against
`approver`. A decision made for another request, even for the same offer and amount, does
not verify. It also requires `decidedAt` to sit within the request's window and no later
than its own clock plus 30 seconds. A `decline`, an expired request or a timeout needs no
signature, because refusing is always safe.

The buyer records every approval id it consumes in `approvals-consumed.json` beside its
state (mode 0600) and refuses an id it has seen before: one human decision clears exactly
one held call, even if the hub answers a new request with an old id and serves the stored
decision again.

The hub checks the same signature against the approver in the agent's mirrored envelope and
stores it with the decision, but that check only keeps junk out of its table. The buyer's
check is the one that counts: the hub's word alone never clears a hold.
