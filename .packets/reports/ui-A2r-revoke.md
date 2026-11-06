# ui-A2r revoke report

## Built

- `apps/web/src/lib/approver.ts`: added `signRevoke(agent, now)`. It reads the phone's approver key with `readKey()`, throws `SigningError("no-key", "This phone has no approver key yet.")` when absent, and otherwise signs core's `envelopeRevokeMessage(agent, now)` through the same dynamic `viem/accounts` import `signDecision` uses. Returns `{ revokedAt: now, sig }`; the key never leaves the module.
- `apps/web/src/lib/types.ts`: `EnvelopeView` gains `revokedAt?: number`.
- `apps/web/src/lib/api.ts`:
  - `EnvelopeMirror` gains `revocation?: { revokedAt: number } | null`.
  - `envelope()` now derives `envelope.revoked` from `m.revocation != null` and `revokedAt` from `m.revocation?.revokedAt`, so both are the hub's read, not local state.
  - Added `api.revokeEnvelope(agent, { revokedAt, sig })`. It POSTs JSON to `${hubBase()}/envelopes/${agent}/revoke` with `content-type: application/json` and the remembered operator bearer. A 2xx with `revoked === true` returns `{ ok: true, revokedAt }`; any other answer returns the hub's `message` or `The hub answered ${status}.`. No hub and a thrown fetch return the two decided sentences.
- `apps/web/src/routes/buyer/EnvelopeTab.tsx`:
  - Every `LimitRow` and the `Allowlist` is read-only in every case. Removed Change/Save/Cancel, the add/remove seller forms, and every `envelope.set(...)` call.
  - Kept the signed-mirror note; when `view.mirror` is undefined, shows `Sample limits from the fixtures. No hub holds them, so nothing here can change one.`
  - The `Revoked.` section is `data-testid="env-revoked"`, now names the hub as the place the agent is refused, includes `since {formatClock(view.revokedAt)}` only when known, says a revoked agent stays revoked, and has no reinstate button.
  - The Revoke section renders only for a non-revoked hub mirror. Its button is `data-testid="env-revoke"`, its line and dialog use the decided copy, and its confirm button is `data-testid="env-revoke-confirm"`. Confirm signs with `signRevoke(view.mirror.agent)`, calls `api.revokeEnvelope`, reloads the envelope on success, and shows a no-key `SigningError` or the hub's refusal verbatim. While working it reads `Revoking` and is disabled.
  - Refusals render in `p.env__error` with `role="alert"` and `data-testid="env-revoke-refusal"`.
- `apps/web/src/routes/buyer/buyer.css`: added `.env__error` with `color: var(--seal)` and `font-size: var(--t-13)`, tokens only. Removed the now-unused limit-editing and allowlist add/remove rules, and narrowed the allowlist row to its two remaining columns.

## Tests

New `apps/web/test/revoke.test.ts`, no browser and no network:

- `signRevoke` over a made key recovers to `approverAddress()` over `envelopeRevokeMessage(agent, 1_793_980_000)`.
- Without a key it throws a `SigningError` with problem `"no-key"`.
- `api.revokeEnvelope` POSTs to `<hub>/envelopes/<agent>/revoke` with `{ revokedAt, sig }`, JSON content type and the bearer token. A 200 `{ agent, revoked: true, revokedAt }` returns `{ ok: true, revokedAt }`; a 401 returns the hub's exact refusal message.
- `api.envelope()` maps `revocation: { revokedAt: 5 }` to `revoked === true` and `revokedAt === 5`, and `revocation: null` to `revoked === false`.
- `renderToString(EnvelopeTab)` with an open hub mirror contains `Revoke the envelope` and `env-revoke` and no `Save` or `Issue a new envelope`; a revoked hub mirror contains `env-revoked` and `stays revoked` and no `Issue a new envelope`.

No existing test asserted the removed local edits, so no existing test was adapted.

## Acceptance

From the worktree root:

```
bun install --linker hoisted && bun run typecheck && bun test apps/web/test && (cd apps/web && bunx --bun vite build)
```

- `bun install --linker hoisted`: no changes
- typecheck: clean
- tests: 160 pass, 3 skip, 0 fail, 764 expectations, 14 files
- vite build: 4971 modules transformed, built successfully

No browser was launched. No files outside the lease were changed. Nothing was pushed, merged or deployed.
