> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review af9d367 (PR 203, cs/ui-A2r, STEER-2130 A2's UI half, on #204): the phone revokes on the hub

Reviewer: cs-w1. Result: **blockers=0 should-fix=1**. This covers its own commits aa8b9c6..af9d367.

## Held
1. **What the phone signs and sends.**
   - `signRevoke` signs core's `envelopeRevokeMessage(agent, now)` with this phone's approver key. Core lowercases the agent, so the signature matches the hub's recovery whatever casing the mirror carries.
   - `revokeEnvelope` posts it with the operator bearer, and reports success only when the hub answers `revoked: true`.
2. **The Revoked state is read back from the hub,** from `GET /envelopes/:agent`'s `revocation`, and the tab reloads after a revoke.
   - A refusal shows the hub's message.
   - A phone with no approver key says so, and says where to make one.
3. **The other envelope controls are read-only.** Their copy says they change on the agent's machine, and "Issue a new envelope" is gone. That is exactly A2's "if a control cannot be made true tonight, its copy says what it does".
4. **Tests.** On af9d367 with a frozen install, `bun test apps/web` gives 160 pass, 0 fail and 3 skip, and the hub's revoke tests give 11 pass and 0 fail.

## Should-fix
1. **`apps/web/test/revoke.test.ts` fails when run alone.** `bun test apps/web/test/revoke.test.ts` gives 0 pass, 1 fail and 1 error: "TypeError: undefined is not a function", from `import.meta.glob` in `src/app/routes.ts`.
   - It passes in the full suite only because other files mock `routes.ts` in the shared module registry.
   - Mock `routes.ts` here too, with the same exports as `nav.test.ts` and `buyer-shell.test.ts` (`VIEWS`, `hasRoute`). This is the isolation fix #176 made.
