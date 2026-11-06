# Envelope

The human's limits on what the agent may spend. Code: `packages/core/src/envelope.ts`. Enforcement: `packages/buyer`.

| Field | Meaning |
|---|---|
| `agent` | The key allowed to countersign under this envelope. |
| `cap` | Total budget, atomic 6-decimal USD. |
| `perMerchant` | Default limit per seller. `merchantLimits` overrides it per seller address. |
| `allowlist` | Seller addresses or offer hashes that may be paid. Empty means any. |
| `askAbove` | Above this amount the agent holds the call for the human's countersignature. |
| `revoked`, `expiresAt` | A revoked or expired envelope approves nothing. |

Order of checks: revoked, expired, allowlist, cap, per-merchant limit, then ask-above. The agent reserves the spend in its journal under a file lock before it signs anything, so two concurrent calls cannot both fit under one cap. A refund gives the spend back only after the escrow's `jobOf` on chain says the job was refunded. The hub's word is not enough.

Refusals read, for example: "Refused. This would spend 5.000001 of a 5 budget."
