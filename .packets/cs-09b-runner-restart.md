# cs-09b-runner-restart — corrective: a restarted runner serves the offer it published (refs #65)

## Setup

Run `bun install` at the worktree root before anything else.

## The bug (issue #65, found by the e2e suite)

`packages/runner/src/publish.ts` `publishOffer` reuses the `issuedAt` stored for an offer's inputs, publishes that **stable** offer, and returns only its hash. But `packages/runner/src/cli.ts` `serveCommand` pushes the **fresh** offer it built (with `issuedAt = now`) into `served`. After a restart with a used state directory, the runner's `hello` therefore claims a hash the hub never stored, and the offer shows `online: false`.

## Lease

You may create or change only these paths:

- `packages/runner/src/publish.ts` and `packages/runner/src/cli.ts`
- `packages/runner/test/publish.test.ts`, and a new `packages/runner/test/restart.test.ts`
- `.packets/reports/cs-09b-runner-restart.md`

## What to change

1. `publishOffer` returns `{offerHash, offer}`, where `offer` is the exact object it published (the stable one). Update every caller: `publishCommand` prints `offerHash`.
2. `serveCommand` pushes the returned stable `offer` into `served`, never the freshly built one.
3. Keep `publishOffer`'s existing behaviour otherwise: the same state file and key, and the same HTTP call.

## Tests

- `restart.test.ts`: against a fake hub (`Bun.serve`) that stores offers and implements the runner WebSocket `challenge` → `hello` → `ready` handshake from `packages/runner/test/daemon.test.ts`, using a temp state dir.
  1. Run serve's publish-and-start path once.
  2. Stop it.
  3. Run it again with the same state dir.
  4. Both runs claim the **same** offer hash in `hello`, and that hash is the one the hub stored, so the hub would mark it online.
  5. Factor `serveCommand`'s body into an exported `prepareServed(options, account)` that returns `{served, hashes}`, so the test needs no subprocess.
- `publish.test.ts`: the returned `offer` hashes to the returned `offerHash`, and a second publish with identical inputs returns an equal offer.

## Constraints

- **Never launch a browser of any kind on this machine**: no Chrome or Chromium, headless or not, no Playwright, Puppeteer or screenshot tools. UI checks go back to the lane, which raises NEEDS-BROWSER.
- No view code. No network beyond localhost. Use only fixed anvil test keys. TypeScript strict, no `any`.

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

Commit with small present-tense messages ending `(refs #65)`, and no trailers. Write `.packets/reports/cs-09b-runner-restart.md`. Do not push, merge or deploy.
