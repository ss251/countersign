# tr-04: a revoke from the phone takes effect on the hub, which refuses that agent before any 402 (refs #21)

**Design: decided.** cs-truth wrote this on Opus from STEER-2130 (audit finding A2, the hub half) and `docs/decisions.md` D20, which is already committed on this branch. This branch also carries tr-03 (Privy on the hub), merged in before launch, so `apps/hub/src/privy.ts` exists. Implement exactly what follows. Nothing here is left for you to choose.

## Goal

After the envelope's approver revokes an agent from the phone, the hub refuses that agent's next call before any 402, and a test proves it. A revoked agent's payment is also refused before settle.

## Decisions

### 1. The message (`packages/core/src/approval.ts`)

Next to `approvalDecisionMessage`, add:

```ts
export interface EnvelopeRevokeBody { kind: "countersign-envelope-revoke"; v: 1; agent: string; revokedAt: number }

export function envelopeRevokeBody(agent: string, revokedAt: number): EnvelopeRevokeBody {
  return { kind: "countersign-envelope-revoke", v: 1, agent: agent.toLowerCase(), revokedAt };
}

/** D20: the EIP-191 personal_sign message for a revoke, the canonical JSON of its body. */
export function envelopeRevokeMessage(agent: string, revokedAt: number): string {
  return canonicalJson(envelopeRevokeBody(agent, revokedAt));
}
```

Export them the way the file's other functions are exported. `packages/core/src/index.ts` already re-exports this file; confirm that, and add the export there only if it does not.

### 2. Storage (`apps/hub/src/store.ts`)

- In the constructor, beside the other `CREATE TABLE IF NOT EXISTS` statements, add:
  ```
  CREATE TABLE IF NOT EXISTS revocations (agent TEXT PRIMARY KEY, revoked_at INTEGER NOT NULL, sig TEXT NOT NULL, recorded_at INTEGER NOT NULL)
  ```
- Add the methods:
  ```ts
  export interface RevocationRecord { agent: string; revokedAt: number; sig: Hex; recordedAt: number }
  putRevocation(record: RevocationRecord): void   // INSERT OR IGNORE, with agent lowercased: the first revoke is kept
  getRevocation(agent: string): RevocationRecord | null   // looks up agent.toLowerCase()
  ```

### 3. The route (`apps/hub/src/buyerplumbing.ts`)

Register `app.post("/envelopes/:agent/revoke", async (c) => revokeEnvelope(c, deps))` beside the other envelope routes. `revokeEnvelope` runs these steps in order, using the module's existing `fail`, its body reader with the 16 KiB cap, and `CLOCK_SKEW` (300):

1. **Access.** Gate it exactly as `decideApproval` is gated after tr-03:
   - `personFrom(...)` refused: answer that refusal.
   - `kind === "none"`: `requireToken`.
   - `kind === "person"`: keep the person for step 4.
2. **The envelope.** `const agent = c.req.param("agent").toLowerCase()` and `const mirror = deps.store.getEnvelopeMirror(agent)`. If it is `null`: `fail(404, "no-envelope", "Refused. This hub holds no envelope for that agent.")`.
3. **The approver.** `const approver = mirror.envelope.approver`. If it is missing: `fail(409, "no-approver", "Refused. This agent's envelope names no approver key.")`.
4. **The person.** If a person was kept in step 1 and `!owns(person, approver)`: `fail(403, "not-your-agent", "Refused. This agent's approver key is not one of your wallets.")`.
5. **The body.** Parse `{revokedAt, sig}`. If `revokedAt` is not a safe integer, or `sig` is not a string: `fail(400, "bad-request", "Refused. The revoke is malformed.")`. If `Math.abs(revokedAt - deps.now()) > CLOCK_SKEW`: `fail(400, "bad-time", "Refused. The revoke's time is not the hub's clock.")`.
6. **The signature.** Recover the signer of `envelopeRevokeMessage(agent, revokedAt)` from `sig` with `recoverMessageAddress`. If it throws, or the signer is not `approver` (compare lowercase): `fail(401, "bad-signature", "Refused. The revoke is not signed by this agent's approver.")`.
7. **Record it.** `deps.store.putRevocation({ agent, revokedAt, sig, recordedAt: deps.now() })`, then answer 200 with `{ agent, revoked: true, revokedAt: deps.store.getRevocation(agent)!.revokedAt }`.

`getEnvelope` adds one field to the JSON it already answers with: `revocation: rev === null ? null : { revokedAt: rev.revokedAt }`, where `rev = deps.store.getRevocation(agent)`.

### 4. Enforcement (`apps/hub/src/call.ts`)

Use one constant:

```ts
const REVOKED = "Refused. This agent's envelope was revoked by its approver. Nothing was charged.";
```

- **Before any 402.** Place this immediately after the Privy check that tr-03 added, after the offer lookup:
  ```ts
  const claimedAgent = (headers.get("x-countersign-agent") ?? "").trim();
  if (claimedAgent !== "" && deps.store.getRevocation(claimedAgent) !== null) {
    return failure(403, "envelope-revoked", REVOKED);
  }
  ```
- **Before settle.** Place this immediately after tr-03's `not-your-wallet` check and before `const payer = verify.payer ?? "";`:
  ```ts
  if (/^0x[0-9a-fA-F]{40}$/.test(verify.payer ?? "") && deps.store.getRevocation(verify.payer as string) !== null) {
    return failure(403, "envelope-revoked", REVOKED, railId);
  }
  ```

### 5. The buyer names itself

- **`packages/buyer/src/hub-client.ts`.** `call(hash, input, payment?, lineage?)` gains a fifth optional parameter `agent?: string`. When it is given, set `headers["X-Countersign-Agent"] = agent`.
- **`packages/buyer/src/buy.ts`.** Both `hub.call(...)` sites pass `agent?.address` as that fifth argument, where `agent` is the `SigningAccount` already computed at the top of `buy()`.

## Lease

- `packages/core/src/approval.ts` (section 1);
- `apps/hub/src/store.ts` (section 2);
- `apps/hub/src/buyerplumbing.ts` (section 3);
- `apps/hub/src/call.ts` (section 4);
- `packages/buyer/src/hub-client.ts` and `packages/buyer/src/buy.ts` (section 5);
- new tests: `apps/hub/test/revoke.test.ts` and `packages/buyer/test/agent-header.test.ts`.

Read only: everything else. Never commit `bun.lock`.

## Tests (no network)

**`apps/hub/test/revoke.test.ts`.** Build the hub the way `apps/hub/test/buyerplumbing.test.ts` does with `startTokenHub`. Mirror the agent's envelope, with `approver` set to an approver key, through that file's `PUT /envelopes/:agent` helper. Copy `apps/hub/test/call.test.ts`'s runner and `FakeRail` payment setup for the call cases.
1. **The approver revokes.** A correctly signed revoke with the operator token answers 200 `{revoked: true}`. `GET /envelopes/:agent` then shows `revocation.revokedAt`.
2. **Before any 402.** After the revoke, `POST /offers/:hash/call` with `X-Countersign-Agent: <agent>` answers 403 `envelope-revoked` with no `PAYMENT-REQUIRED` header, with a runner online.
3. **Before settle.** A paid call from the revoked agent without the header answers 403 `envelope-revoked`, and the rail's `settleCalls` does not grow.
4. **Other agents.** Another agent's call answers 402.
5. **Refusals.**
   - A revoke signed by another key answers 401.
   - An unknown agent answers 404.
   - An envelope with no approver answers 409.
   - A `revokedAt` 600 seconds off answers 400.
   - With no operator token, the answer is what `decideApproval` gives without one.
6. **The first revoke is kept.** A second revoke with a later `revokedAt` leaves the first `revokedAt` in place.
7. **Privy.** With the fake verifier from `apps/hub/test/privy.test.ts`, a person who owns the approver revokes without the operator token and gets 200. A person who does not gets 403 `not-your-agent`.

**`packages/buyer/test/agent-header.test.ts`.**
1. `HubClient.call` with an agent sends `X-Countersign-Agent` with that value, and without one sends no such header. Use a fake `fetchImpl` that records the request headers.
2. `buy()` passes the agent's address. Model the setup on `packages/buyer/test/buy.test.ts`, and assert the recorded header on the first call.

Every existing test still passes, unedited.

## Constraints

- **No browser** of any kind on this machine. That means no headless Chrome, no Playwright, no Puppeteer and no screenshot tools.
- **No network** in tests.
- **Existing tests:** never edit, weaken, skip or delete one to make it pass. If one fails, fix the code, or stop and report the root cause.
- **Commits:** small, present tense, ending `refs #21`, with no emoji and no `Co-authored-by`.

## Acceptance

```
bun install && bun run typecheck && bun test && forge test
```

All green.

## Stop conditions

Stop if any of these happens:
- a change is needed outside the lease;
- `apps/hub/src/privy.ts` (`personFrom`, `owns`) is missing on this branch;
- `approvalDecisionMessage`, `getEnvelopeMirror`, `requireToken`, `decideApproval`, `HubClient.call` or `buy` differ from what this packet names;
- a failure survives three different fixes;
- 50 minutes have passed.

## Report

Write `$M/reports/tr-04-revoke-on-hub.md`: the diff summary, the test names, and the gate output counts.
