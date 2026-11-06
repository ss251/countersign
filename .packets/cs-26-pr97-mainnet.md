# cs-26-pr97-mainnet: PR #97 goes green: every rail switch in the guard, and the ERC-8004 anvil tests' real cause (refs #29)

## Setup

Run `bun install` at the worktree root before anything else.

You are on `cs/97-mainnet`. It is Rajdeep's `raj/29-mainnet-fails-closed` (aa8ef17, PR #97: a mainnet hub refuses to boot while anything it would use is pending) with `cs/int` merged in (6b196c2). cs-w1 cleared aa8ef17 with 0 blockers.

## Hard rule from the captain (STEER-2050)

**Never rewrite, weaken, skip, or delete a test to make it pass.**

- Fix the code.
- If you find that a test asserts something genuinely wrong, stop and write the evidence in the report. Do not edit the test.

This holds for every file under `test/`, except the one test that step (a) adds.

## Step (a): the guard knows every rail switch

`apps/hub/test/network.test.ts`, "the guard knows every rail switch railsFromEnv reads", fails on this branch. `apps/hub/src/rails.ts` reads two variables that neither the guard's switch list nor its config list names:

- **`HEDERA_SCHEDULED_RAIL`** (#157, the held Hedera rail). It is a rail switch: `'1'` turns on the rail `'hedera-scheduled'`.
  - Add it to `RAIL_SWITCHES` exactly like `HEDERA_RAIL`: testnet only, with no mainnet entry in `MAINNET` (the type must force that, as it does for the others), and no secrets.
  - The mainnet guard must then refuse a mainnet hub that sets it, the same way it refuses `HEDERA_RAIL`.
- **`ARC_ESCROW_VERSION`** (#153). It is config, not a switch: it selects which version of the Arc escrow rail the hub speaks (`1` or `2`) and turns no rail on.
  - List it with the escrow rail's other config, beside `ARC_ESCROW` and `ARC_RPC_URL`, wherever the guard keeps config.

**Add one test:** with `HEDERA_SCHEDULED_RAIL=1` (and its rail's required config, if any), `railsFromEnv` still starts the `hedera-scheduled` rail, and the mainnet guard refuses that env on mainnet. Any deploy that drops the held rail must fail this test.

## Step (b): the two ERC-8004 anvil tests

The tests are in `packages/identity/test/erc8004.test.ts`:

- "ERC-8004 on anvil > feedback built from a released slip is readable";
- "ERC-8004 on anvil > only feedback from the slip's buyer with the slip's hash is earned".

Each receives 0 entries where it expects 1.

**Evidence so far (orch-cs).** These two tests are intermittent on `main`, not specific to #97:

- they failed in main's CI at 2ee66cc (run 42235237361);
- they failed in one of promotion #132's two gate runs, and passed in the other on the same commit;
- they pass in most local runs.

**Steps:**

1. **Run them on `main` alone first:** `git worktree add --detach /tmp/cs26-main origin/main` (main is 0e53253 or later), `bun install`, then `bun test packages/identity/test/erc8004.test.ts` 20 times in a loop, alone and then under load (`bun test` in parallel). Record the pass and fail counts.
2. **Find the root cause.** Suspects to check:
   - reading feedback logs before the block that holds them is mined;
   - getLogs block ranges;
   - shared anvil state or nonces between tests;
   - a `fromBlock` taken after the write.
3. **Fix the code** (`packages/identity/src/*`) so the reads are deterministic, for example by waiting for the transaction receipt and reading from its block. Then show 20 passes in a row, alone and under load.
4. **If the cause is in the test's own setup**, such as reading before awaiting its own write, stop and write it up as described under the hard rule. Do not edit the test.

## Lease

You may create or change only:

- `apps/hub/src/rails.ts` and `apps/hub/src/network.ts`;
- `apps/hub/test/rails-switches.test.ts` (new; the one test step (a) adds);
- `packages/identity/src/*`;
- `.packets/reports/cs-26-pr97-mainnet.md`.

## Acceptance

From the worktree root:

```
bun install && bun run typecheck && bun test apps/hub packages/identity && bun test && forge test
```

Every command passes. The two ERC-8004 tests also pass 20 times in a row, alone and under load, with the counts in the report.

## Constraints

- **Never launch a browser of any kind on this machine:** no Chrome or Chromium, headless or not, no Playwright, Puppeteer or screenshot tools.
- Never touch `contracts/**`. Never deploy, never call a faucet, never use a public RPC.
- No view code. TypeScript strict, no `any`. No new dependencies.

## Stop conditions

- You need to edit outside the lease, or edit a test: stop and write the report.
- One problem has blocked you for more than 20 minutes: stop, commit what passes, and write the report.

## Finish

Commit with small present-tense messages ending `(refs #29)`, and no trailers. Write `.packets/reports/cs-26-pr97-mainnet.md` with:

- the root cause of step (b);
- the 20-run counts before and after;
- what each switch was classified as.

Do not push, merge or deploy.
