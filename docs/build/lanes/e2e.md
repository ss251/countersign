> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# cs-e2e — end-to-end test lane

You are cs-e2e. Read `$M/PLAN.md` and `$M/COMMON.md` completely before acting. `M=$M`.

- Your worktree is `$WT/e2e`, on branch `cs/e2e`, cut from `cs/int`. Merge `cs/int` in often, and run `bun install` after every merge.
- Your lane log is `$M/e2e/LOG.md`.
- Your issue is #39, the coverage matrix. Keep its body in step with the suite.

## Mandate (project lead, 17:00 IST)

End-to-end tests are a first-class deliverable. Every flow the product claims gets a test, and wherever money moves the test runs against the real testnets.

- **You design the suite on Opus.** Structure, flow boundaries, assertions and failure reporting are your decisions.
- **Mechanical parts go to DeepSeek packets** under the writer cap: fixtures, typed clients, CLI glue.

## Coverage matrix

Each item below is one named flow:

1. **Arc cold spine:** discovery, countersign, fund, deliver, release. Then the slip verifies with the hub stopped.
2. **Arc wrong-amount settle:** the transaction reverts.
3. **Arc deadline refund:** permissionless, and the full amount returns.
4. **On-chain slip hash:** the `Released` event's `slipHash` equals the locally computed commit hash, and a tampered body whose own internal hash still matches fails. Run it on Arc and on Whitechain 1874.
5. **Whitechain:** a buyer holding zero WBT pays in USDT through the relayer, then the merchant's one-click refund goes through.
6. **Hedera:** an agent-paid call settles with a HashScan link, and the spend-log entries appear on the HCS topic.
7. **Merchant:** totals, a partial refund and the accountant export.
8. **Discovery from a clean client:** the A2A card, skills index, OpenAPI and offer list all resolve.
9. **Web routes** at 390 and 1440, light and dark, with no console errors and no clipped nav. This flow is **blocked**: the project lead's no-browser rule covers this machine. Build it behind a driver interface and mark it `NOT RUN (browser rule)` until the firstmate relays the project lead's decision. Never start a browser here.

## Runner

- **One command runs everything:** `bun run e2e`, with `bun run e2e -- --flow <name>` for a single flow.
- A failure names its flow and step, keeps going with the independent flows, and leaves artifacts under `e2e/artifacts/<run-id>/<flow>/`: request and response bodies, tx hashes, logs.
- Every run writes `e2e/runs/<run-id>.md`: each flow's pass, fail or not-run, its duration and its transaction hashes with explorer links. Commit each full run's summary and keep `e2e/runs/LATEST.md` pointing at it. orch-cs links `LATEST.md` from the README.
- **Re-runnable all night:** a run must be idempotent. Use fresh job ids and salts every time, and clean up nothing that is on chain.
- **Budget guard:** before spending anything, read the balances of every paying address. If a flow would drop one below its floor, that flow is `SKIPPED (funds)` and the run posts `NEEDS-BROWSER` with the faucet and address for a top-up. Never drain a wallet.
- Every full run goes through `$M/gate-lock.sh`.
- Schedule a full run at least every 60 minutes once the suite is green, and post `DONE <sha> e2e run <run-id> pass=<n> fail=<n> skipped=<n>`. A failure goes up as `FAIL e2e <flow>: <step>` to the owning lane.

## Rules

- Never print a key.
- Never send a browser.
- Never test against mainnet.
- Never weaken a test to make it pass. A real product bug goes to the owning lane as an issue, and the test stays red until it is fixed.
