# cs-24-runner-bond-lock: the runner reads the job on chain before it works, and signs its own bond locks (refs #98, #93)

## Setup

Run `bun install` at the worktree root before anything else. You are on `cs/cs-24`, cut from `cs/int`.

## The design is decided (orch-cs)

Read these first:

- `docs/spec/escrow.md`, the section "Escrow v2", in particular "Who does what";
- D15 in `docs/decisions.md`;
- `apps/phone/src/runner/funding.ts`, the phone's funding check, which is the reference implementation for part 1 below.

You never touch `contracts/**` or `apps/**`.

### 1. The runner's funding check (cs-w1's should-fix on the runner)

The hub writes the order, so the order alone proves nothing: a hub could fund one atomic unit and dispatch an order that claims the full price. Before the runner starts work on an **escrow** order, it reads the job from the chain.

- **The escrow must be pinned.** `(order.chainId, order.escrow)` must be in `KNOWN_ESCROWS` from `@countersign/verify`, or in the runner's extra pins (`--known-escrow <chainId>=<address>`, repeatable).
- **The job on chain** (`jobOf(order.jobId)`) must hold all of these:
  - its status is Funded (1);
  - its payee is the offer's payee for that rail, `offer.payTo?.[order.rail] ?? offer.seller`, compared case-insensitively;
  - its amount is at least `offer.price`;
  - its offerHash equals `order.offerHash`;
  - its deadline is still ahead.
- **First, a cheap check of the order's own terms against the offer:** the rail is in `offer.rails`, `order.amount === offer.price`, and `order.payTo` equals that payee.
- **A job not seen yet** (status None, or a failed read) is read again up to 4 more times, 750 ms apart, because the hub's node can be a block ahead of the runner's RPC.
- **Refusals** use the phone's sentences, with "this runner" for "this phone". The runner sends them as `fail` and does no work.
- **Non-escrow orders** (gateway, hedera, mpp, eip3009) pass through the terms check only. Those rails settle before dispatch.
- **RPC per chain:**
  - `--rpc <chainId>=<url>` (repeatable);
  - else `ARC_RPC_URL` for 5042002, default `https://rpc.testnet.arc.network`;
  - else `WC_RPC_URL` for 1874.
  - A chain with no RPC refuses with the "could not read the job on chain" sentence.
- **Defaults.** The runner CLI turns the check on by default. `startRunner` without a `funding` config does not check, so library callers and existing tests keep today's behaviour.

### 2. The bond lock (audit C1)

On escrow v2, a bond moves only with the payee's EIP-712 signature:

```
LockBond(bytes32 jobId,uint256 bond,uint64 reviewWindow)
```

It is signed under the escrow's domain `{name: "Countersign", version: "1", chainId, verifyingContract: escrow}`, the same domain as `acceptTypedData`.

- **Wire** (`packages/core/src/wire.ts`):
  - `HubToRunner` gains `{ t: "lock"; order: JobOrder; salt: string; bond: string; reviewWindow: number }`.
  - `RunnerToHub` gains `{ t: "locked"; jobId: Hex; sig: Hex }` and `{ t: "lock-refused"; jobId: Hex; reason: string }`.
- **Typed data** (`packages/core/src/countersign.ts`): `LOCK_BOND_TYPES` and `lockBondTypedData(chainId, escrow, jobId, bond, reviewWindow)`, beside `acceptTypedData`.
- **The runner signs** only when every check holds:
  - the order's `offerHash` is an offer it serves;
  - `bond === offer.bond` as an atomic string, and `0 < bond <= order.amount`;
  - `reviewWindow === (offer.reviewWindow ?? 0)`;
  - `order.amount === offer.price`, and `order.payTo` is the offer's escrow payee;
  - the escrow is pinned, as in part 1;
  - `order.deadline` is in the future and no more than `maxDeadlineSeconds` ahead (default 3600, flag `--max-deadline`);
  - its free bond `bondOf(payee)` on that escrow covers `bond`, read over the same RPC;
  - `order.jobId` equals `jobIdOf({offerHash, buyer, payee: order.payTo, amount, deadline, salt}, chainId, escrow)` re-derived by the runner. Use core's `jobIdOf`, and reuse its terms type.
- **Answers.** It answers `locked` with the signature, or `lock-refused` with one plain sentence naming the first failing check. It never signs on a failed or unreadable check.
- **The record.** It keeps an in-memory record `{jobId, deadline}` of every lock it signed, for the watchdog that comes later. The record is not built here, and the report says so.

The hub side of the handshake (send `lock`, await `locked`, put the signature in `requirements.extra.lockSig`) is the next packet. It waits for cs-23, which owns `apps/hub/src/call.ts`.

## Lease

You may create or change only:

- `packages/core/src/wire.ts` and `packages/core/src/countersign.ts`;
- `packages/core/test/lock-bond.test.ts` (new);
- `packages/runner/src/{daemon.ts,cli.ts,index.ts,funding.ts,lock.ts}`, where `funding.ts` and `lock.ts` are new;
- `packages/runner/test/{funding.test.ts,lock.test.ts}` (new), plus existing runner tests only where the CLI's new default needs a pin or an RPC flag;
- `packages/runner/package.json`: add `"@countersign/verify": "workspace:*"`, and the one matching `bun.lock` workspace line;
- `docs/spec/runner.md`, if it exists: a short "Funding check" and "Bond lock" note;
- `.packets/reports/cs-24-runner-bond-lock.md`.

## Tests

No network. Use an injected `JobReader`, a `bondOf` reader and a clock. Sign with fixed test keys.

1. **Funding:**
   - a pinned escrow with a Funded job for this payee, offer, price and live deadline passes;
   - each of these refuses with its sentence: unpinned escrow, status None after the retries, payee mismatch, amount short, other offer, deadline passed, unreadable;
   - None, then Funded on the third read, passes;
   - a gateway order skips the chain read;
   - the daemon sends `fail` and never spawns the child on a refusal.
2. **Lock:**
   - a valid request answers `locked`, and its signature recovers to the seller over `lockBondTypedData`;
   - each mismatch answers `lock-refused` and signs nothing: bond, bond above amount, window, amount, payee, unpinned escrow, deadline too far, deadline past, short free bond, wrong `jobId`.
3. **Core:** `lockBondTypedData` has the domain and types the spec names. Add a fixed vector: a test key's signature over one `(jobId, bond, window)`.
4. **The CLI:** with no flags it enables the check with `KNOWN_ESCROWS` and the Arc default RPC. `--known-escrow` and `--rpc` add to it.
5. Every existing runner, core and buyer test passes.

## Constraints

- **Never launch a browser of any kind on this machine:** no Chrome or Chromium, headless or not, no Playwright, Puppeteer or screenshot tools. UI checks go back to the lane, which raises NEEDS-BROWSER.
- Never touch `contracts/**` or `apps/**`. Never deploy, never call a faucet, never use a public RPC in tests.
- No view code. TypeScript strict, no `any`.

## Acceptance

From the worktree root:

```
bun install && bun run typecheck && bun test packages/core packages/runner && bun test && forge test
```

Every command passes.

## Stop conditions

- You need to edit outside the lease: stop and write the report.
- One problem has blocked you for more than 15 minutes: stop, commit what passes, and write the report.

## Finish

Commit with small present-tense messages ending `(refs #98)`, and no trailers. Write `.packets/reports/cs-24-runner-bond-lock.md`. Do not push, merge or deploy.
