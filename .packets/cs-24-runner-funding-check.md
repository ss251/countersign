# cs-24-runner-funding-check: the runner reads the job on chain before it works (refs #98, #93)

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

### Not in this packet

The payee's bond-lock signature is cancelled (STEER-1940: bond and review window come from the seller-signed offer into the countersigned terms). Add no wire messages and no typed data, and leave `packages/core` alone.

## Lease

You may create or change only:

- `packages/runner/src/{daemon.ts,cli.ts,index.ts,funding.ts}`, where `funding.ts` is new;
- `packages/runner/test/funding.test.ts` (new), plus existing runner tests only where the CLI's new default needs a pin or an RPC flag;
- `packages/runner/package.json`: add `"@countersign/verify": "workspace:*"`, and the one matching `bun.lock` workspace line;
- `docs/spec/runner.md`, if it exists: a short "Funding check" note;
- `.packets/reports/cs-24-runner-funding-check.md`.

## Tests

No network. Use an injected `JobReader`, a `bondOf` reader and a clock. Sign with fixed test keys.

1. **Funding:**
   - a pinned escrow with a Funded job for this payee, offer, price and live deadline passes;
   - each of these refuses with its sentence: unpinned escrow, status None after the retries, payee mismatch, amount short, other offer, deadline passed, unreadable;
   - None, then Funded on the third read, passes;
   - a gateway order skips the chain read;
   - the daemon sends `fail` and never spawns the child on a refusal.
2. **The CLI:** with no flags it enables the check with `KNOWN_ESCROWS` and the Arc default RPC. `--known-escrow` and `--rpc` add to it.
3. Every existing runner, core and buyer test passes.

## Constraints

- **Never launch a browser of any kind on this machine:** no Chrome or Chromium, headless or not, no Playwright, Puppeteer or screenshot tools. UI checks go back to the lane, which raises NEEDS-BROWSER.
- Never touch `contracts/**`, `apps/**` or `packages/core`. Never deploy, never call a faucet, never use a public RPC in tests.
- No view code. TypeScript strict, no `any`.

## Acceptance

From the worktree root:

```
bun install && bun run typecheck && bun test packages/runner && bun test && forge test
```

Every command passes.

## Stop conditions

- You need to edit outside the lease: stop and write the report.
- One problem has blocked you for more than 15 minutes: stop, commit what passes, and write the report.

## Finish

Commit with small present-tense messages ending `(refs #98)`, and no trailers. Write `.packets/reports/cs-24-runner-funding-check.md`. Do not push, merge or deploy.
