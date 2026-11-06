# tr-13a: the hub signs for the CLI through Privy server wallets: device login, sessions, and /cli/sign (refs #246)

**Design: decided.** cs-truth wrote this on Opus for STEER-0245, using Privy's documented REST API: `POST /v1/wallets` and `POST /v1/wallets/{id}/rpc` with `eth_signTypedData_v4` and `personal_sign`. Implement exactly what follows. Nothing here is left for you to choose. **This is a secrets surface:**
- no session token, device secret, signature, typed-data payload or Privy secret is ever logged;
- tokens and secrets are stored only as their SHA-256.

## Files

### 1. `apps/hub/src/wallets/privy-wallets.ts` (new)

```ts
export interface TypedDataInput {
  domain: Record<string, unknown>;
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  message: Record<string, unknown>;
}

export interface WalletApi {
  createWallet(externalId: string): Promise<{ id: string; address: string }>;
  signTypedData(walletId: string, typed: TypedDataInput): Promise<string>;
  personalSign(walletId: string, message: string): Promise<string>;
}

export class WalletApiError extends Error {
  constructor(readonly status: number) {
    super(`Privy answered ${status}.`);
  }
}

/** Privy server wallets, app-controlled (no owner), so the hub needs no per-user authorization key. */
export function privyWalletApi(
  appId: string,
  appSecret: string,
  options: { policyId?: string; fetchImpl?: typeof fetch; base?: string } = {},
): WalletApi {
  const base = options.base ?? "https://api.privy.io";
  const doFetch = options.fetchImpl ?? fetch;
  const headers = {
    authorization: `Basic ${Buffer.from(`${appId}:${appSecret}`).toString("base64")}`,
    "privy-app-id": appId,
    "content-type": "application/json",
  };
  async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
    const response = await doFetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
    if (!response.ok) throw new WalletApiError(response.status);
    return (await response.json()) as Record<string, unknown>;
  }
  return {
    async createWallet(externalId) {
      const body: Record<string, unknown> = { chain_type: "ethereum", external_id: externalId, idempotency_key: externalId };
      if (options.policyId) body.policy_ids = [options.policyId];
      const out = await post("/v1/wallets", body);
      if (typeof out.id !== "string" || typeof out.address !== "string") throw new WalletApiError(502);
      return { id: out.id, address: out.address.toLowerCase() };
    },
    async signTypedData(walletId, typed) {
      const out = await post(`/v1/wallets/${encodeURIComponent(walletId)}/rpc`, {
        method: "eth_signTypedData_v4",
        params: { typed_data: { domain: typed.domain, types: typed.types, message: typed.message, primary_type: typed.primaryType } },
      });
      const signature = (out.data as Record<string, unknown> | undefined)?.signature;
      if (typeof signature !== "string") throw new WalletApiError(502);
      return signature;
    },
    async personalSign(walletId, message) {
      const out = await post(`/v1/wallets/${encodeURIComponent(walletId)}/rpc`, {
        method: "personal_sign",
        params: { message, encoding: "utf-8" },
      });
      const signature = (out.data as Record<string, unknown> | undefined)?.signature;
      if (typeof signature !== "string") throw new WalletApiError(502);
      return signature;
    },
  };
}
```

### 2. `apps/hub/src/cli-auth/store.ts` (new)

A class `CliAuthStore` over its own `bun:sqlite` `Database(path)`. In the constructor:

```sql
CREATE TABLE IF NOT EXISTS cli_wallets (user_id TEXT PRIMARY KEY, wallet_id TEXT NOT NULL, address TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS cli_logins (code TEXT PRIMARY KEY, device_hash TEXT NOT NULL UNIQUE, user_id TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, consumed INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS cli_sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, wallet_id TEXT NOT NULL, address TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER);
```

Methods, each a plain prepared query:
- `getWallet(userId)` and `putWallet(userId, walletId, address, at)`;
- `putLogin(code, deviceHash, at, expiresAt)`;
- `getLoginByCode(code)` and `getLoginByDevice(deviceHash)`;
- `approveLogin(code, userId)` sets `user_id`;
- `consumeLogin(code)` sets `consumed = 1`;
- `putSession({ tokenHash, userId, walletId, address, createdAt, expiresAt })`;
- `getSession(tokenHash)`;
- `revokeSession(tokenHash, at)`.

Rows map to camelCase records.

### 3. `apps/hub/src/cli-auth/policy.ts` (new): what `/cli/sign` will sign

```ts
import type { TypedDataInput } from "../wallets/privy-wallets.ts";

export interface KnownEscrow { chainId: number; escrow: string }
export interface SignContext {
  address: string;               // the session's wallet, lowercase
  escrows: KnownEscrow[];        // escrows this hub runs, lowercase
  maxValue: bigint;              // the cap for one buyer authorization
}

const TOKENS: Array<{ chainId: number; token: string }> = [
  { chainId: 5042002, token: "0x3600000000000000000000000000000000000000" },
  { chainId: 1874, token: "0xcedfb56113143d55b2358b8cfbb0deb5ad2f55a7" },
];
export const HARD_CAP = 1_000_000n; // 1 USDC or USDT per signature tonight
const MESSAGES = /^countersign (runner|offer|delist|canary) [0-9A-Za-z: x-]{1,200}$/;

export type Verdict = { ok: true } | { ok: false; reason: string };

export function checkTypedData(typed: TypedDataInput, ctx: SignContext): Verdict {
  const chainId = Number(typed.domain.chainId);
  const contract = String(typed.domain.verifyingContract ?? "").toLowerCase();
  if (typed.primaryType === "ReceiveWithAuthorization") {
    if (!TOKENS.some((t) => t.chainId === chainId && t.token === contract)) return { ok: false, reason: "token" };
    const from = String(typed.message.from ?? "").toLowerCase();
    const to = String(typed.message.to ?? "").toLowerCase();
    if (from !== ctx.address) return { ok: false, reason: "from" };
    if (!ctx.escrows.some((e) => e.chainId === chainId && e.escrow === to)) return { ok: false, reason: "escrow" };
    let value: bigint;
    try { value = BigInt(String(typed.message.value)); } catch { return { ok: false, reason: "value" }; }
    if (value <= 0n || value > ctx.maxValue || value > HARD_CAP) return { ok: false, reason: "value" };
    return { ok: true };
  }
  if (typed.primaryType === "Release") {
    if (!ctx.escrows.some((e) => e.chainId === chainId && e.escrow === contract)) return { ok: false, reason: "escrow" };
    const keys = Object.keys(typed.message).sort().join(",");
    if (keys !== "jobId,slipHash") return { ok: false, reason: "shape" };
    return { ok: true };
  }
  return { ok: false, reason: "type" };
}

export function checkMessage(message: string): Verdict {
  return MESSAGES.test(message) ? { ok: true } : { ok: false, reason: "message" };
}
```

### 4. `apps/hub/src/cli-auth/routes.ts` (new)

```ts
export interface CliAuthDeps {
  store: CliAuthStore;
  wallets: WalletApi;
  privy?: PrivyVerifier;              // from ./privy.ts, the same verifier the hub uses
  hubStore: Store;                    // for the envelope
  escrows: () => KnownEscrow[];
  consoleUrl: string;                 // https://web-production-a58de.up.railway.app
  now: () => number;                  // unix seconds
}
export function registerCliAuth(app: Hono, deps: CliAuthDeps): void
```

Behaviour, using the hub's JSON `fail(status, code, message)` shape (`{code, message}`), with a body cap of 64 KiB:

- **`POST /cli/login/start`** (no auth). `code` is 8 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, formatted `XXXX-XXXX`. `deviceSecret` is `csd_` plus 32 random bytes in hex. Store `sha256(deviceSecret)`, with `expiresAt = now + 600`. Answer 200 `{ code, deviceSecret, verifyUrl: \`${consoleUrl}/#/cli-login?code=${code}\`, interval: 3, expiresAt }`.
- **`POST /cli/login/approve`** with `{code}`.
  - `personFrom(headers, deps.privy)`: `refused` gives its status; `none` gives 401 `sign-in-required`.
  - Unknown, expired or consumed code: 404 `unknown-code`.
  - Otherwise get or create the person's wallet. The `externalId` is `cs_` plus the first 40 hex digits of `sha256(userId)`. On `WalletApiError`, answer 502 `privy-failed`, and log nothing of the error body.
  - Then `approveLogin`, and answer 200 `{ code, address }`.
- **`POST /cli/login/poll`** with `{deviceSecret}`.
  - Find the login by `sha256(deviceSecret)`. Unknown: 404 `unknown-device`. Expired: 410 `expired`. Not yet approved: 200 `{ status: "pending" }`. Consumed: 410 `used`.
  - Approved: `consumeLogin`. Then `token = "css_"` plus 32 random bytes in hex, stored as `sha256(token)` with `expiresAt = now + 604800` (7 days).
  - Answer 200 `{ status: "approved", sessionToken: token, address, expiresAt }`.
- **`GET /cli/session`** with `Authorization: Bearer <token>`: 200 `{ address, expiresAt }`. A missing, unknown, expired or revoked session: 401 `not-signed-in`, message `Not signed in. Run: npx -y @countersign-hub/cli login`.
- **`POST /cli/logout`**, Bearer: `revokeSession`, then 200 `{ revoked: true }`. Without a valid session: 401 as above.
- **`POST /cli/sign`**, Bearer. The body is `{kind: "typed-data", typedData}` or `{kind: "message", message}`.
  - An invalid session: 401.
  - Typed data: `maxValue` comes from the envelope `hubStore.getEnvelopeMirror(address)`:
    - revoked, or `expiresAt` in the past: 403 `envelope-closed`;
    - present: `BigInt(envelope.perMerchant)`;
    - absent: `HARD_CAP`.
    - Then `checkTypedData`. A `{ok:false}` verdict: 403 `not-allowed`, with the reason, and Privy is never called.
  - Message: `checkMessage`. Refused: 403 `not-allowed`.
  - Then call Privy (`signTypedData` or `personalSign`) on the session's wallet. Answer 200 `{ signature, address }`. A Privy failure: 502 `privy-failed`.
  - Anything malformed: 400.

### 5. Registration (`apps/hub/src/app.ts` and `apps/hub/src/index.ts`)

- **`HubDeps`** gains `cliAuth?: Omit<CliAuthDeps, "privy" | "hubStore" | "now" | "escrows">`.
- **`createHub`**: when `deps.cliAuth` is set, call `registerCliAuth(app, { ...deps.cliAuth, privy: deps.privy, hubStore: deps.store, now: deps.now, escrows: () => <this hub's escrow rails> })`.
  - The escrows are every `deps.rails` declaration with `kind === "escrow"` and an `escrow` address.
  - `chainId` is `Number(network.split(":")[1])` for `eip155:` networks, and Hedera rails are skipped.
  - Lowercase each address.
- **`index.ts`**: when `PRIVY_APP_ID` and `PRIVY_APP_SECRET` are both set, build `cliAuth`:
  - `store: new CliAuthStore(process.env.HUB_CLI_DB ?? ":memory:")`;
  - `wallets: privyWalletApi(id, secret, { policyId: process.env.PRIVY_WALLET_POLICY_ID })`;
  - `consoleUrl: process.env.CONSOLE_URL ?? "https://web-production-a58de.up.railway.app"`.
  - When they are not set, nothing is registered.

## Lease

- new: `apps/hub/src/wallets/**`, `apps/hub/src/cli-auth/**`, `apps/hub/test/cli-auth.test.ts`;
- `apps/hub/src/app.ts` and `apps/hub/src/index.ts`: the registration in section 5 only.

Read only: everything else. Never commit `bun.lock`.

## Tests (`apps/hub/test/cli-auth.test.ts`, no network)

- **Privy is mocked.** Use a fake `WalletApi` that creates wallets with the test key `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d`, whose address comes from viem. It signs with viem's `signTypedData` and `signMessage` on that key, and records its calls.
- **Persons are mocked.** Use a fake `PrivyVerifier`: "alice" is `{userId:"did:privy:alice", wallets:[]}`.
- **The hub** is started as `privy.test.ts` does, plus `cliAuth`. Its rails are `FakeRail("escrow")`, whose declaration gives the escrow address and network.

1. **Device flow.**
   - `start` returns a code matching `^[A-Z2-9]{4}-[A-Z2-9]{4}$` and a `csd_` secret.
   - `poll` answers pending.
   - `approve` without a Privy header gives 401. With "alice" it gives 200 and the address.
   - `poll` then gives a `css_` token, the address, and `expiresAt = now + 604800`. A second `poll` gives 410 `used`.
2. **Sessions.**
   - `GET /cli/session` with the token gives 200.
   - After `logout`, it gives 401 `not-signed-in`, with the exact `Not signed in. Run: npx -y @countersign-hub/cli login`.
   - An expired session, after `setNow(+604801)`, gives 401.
3. **Sign: buyer.**
   - A `ReceiveWithAuthorization` on USDC 5042002, `from` = the session address, `to` = the rail's escrow, value 10000, gives 200. The signature recovers, with viem's `recoverTypedDataAddress`, to the session address.
   - Each of these gives 403 `not-allowed`, and the fake was not called: an unknown `primaryType`, a wrong token contract, a wrong chain, `to` = a non-escrow, `from` = another address, and value 2000000 (over the cap).
   - With an envelope whose `perMerchant` is "5000", value 10000 also gives 403.
4. **Sign: seller.**
   - `Release` on the escrow domain gives 200.
   - `personal_sign` of `countersign runner abc123` gives 200, and its signature recovers to the address.
   - `personal_sign` of `hello` gives 403.
5. **Redaction.** Spy on `console.log` and `console.error` during cases 1 to 4. No captured line contains the session token, the device secret, or any signature.

Every existing test still passes unedited.

## Constraints

- **No browser** of any kind.
- **No network** in tests.
- **Never log a token, secret or signature.**
- **Never run `git stash`.**
- **Existing tests:** never edit, weaken, skip or delete one.
- **Commits:** small, present tense, ending `refs #246`, with no emoji and no `Co-authored-by`.

## Acceptance

```
bun install --linker hoisted && bun run typecheck && bun test && forge test
```

All green.

## Stop conditions

Stop if any of these happens:
- a change is needed outside the lease;
- a failure survives three different fixes;
- 40 minutes have passed.

## Report

Write `~/Developer/countersign-mac/reports/tr-13a-cli-auth-hub.md` (on the second machine): the diff summary, the test names and the gate counts. Write no secret in it.
