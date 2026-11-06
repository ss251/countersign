# tr-10: POST /envelopes/session gives a signed-in person an envelope and a token scoped to it (refs #21)

**Design: decided.** cs-truth wrote this on Opus for STEER-0215 item C2 (the hub half) and `docs/decisions.md` D23, which is already committed on this branch. Implement exactly what follows. Nothing here is left for you to choose. This is a security surface: write nothing that logs, prints or stores the raw token.

## Decisions

### 1. `apps/hub/src/store.ts`

- In the constructor, beside the other `CREATE TABLE IF NOT EXISTS` statements, add:
  ```
  CREATE TABLE IF NOT EXISTS envelope_tokens (token_hash TEXT PRIMARY KEY, agent TEXT NOT NULL, issued_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)
  ```
- Export, beside `RevocationRecord`:
  ```ts
  /** A Buyer-page token, stored only as its SHA-256 (D23). */
  export interface EnvelopeTokenRecord { tokenHash: string; agent: string; issuedAt: number; expiresAt: number }
  ```
- Add two methods to `Store`:
  - `replaceEnvelopeToken(record: EnvelopeTokenRecord): void` runs `DELETE FROM envelope_tokens WHERE agent = ?` and then inserts the record, with `agent` lowercased.
  - `getEnvelopeToken(tokenHash: string): EnvelopeTokenRecord | null` looks the hash up and maps the row back to the record.

### 2. `apps/hub/src/buyerplumbing.ts`

- Change the import `import { randomBytes, timingSafeEqual } from "node:crypto";` to `import { createHash, randomBytes, timingSafeEqual } from "node:crypto";`.
- Add these constants next to the module's other constants:
  ```ts
  /** D23: a session envelope and its token live 24 hours. */
  const SESSION_TTL = 86_400;
  const SESSION_DEFAULTS = { cap: "1000000", perMerchant: "500000", askAbove: "50000" } as const;
  ```
- Register `app.post("/envelopes/session", async (c) => sessionEnvelope(c, deps));` on the line directly above `app.put("/envelopes/:agent", ...)`.
- Add this handler, exactly:
  ```ts
  async function sessionEnvelope(c: Context, deps: BuyerPlumbingDeps): Promise<Response> {
    const privyCheck = await personFrom(c.req.raw.headers, deps.privy);
    if (privyCheck.kind === "refused") return fail(privyCheck.status, privyCheck.code, privyCheck.message);
    if (privyCheck.kind === "none") {
      return fail(401, "sign-in-required", "Refused. Sign in to create an envelope. Nothing was issued.");
    }
    const person = privyCheck.person;

    const parsed = await readJsonLimited(c);
    if (parsed.kind === "too-large") return fail(413, "too-large", "Refused. The request body is too large.");
    if (parsed.kind === "malformed") return fail(400, "bad-request", "Refused. Name your wallet as {agent}.");
    const named = isRecord(parsed.value) ? parsed.value.agent : undefined;
    if (typeof named !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(named)) {
      return fail(400, "bad-request", "Refused. Name your wallet as {agent}.");
    }
    if (!owns(person, named)) {
      return fail(403, "not-your-wallet", "Refused. That wallet is not one of yours. Nothing was issued.");
    }
    const agent = named.toLowerCase();
    const now = deps.now();

    const existing = deps.store.getEnvelopeMirror(agent);
    if (existing !== null && !owns(person, existing.envelope.approver)) {
      return fail(
        403,
        "not-your-agent",
        "Refused. This agent's approver key is not one of your wallets. Nothing was issued.",
      );
    }
    if (existing === null) {
      const envelope: Envelope = {
        v: 1,
        agent: agent as Envelope["agent"],
        cap: SESSION_DEFAULTS.cap,
        perMerchant: SESSION_DEFAULTS.perMerchant,
        allowlist: [],
        revoked: false,
        expiresAt: now + SESSION_TTL,
        askAbove: SESSION_DEFAULTS.askAbove,
        approver: agent as Envelope["agent"],
      };
      deps.store.putEnvelopeMirror({
        agent,
        envelope,
        spent: { total: "0", bySeller: {} },
        signedAt: now,
        sig: "0x",
      });
    }
    const stored = deps.store.getEnvelopeMirror(agent);
    if (stored === null) return fail(500, "store", "Refused. The envelope could not be stored.");

    const token = `cse_${randomBytes(32).toString("hex")}`;
    const tokenExpiresAt = now + SESSION_TTL;
    deps.store.replaceEnvelopeToken({ tokenHash: tokenHash(token), agent, issuedAt: now, expiresAt: tokenExpiresAt });
    // D23: the token is returned once, here, and never logged.
    return json({ agent, envelope: stored.envelope, issued: existing === null, token, tokenExpiresAt });
  }
  ```
- In `getEnvelope`:
  - change `verified: true,` to `verified: stored.sig !== "0x",`;
  - change its `requireToken(c, deps)` call to `requireToken(c, deps, c.req.param("agent"))`.
- In `listApprovals`, change its `requireToken(c, deps)` call to `requireToken(c, deps, c.req.query("agent"))`.
- In `decideApproval`, change its `requireToken(c, deps)` call to `requireToken(c, deps, approvalAgent(deps, c.req.param("id")))`.
- The `requireToken(c, deps)` call in `revokeEnvelope` stays as it is.
- Replace the whole `requireToken` function with exactly this, and add the three helpers after it:
  ```ts
  function requireToken(c: Context, deps: BuyerPlumbingDeps, agent?: string): Response | null {
    const header = c.req.header("authorization") ?? "";
    const match = /^Bearer (.+)$/i.exec(header);
    const provided = match?.[1] ?? "";
    if (provided !== "" && agent !== undefined && agent !== "" && scopedTokenAllows(deps, provided, agent)) {
      return null;
    }
    const expected = deps.humanApprovalToken;
    if (expected === undefined || expected === "") {
      return fail(503, "no-approver", "Refused. No human approver is configured.");
    }
    if (match === null || !sameToken(provided, expected)) {
      return fail(401, "unauthorized", "Refused. The approver token is not valid.");
    }
    return null;
  }

  /** D23: a session token opens only its own agent's envelope and approvals, until it expires. */
  function scopedTokenAllows(deps: BuyerPlumbingDeps, token: string, agent: string): boolean {
    const record = deps.store.getEnvelopeToken(tokenHash(token));
    return record !== null && record.agent === agent.toLowerCase() && record.expiresAt > deps.now();
  }

  function tokenHash(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  function approvalAgent(deps: BuyerPlumbingDeps, id: string | undefined): string | undefined {
    return id === undefined ? undefined : deps.store.getApproval(id)?.agent;
  }
  ```

Nothing else changes.

## Lease

- `apps/hub/src/store.ts` (section 1);
- `apps/hub/src/buyerplumbing.ts` (section 2);
- `apps/hub/test/envelope-session.test.ts`: new.

Read only: everything else. Never commit `bun.lock`.

## Tests (`apps/hub/test/envelope-session.test.ts`, no network)

Copy from `apps/hub/test/privy.test.ts`:
- the `verifier` ("alice" owns `ALICE_WALLETS`, which includes `APPROVER_WALLET`; "bob" owns `BOB_WALLET`);
- `startPrivyHub`, `privyHeader`, `TOKEN`, the keys and accounts, `SPENT`, `ENVELOPE` and `APPROVAL_REQUEST`.

Copy `signedMirror`, `putMirror` and `createApproval` from `apps/hub/test/buyerplumbing.test.ts`. Start every hub with `startPrivyHub({ privy: verifier, humanApprovalToken: TOKEN })` unless a case says otherwise. `post(hub, headers, body)` posts JSON to `/envelopes/session`.

1. **No session.** No Privy header, body `{agent: APPROVER_WALLET}`. The answer is 401 with code `sign-in-required`, the body has no `token`, and `hub.store.getEnvelopeMirror(APPROVER_WALLET)` is `null`.
2. **Privy off.** `startPrivyHub({ humanApprovalToken: TOKEN })`, with Alice's header. The answer is 401 `sign-in-required`.
3. **The first call issues.** Alice, `{agent: APPROVER_WALLET}`.
   - The answer is 200. `token` starts with `cse_` and is 68 characters long. `issued` is `true`, and `tokenExpiresAt` is `NOW + 86400`.
   - `envelope` equals `{v: 1, agent: APPROVER_WALLET, cap: "1000000", perMerchant: "500000", allowlist: [], revoked: false, expiresAt: NOW + 86400, askAbove: "50000", approver: APPROVER_WALLET}`.
4. **The token opens its own agent.** With `Authorization: Bearer <token>` and no Privy header:
   - `GET /envelopes/<APPROVER_WALLET>` is 200, with `verified` `false`;
   - `GET /approvals?agent=<APPROVER_WALLET>` is 200.
5. **And nothing else.** Seed `AGENT`'s mirror with `signedMirror` and `putMirror`, then `createApproval` for `AGENT`. With Alice's token, each of these is 401:
   - `GET /envelopes/<AGENT.address>`;
   - `GET /approvals?agent=<AGENT.address>`;
   - `GET /approvals` with no agent;
   - `POST /approvals/<that id>/decision`.
6. **Not her wallet.** Alice, `{agent: BOB_WALLET}`. The answer is 403 `not-your-wallet`, there is no `token`, and no mirror is stored for `BOB_WALLET`.
7. **Not her agent.** Put a mirror for `BOB_WALLET` directly into the store, with `approver: APPROVER_WALLET`, through `hub.store.putEnvelopeMirror`. Bob, `{agent: BOB_WALLET}`. The answer is 403 `not-your-agent`.
8. **A second call replaces the token.** Alice twice.
   - The second answer has `issued` `false` and the same `envelope`, and its `token` differs from the first.
   - The first token now gets 401 on `GET /envelopes/<APPROVER_WALLET>`, and the second gets 200.
9. **Expiry.** After `hub.setNow(NOW + 86401)`, the token gets 401 on `GET /envelopes/<APPROVER_WALLET>`.
10. **Only the hash is stored.**
    - `hub.store.getEnvelopeToken(token)` is `null`.
    - `hub.store.getEnvelopeToken(<sha256 hex of token>)` is non-null, with `agent` `APPROVER_WALLET`.
11. **The operator token still works.** `Authorization: Bearer TOKEN` on `GET /envelopes/<APPROVER_WALLET>` is 200.

Every existing test still passes, unedited.

## Constraints

- **No browser** of any kind.
- **No network** in tests.
- **Never print or log a token or a key**, in code, tests or the report.
- **Never run `git stash`.** Use a temporary commit or a second worktree.
- **Existing tests:** never edit, weaken, skip or delete one to make it pass.
- **Commits:** small, present tense, ending `refs #21`, with no emoji and no `Co-authored-by`.

## Acceptance

```
bun install --linker hoisted && bun run typecheck && bun test && forge test
```

All green.

## Stop conditions

Stop if any of these happens:
- a change is needed outside the lease;
- a line this packet quotes differs from the file;
- a failure survives three different fixes;
- 30 minutes have passed.

## Report

Write `~/Developer/countersign-mac/reports/tr-10-envelope-session.md` (on the second machine): the diff summary, the test names, and the gate output counts. Write no token value into it.
