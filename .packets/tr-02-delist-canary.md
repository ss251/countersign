# tr-02: a seller delists its own offer, and a canary delists offers whose runner stops answering (refs #26)

**Design: decided.** cs-truth wrote this on Opus from the project lead's acceptance (STEER-2050) and `docs/decisions.md` D18, which is already committed on this branch. Implement exactly what follows. Nothing here is left for you to choose.

## Goal

There is a delist route. A canary call to each live offer delists an offer that fails it, and a delisted offer is not served or sold.

## Decisions

### 1. `packages/core/src/wire.ts`

- Next to `publishMessage`, add:
  ```ts
  /** The text a seller signs with EIP-191 to delist an offer (D18). */
  export function delistMessage(offerHash: Hex): string { return `countersign delist ${offerHash}`; }
  /** The text a runner signs with the seller's key to answer a canary (D18). */
  export function canaryMessage(offerHash: Hex, nonce: string): string { return `countersign canary ${offerHash} ${nonce}`; }
  ```
- Add `| { t: "canary"; offerHash: Hex; nonce: string }` to `HubToRunner`.
- Add `| { t: "canary"; offerHash: Hex; nonce: string; sig: Hex } | { t: "canary-fail"; offerHash: Hex; nonce: string; reason: string }` to `RunnerToHub`.
- Add the line `hub: canary -> runner: canary | canary-fail` to the protocol comment at the top of the file.

`packages/core/src/index.ts` already re-exports `wire.ts`, so the new names need no other export.

### 2. The delist route (`apps/hub/src/app.ts`)

Add it directly after `app.post("/offers", ...)`, parsing the body and recovering the signer the same way that route does:

```
app.post("/offers/:offerHash/delist", ...)
```

1. Read the JSON body. If it does not parse, is not a record, or `sig` is not a string: `fail(400, "bad-request", "Refused. The delist request is malformed.")`.
2. `const stored = deps.store.getOffer(c.req.param("offerHash"))`. If it is `null`: `fail(404, "unknown-offer", "Refused. That offer is not listed.")`.
3. Recover the signer of `delistMessage(stored.offerHash)` from `sig` with `recoverMessageAddress`. If it throws, or the signer is not `stored.seller` (compare lowercase): `fail(401, "bad-signature", "Refused. The delist signature is not the seller's.")`.
4. If `stored.delistedAt === null`, call `deps.store.delistOffer(stored.offerHash, deps.now())`.
5. Answer `json({ offerHash: stored.offerHash, status: "delisted" }, 200)`, including when it was already delisted.

### 3. `RunnerLink` (`apps/hub/src/runners.ts`)

- `export type CanaryResult = { ok: true } | { ok: false; reason: string };`
- `Connection` gains `canaries: Map<string, { offerHash: string; finish: (result: CanaryResult) => void }>`, keyed by nonce. Initialise it as an empty map wherever a `Connection` is created.
- Add a public method:
  ```ts
  async canary(offerHash: string, timeoutMs: number): Promise<CanaryResult>
  ```
  1. `const conn = this.find(offerHash)`. If it is `null`, return `{ ok: false, reason: "offline" }`.
  2. `nonce` is `0x` plus 16 random bytes as hex, from `crypto.getRandomValues`.
  3. Register `{ offerHash, finish }` under the nonce. `finish` resolves once, clears its timer, and deletes the entry.
  4. Start a timer that finishes `{ ok: false, reason: "timeout" }` after `timeoutMs`.
  5. Send `{ t: "canary", offerHash, nonce }`. If sending throws, finish `{ ok: false, reason: "closed" }`.
- In `message()`, beside the existing `result` and `fail` branches:
  - **`t === "canary"`.** Find the entry by `frame.nonce` on this connection; ignore the frame if there is none. If `frame.offerHash` is not the entry's `offerHash` (compare lowercase), finish `{ ok: false, reason: "wrong-offer" }`. Otherwise recover the signer of `canaryMessage(entry.offerHash, nonce)` from `frame.sig`. If it is `this.store.getOffer(entry.offerHash)?.seller` (compare lowercase), finish `{ ok: true }`. Otherwise, or if recovery throws, finish `{ ok: false, reason: "bad-signature" }`.
  - **`t === "canary-fail"`.** Find the entry by nonce, and finish `{ ok: false, reason: typeof frame.reason === "string" ? frame.reason : "refused" }`.
- Wherever a connection's pending jobs are finished with `closed` or `pong-timeout`, also finish each of its pending canaries with the same reason.

### 4. The canary run (new `apps/hub/src/canary.ts`)

```ts
export interface CanaryOptions { attempts: number; gapMs: number; timeoutMs: number }
export const CANARY_DEFAULTS: CanaryOptions = { attempts: 3, gapMs: 5_000, timeoutMs: 10_000 };
export interface CanaryDeps { store: Store; runners: RunnerLink; now: () => number; log?: (line: string) => void }
export async function runCanary(deps: CanaryDeps, options: CanaryOptions = CANARY_DEFAULTS): Promise<{ checked: Hex[]; delisted: Hex[] }>
```

1. Go through `deps.store.listOffers()` one offer at a time. Listed offers only: that function already leaves delisted ones out.
2. Skip any offer for which `deps.runners.isOnline(offerHash)` is false. Offline offers are neither checked nor delisted.
3. Otherwise add the offer to `checked`, then make up to `options.attempts` attempts with `deps.runners.canary(offerHash, options.timeoutMs)`:
   - `{ ok: true }` passes it. Stop.
   - `reason === "offline"` means the runner left mid-round. Stop without delisting.
   - Any other failure: if attempts remain, wait `options.gapMs` and try again.
4. If every attempt failed, call `deps.store.delistOffer(offerHash, deps.now())`, add the offer to `delisted`, and log `[canary] delisted ${offerHash}: ${lastReason}` through `deps.log` when given.

### 5. Turning it on (`apps/hub/src/index.ts`)

- Change `const { app, websocket } = createHub({` to also take `runners`.
- Beside the janitor's `setInterval`:
  ```ts
  if (process.env.CANARY === "1") {
    const everyMs = Number(process.env.CANARY_INTERVAL_S ?? 300) * 1000;
    let running = false;
    setInterval(() => {
      if (running) return;
      running = true;
      void runCanary({ store, runners, now, log: (line) => console.log(line) }).finally(() => { running = false; });
    }, everyMs);
  }
  ```

It is off by default. Do not turn it on anywhere.

### 6. The seller's runner (`packages/runner/src/daemon.ts`)

In `handleMessage`'s `switch`, add:

```ts
case "canary": {
  const entry = served.find((item) => item.hash.toLowerCase() === message.offerHash.toLowerCase());
  if (!entry) {
    send(target, { t: "canary-fail", offerHash: message.offerHash, nonce: message.nonce, reason: "not-served" });
    return;
  }
  const sig = await cfg.account.signMessage({ message: canaryMessage(entry.hash, message.nonce) });
  send(target, { t: "canary", offerHash: entry.hash, nonce: message.nonce, sig });
  return;
}
```

### 7. The test runner (`apps/hub/test/runner-client.ts`)

`RunnerOptions` gains `canary?: "answer" | "ignore" | "wrong-key" | "refuse"`, default `"answer"`. On a `canary` frame:

- **`"answer"`:** reply as in section 6, signing with `options.account`, when the offer is in `options.offers`, else `canary-fail` `"not-served"`.
- **`"ignore"`:** send nothing.
- **`"wrong-key"`:** sign the same message with a different account made by `privateKeyToAccount(generatePrivateKey())`.
- **`"refuse"`:** send `canary-fail` with reason `"not-served"`.

## Lease

- `packages/core/src/wire.ts`;
- `apps/hub/src/app.ts` (the delist route only), `apps/hub/src/runners.ts`, `apps/hub/src/canary.ts` (new), `apps/hub/src/index.ts` (the two changes in section 5 only);
- `packages/runner/src/daemon.ts` (the `canary` case only);
- `apps/hub/test/runner-client.ts` (the `canary` option only);
- new tests: `apps/hub/test/delist.test.ts`, `apps/hub/test/canary.test.ts`, `packages/runner/test/canary.test.ts`.

Read only: everything else, including `apps/phone`. Never commit `bun.lock`.

## Tests (no network)

Use `apps/hub/test/support.ts` and `runner-client.ts`, as `apps/hub/test/call.test.ts` and `discovery.test.ts` do. Call `runCanary` directly with `{ attempts: 3, gapMs: 10, timeoutMs: 200 }`.

**`apps/hub/test/delist.test.ts`**
1. **The seller delists.** The seller's signed delist answers 200 `{status: "delisted"}`, and `GET /offers/:hash` then shows `status: "delisted"`.
2. **Not served or sold.** After a delist, with a runner online for that offer:
   - absent from `GET /offers`, from `GET /offers/search` (search by its title), from `GET /discovery/resources`, from the agent card's skills and from `/.well-known/skills/index.json`;
   - `/openapi.json` has no call path for it;
   - `POST /offers/:hash/call` answers 404 `unknown-offer` with no `PAYMENT-REQUIRED` header.
3. **Wrong signer.** A delist signed by `other` answers 401, and the offer stays listed and callable (402 with a runner online).
4. **Bad requests.** An unknown hash answers 404. A body with no `sig` answers 400.
5. **Idempotent.** A second delist answers 200.
6. **Republishing.** Publishing the same offer again after the delist leaves it delisted.

**`apps/hub/test/canary.test.ts`**
1. **Healthy runner.** A runner with `canary: "answer"` keeps its offer listed, and `runCanary` returns it in `checked` and not in `delisted`.
2. **Silent runner.** With `canary: "ignore"` the offer is delisted. `/offers` then leaves it out, and a call answers 404.
3. **Wrong key.** With `canary: "wrong-key"` the offer is delisted.
4. **Refusal.** With `canary: "refuse"` the offer is delisted.
5. **Offline.** An offer with no runner online is neither checked nor delisted.
6. **Mixed.** With two offers on two runners, one `"answer"` and one `"ignore"`, only the second is delisted.

**`packages/runner/test/canary.test.ts`.** Model it on `packages/runner/test/daemon.test.ts`, which runs the daemon against a fake hub on `Bun.serve`:
1. A `canary` frame for a served offer gets a `canary` reply whose signature recovers to the seller over `canaryMessage(hash, nonce)`.
2. A `canary` frame for any other hash gets `canary-fail` with reason `"not-served"`.

Every existing test still passes, unedited.

## Constraints

- **No browser** of any kind on this machine. That means no headless Chrome, no Playwright, no Puppeteer and no screenshot tools.
- **No network** in tests.
- **Existing tests:** never edit, weaken, skip or delete one to make it pass. If one fails, fix the code, or stop and report the root cause.
- **Commits:** small, present tense, ending `refs #26`, with no emoji and no `Co-authored-by`.

## Acceptance

```
bun install && bun run typecheck && bun test && forge test
```

All green.

## Stop conditions

Stop if any of these happens:
- a change is needed outside the lease;
- `publishMessage`, `HubToRunner`, `RunnerToHub`, `RunnerLink.find`, `Store.delistOffer` or `Store.listOffers` differ from what this packet names;
- a failure survives three different fixes;
- 60 minutes have passed.

## Report

Write `$M/reports/tr-02-delist-canary.md`: the diff summary, the test names, and the gate output counts.
