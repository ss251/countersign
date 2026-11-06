# Envelope

The human's limits on what the agent may spend. Code: `packages/core/src/envelope.ts`. Enforcement: `packages/buyer`.

| Field | Meaning |
|---|---|
| `agent` | The key allowed to countersign under this envelope. |
| `cap` | Total budget, atomic 6-decimal USD. |
| `perMerchant` | Default limit per seller. `merchantLimits` overrides it per seller address. |
| `allowlist` | Seller addresses or offer hashes that may be paid. Empty means any. |
| `askAbove` | Above this amount the agent holds the call for the human's countersignature. |
| `approver` | The key whose signature countersigns a held call from another device. Absent: a held call can be approved only on the agent's machine. |
| `revoked`, `expiresAt` | A revoked or expired envelope approves nothing. |

Order of checks: revoked, expired, allowlist, cap, per-merchant limit, then ask-above. The agent reserves the spend in its journal under a file lock before it signs anything, so two concurrent calls cannot both fit under one cap. A refund gives the spend back only after the escrow's `jobOf` on chain says the job was refunded. The hub's word is not enough.

Refusals read, for example: "Refused. This would spend 5.000001 of a 5 budget."

## Approving a held call from another device

With `approvals: "hub"`, a call above `askAbove` is held until the phone signs this body
with the envelope's `approver` key:

```
{kind: "countersign-approval-decision", v: 1, approvalId, agent, offerHash,
 amount, rail, termsHash, decision, decidedAt}
```

`agent` and `offerHash` are lowercase hex, `termsHash` is `keccak256` of the canonical JSON
terms, `decision` is `countersign` or `decline`, and `decidedAt` is unix seconds. The message
is the canonical JSON of the body, signed with EIP-191 `personal_sign`.

Before it signs anything, the buyer rebuilds the body from its own request values — never
from the hub's copy — and verifies the signature against `approver`. It also requires
`decidedAt` to sit within the request's window and no later than its own clock plus 30
seconds. A `decline`, an expired request or a timeout needs no signature, because refusing
is always safe.

The hub checks the same signature against the approver in the agent's mirrored envelope and
stores it with the decision, but that check only keeps junk out of its table. The buyer's
check is the one that counts: the hub's word alone never clears a hold.
