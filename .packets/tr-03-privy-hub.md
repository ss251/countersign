# tr-03: the hub checks a signed-in person with Privy on the routes that act for them (refs #21)

**Design: decided.** cs-truth wrote this on Opus from the captain's STEER-2115 and `docs/decisions.md` D19, which is already committed on this branch. Implement exactly what follows. Nothing here is left for you to choose.

## Goal

`@privy-io/server-auth` verifies the Privy access token on every route that acts for a person. Signatures still authorise money. With `PRIVY_APP_ID` or `PRIVY_APP_SECRET` unset, behaviour is unchanged.

## Decisions

### 1. The dependency

Add `"@privy-io/server-auth": "1.32.5"` (exact) to `apps/hub/package.json` `dependencies`, then run `bun install`. Commit `apps/hub/package.json` and the resulting `bun.lock` change together, in one commit: `add @privy-io/server-auth 1.32.5 to the hub (refs #21)`. orch-cs approves the lock change at review.

### 2. New file `apps/hub/src/privy.ts`

```ts
import { PrivyClient } from "@privy-io/server-auth";

/** The header the console sends the person's Privy access token in. */
export const PRIVY_HEADER = "x-privy-token";

export interface Person {
  userId: string;
  /** The person's linked Ethereum wallets, lowercase 0x addresses. */
  wallets: string[];
}

export interface PrivyVerifier {
  verify(accessToken: string): Promise<Person>;
}

/** The token is not valid for this app: answer 401. */
export class PrivySessionError extends Error {}
/** Privy could not be reached: answer 503. */
export class PrivyUnavailableError extends Error {}

export type PersonCheck =
  | { kind: "none" }
  | { kind: "person"; person: Person }
  | { kind: "refused"; status: 401 | 503; code: "bad-session" | "session-unavailable"; message: string };

/** The three calls the verifier makes; a test passes a fake. */
export interface PrivyClientLike {
  getVerificationKey(): Promise<string>;
  verifyAuthToken(token: string, verificationKey: string): Promise<{ appId: string; userId: string }>;
  getUserById(userId: string): Promise<{ linkedAccounts: Array<{ type: string; address?: string; chainType?: string }> }>;
}

export function createPrivyVerifier(
  appId: string,
  appSecret: string,
  options: { client?: PrivyClientLike; cacheMs?: number; now?: () => number } = {},
): PrivyVerifier
```

`createPrivyVerifier` behaves as follows:
1. **The client.** When `options.client` is not given, build `const real = new PrivyClient(appId, appSecret, { timeout: 5_000 })` and wrap it:
   ```ts
   {
     getVerificationKey: () => real.getVerificationKey(),
     verifyAuthToken: (token, key) => real.verifyAuthToken(token, key),
     getUserById: async (id) => (await real.getUserById(id)) as unknown as { linkedAccounts: Array<{ type: string; address?: string; chainType?: string }> },
   }
   ```
2. **Verify (amendment A1, orch-cs).** In 1.32.5, `verifyAuthToken` fetches Privy's verification key on first use. A network failure inside it would otherwise read as a bad token. So `verify(token)` does these steps in order:
   - Call `client.getVerificationKey()`. If it throws, throw `new PrivyUnavailableError("verification key unreachable")`. That answers 503. The real client caches the key after the first success, so later calls are local.
   - Call `client.verifyAuthToken(token, key)` with that key. If it throws, throw `new PrivySessionError("invalid")`. That answers 401.
   - If `claims.appId !== appId`, throw `new PrivySessionError("wrong app")`.
3. **Cache.** Keep a cache `Map<userId, { wallets, expiresAt }>`, with `now = options.now ?? Date.now` and a lifetime of `options.cacheMs ?? 60_000`. A live entry returns `{ userId, wallets }` without calling Privy.
4. **Wallets.** Otherwise call `client.getUserById(claims.userId)`. If it throws, throw `new PrivyUnavailableError("unreachable")`. `wallets` is every linked account with `type === "wallet"`, `chainType === "ethereum"` and a string `address`, lowercased. Cache it, then return `{ userId: claims.userId, wallets }`.

```ts
export async function personFrom(headers: Headers, privy: PrivyVerifier | undefined): Promise<PersonCheck>
```

1. If `privy` is `undefined`, return `{ kind: "none" }`. The header is ignored.
2. `const token = (headers.get(PRIVY_HEADER) ?? "").trim()`. If it is empty, return `{ kind: "none" }`.
3. Otherwise return `{ kind: "person", person: await privy.verify(token) }`. If `verify` throws:
   - a `PrivyUnavailableError` gives `{ kind: "refused", status: 503, code: "session-unavailable", message: "Refused. Sign-in cannot be checked right now. Nothing was charged." }`;
   - anything else gives `{ kind: "refused", status: 401, code: "bad-session", message: "Refused. Your sign-in is not valid. Sign in again." }`.

```ts
export function owns(person: Person, address: string | null | undefined): boolean
```

It returns true only when `address` is a string whose lowercase form is in `person.wallets`.

### 3. Deps

Add `privy?: PrivyVerifier` (type import from `./privy.ts`) to `HubDeps` (`apps/hub/src/app.ts`), `CallDeps` (`call.ts`), `BuyerPlumbingDeps` (`buyerplumbing.ts`) and `ReviewDeps` (`review.ts`). `createHub` already passes `deps` to each, so no other wiring is needed.

### 4. Turning it on (`apps/hub/src/index.ts`)

```ts
const privyAppId = process.env.PRIVY_APP_ID?.trim() ?? "";
const privySecret = process.env.PRIVY_APP_SECRET?.trim() ?? "";
const privy = privyAppId !== "" && privySecret !== "" ? createPrivyVerifier(privyAppId, privySecret) : undefined;
```

- Pass `...(privy ? { privy } : {})` into `createHub`'s deps.
- Log `[hub] privy sign-in: on` or `[hub] privy sign-in: off`.
- Never log the app id, the secret or any token.

### 5. The approval routes (`apps/hub/src/buyerplumbing.ts`)

`getEnvelope`, `listApprovals` and `decideApproval` call `requireToken` today. Change them as follows, and make `getEnvelope` and `listApprovals` `async`; their routes already pass the result straight back.

**At the top of each:**

```ts
const privyCheck = await personFrom(c.req.raw.headers, deps.privy);
if (privyCheck.kind === "refused") return fail(privyCheck.status, privyCheck.code, privyCheck.message);
if (privyCheck.kind === "none") {
  const refused = requireToken(c, deps);
  if (refused) return refused;
}
```

This replaces the existing `requireToken` lines.

**The ownership check, after the function has the agent and before it answers:**
- `getEnvelope`: the agent is the path's `:agent`.
- `listApprovals`: the agent is the `agent` query value.
- `decideApproval`: the agent is the approval row's `agent`. Put the check directly after the row is loaded and found. The existing 404 for an unknown approval stays first.

The check:

```ts
if (privyCheck.kind === "person") {
  const approver = deps.store.getEnvelopeMirror(agent)?.envelope.approver;
  if (!owns(privyCheck.person, approver)) {
    return fail(403, "not-your-agent", "Refused. This agent's approver key is not one of your wallets.");
  }
}
```

Nothing else changes. In particular, `decideApproval`'s check of the version 2 decision signature against the approver is unchanged and still required on both paths.

### 6. The paid call (`apps/hub/src/call.ts`)

**After the offer lookup.** Place this immediately after the block `if (!stored || stored.delistedAt !== null) { ... }`:

```ts
const privyCheck = await personFrom(headers, deps.privy);
if (privyCheck.kind === "refused") return failure(privyCheck.status, privyCheck.code, privyCheck.message);
```

If a `lineageCycle` check from packet tr-01 is already on this branch, it comes after this one.

**Before settle.** Place this immediately after the duplicate-payment check and before `const payer = verify.payer ?? "";`:

```ts
if (privyCheck.kind === "person" && !(/^0x[0-9a-fA-F]{40}$/.test(verify.payer ?? "") && owns(privyCheck.person, verify.payer))) {
  return failure(403, "not-your-wallet", "Refused. This payment is not from one of your wallets. Nothing was charged.", railId);
}
```

Use the `railId` variable the surrounding code already uses for its other refusals at that point. A call with no Privy token is unchanged.

### 7. Buyer review (`apps/hub/src/review.ts`)

In `handleReview`, directly after the 404 for an unknown job:

```ts
const privyCheck = await personFrom(c.req.raw.headers, deps.privy);
if (privyCheck.kind === "refused") return fail(privyCheck.status, privyCheck.code, privyCheck.message);
if (privyCheck.kind === "person" && !owns(privyCheck.person, job.buyer)) {
  return fail(403, "not-your-job", "Refused. This job was not bought by one of your wallets.");
}
```

The buyer's review signature check is unchanged.

## Lease

- `apps/hub/src/privy.ts` (new);
- `apps/hub/src/app.ts` (the `HubDeps` field only);
- `apps/hub/src/index.ts` (section 4 only);
- `apps/hub/src/buyerplumbing.ts` (section 5 only);
- `apps/hub/src/call.ts` (section 6 only);
- `apps/hub/src/review.ts` (section 7 only);
- `apps/hub/package.json`, and `bun.lock` for this one dependency only;
- `apps/hub/test/privy.test.ts` (new).

Read only: everything else.

## Tests (`apps/hub/test/privy.test.ts`; no network, and never the real `PrivyClient`)

**The fake verifier.** Use `createPrivyVerifier("app", "secret", { client: fakeClient })`, or a plain `PrivyVerifier` object:
- token `"alice"` returns a person whose wallets are the envelope's approver address and the buyer address used below;
- token `"bob"` returns a person with one unrelated wallet;
- token `"down"` throws `PrivyUnavailableError`;
- any other token throws `PrivySessionError`.

**The hub.** Build it the way `startTokenHub` in `apps/hub/test/buyerplumbing.test.ts` does, with `createHub(deps)` and `privy` set. Make variants without `privy` and with `humanApprovalToken`. Copy that file's `signDecision` and envelope-mirror helpers for the approval cases, and `apps/hub/test/call.test.ts`'s runner and payment setup for the call cases.

Cases:
1. **Unset.** On a hub without `privy`, a request carrying `x-privy-token: alice` gets exactly what it gets without the header. Check `GET /envelopes/:agent`, and a call that answers 402.
2. **A bad token.** `x-privy-token: nope` gets 401 `bad-session` on all six routes:
   - `GET /envelopes/:agent`;
   - `GET /approvals?agent=`;
   - `POST /approvals/:id/decision`;
   - `POST /offers/:hash/call`, with no `PAYMENT-REQUIRED` header;
   - `POST /jobs/:jobId/accept`;
   - `POST /jobs/:jobId/dispute`.
3. **Privy down.** `x-privy-token: down` gets 503 `session-unavailable` on the call route and on the envelope read.
4. **Approval reads.** On a hub with no operator token, alice reads `GET /envelopes/:agent` and `GET /approvals?agent=` with 200. Bob gets 403 `not-your-agent`.
5. **Decisions.**
   - Alice posts a correctly signed version 2 decision with no operator token, and it is accepted.
   - Alice posts a decision whose signature is wrong. It is refused exactly as today: the signature still authorises.
   - Bob gets 403 `not-your-agent`.
6. **The operator path is unchanged.** On a hub with `humanApprovalToken` and no `x-privy-token`, the existing bearer behaviour holds for one read and one decision.
7. **Calls.** With a runner online and a `FakeRail`:
   - Alice pays from her buyer wallet, and the call reaches settle (the rail's `settleCalls` grows).
   - Bob pays from a wallet he does not own and gets 403 `not-your-wallet`. `settleCalls` does not grow.
   - A call with no Privy token behaves as today.
8. **Review.**
   - Alice, who owns the job's buyer, gets past the Privy check: an accept with a bad signature gets the existing 401 `bad-signature`.
   - Bob gets 403 `not-your-job`.
9. **CORS.** `OPTIONS /approvals/x/decision` with `Origin: https://web.example`, `Access-Control-Request-Method: POST` and `Access-Control-Request-Headers: content-type, x-privy-token` succeeds. Its `access-control-allow-headers` includes `x-privy-token`.
10. **The verifier itself, with a fake client.**
    - Only `chainType` `"ethereum"` wallets are kept, lowercased.
    - A claims `appId` that differs gives `PrivySessionError`.
    - `verifyAuthToken` throwing gives `PrivySessionError`.
    - `getUserById` throwing gives `PrivyUnavailableError`.
    - `getVerificationKey` throwing gives `PrivyUnavailableError`, and `personFrom` turns it into 503 `session-unavailable`, not 401 (amendment A1).
    - `verifyAuthToken` is called with the key `getVerificationKey` returned.
    - Two verifies inside `cacheMs` call `getUserById` once.

Every existing test still passes, unedited.

## Constraints

- **No browser** of any kind on this machine. That means no headless Chrome, no Playwright, no Puppeteer and no screenshot tools.
- **No network** in tests. Never construct the real `PrivyClient` in a test.
- **Secrets.** Never read `~/.config/countersign/privy.env`. Never print, log or commit any Privy app secret or token. Tests use made-up strings.
- **Existing tests:** never edit, weaken, skip or delete one to make it pass. If one fails, fix the code, or stop and report the root cause.
- **Commits:** small, present tense, ending `refs #21`, with no emoji and no `Co-authored-by`.
- Never write the name of any earlier project.

## Acceptance

```
bun install && bun run typecheck && bun test && forge test
```

All green.

## Stop conditions

Stop if any of these happens:
- a change is needed outside the lease;
- `requireToken`, `getEnvelopeMirror`, `paidCall`, `failure`, `handleReview` or `fail` differ from what this packet names;
- `@privy-io/server-auth` 1.32.5 does not export `PrivyClient` with `getVerificationKey`, `verifyAuthToken` and `getUserById`;
- a failure survives three different fixes;
- 60 minutes have passed.

## Report

Write `/Users/thescoho/Developer/countersign-mumbai/reports/tr-03-privy-hub.md`: the diff summary, the test names, and the gate output counts.
