> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# STEER-2205: the Grok audit says PR #164 is not safe to deploy, and the demo checklist

From the project lead at about 22:05 IST. Grok 4.7, at xhigh effort through its CLI, finished two jobs, and **both change the plan**.

The full texts are at:
- `$M/audit/grok-audit.txt`
- `$M/audit/grok-demo.txt`

## 1. PR #164: NOT SAFE TO DEPLOY

This is a second audit, independent of the Pashov run, on the option-(d) head.

**What it confirms is fixed** on the original traces: C1, C2, H1 and M1.

**What it finds new:**

| Severity | Finding | Fix (Grok's, adopted by the project lead) |
|---|---|---|
| High | **The arbiter locks a bond the payee never accepted for that buyer.** `fund` is arbiter-only when `cs.bond != 0` (option d), and the payee signs nothing per job. `minDuration` may be 0. So a cooperating buyer and the arbiter can fund, then call `failDelivery` while `now <= deadline`, and the buyer collects amount + bond. | Remove the arbiter check on `fund` entirely. Require a payee EIP-712 `Lock(jobId)` before `bondOf` is debited. `failDelivery` stays the arbiter's only mutator. **This replaces option (d) and the 19:40 "no payee lock signature" decision.** |
| High | **An online seller keeps the bond.** `cancel` returns the bond on any Delivered job, and `dispute` forfeits only if it is mined first. After missing the deadline, a seller can `release` any `slipHash` before `settleBy` and then `cancel`, so `refund` never forfeits. On a window-0 offer, that grace `release` pays the seller directly and the buyer can no longer dispute. | On Delivered, `cancel` reverts or forfeits. If `deliveredAt > deadline`, a later `cancel` forfeits. |
| Medium | **One Dispute signature has two bond outcomes.** `Dispute(jobId)` returns the bond while Funded and forfeits it after `release`, so a signature handed to a relayer can be mined either way. | Sign `Dispute(bytes32 jobId, uint8 status)` (or `DisputeDelivery(jobId, slipHash)`), and require the signed status to match. |
| Low | **Zero bond and zero window skip the registry.** | If `termsOf[payee][offerHash].price != 0`, require a full terms match anyway. |

**Owners:**

- **orch-cs coordinates and Rajdeep owns `contracts/**`.**
  - Ask him on #164 now.
  - If he has not pushed within 20 minutes, one DeepSeek packet (cs-30) makes all four contract fixes on the PR branch.
  - Each fix needs a regression test that fails on 81df37e and passes after.
- **The `Lock(jobId)` change reaches past the contract:**
  - the runner signs `Lock(jobId)` when it accepts a bonded job;
  - the hub carries that signature into `fund`;
  - the rail's v2 ABI follows the contract.

  These run as separate packets (runner and hub, then the rail), leased apart from the contract packet. They are reviewed together, because the selectors and the typehash string must match exactly as before. Unbonded jobs, including all of the phone's offers, need no Lock.
- **cs-w1** reviews every fix.
- **cs-audit** finishes its current Pashov pass on 81df37e, posts the report, and merges its findings into the same fix round. It then runs **the final Pashov pass on the post-fix head**. The project lead re-runs Grok on that head too.

**#164 merges only when both final passes have no critical, high or medium findings.** The Arc and 1874 deploys and the bonded failDelivery job follow. The contract item's deadline moves from 23:30 to **01:00**.

## 2. The demo checklist

`grok-demo.txt` covers:
- ten live failures and their fixes;
- the thirty-minutes-out checks, with balances and floors;
- what may be cut and re-recorded, and what must be one continuous take;
- what to do if the network dies.

**The load-bearing change: kill the LOCAL hub on camera, never the Railway hub.** Stopping Railway kills the console too.

The kill-scene hub is started from the checklist:

```
PORT=8787 ARC_ESCROW=0x19c27D770969291E6A0a305dc1Be1a845E7c1b76 ARC_RPC_URL=https://rpc.testnet.arc.network bun run hub
```

Then check it with `curl -fsS localhost:8787/healthz`. Only that process is stopped, in a framed terminal.

**Owners:**

- **cs-readme** copies both files into the repo **verbatim** in one PR, then updates `docs/status.md`'s links:
  - `docs/audits/2026-11-06-grok-escrow-v2.md`, with a one-line header naming the source, the model, the time and that it is independent of the Pashov run;
  - `docs/demo/checklist.md`, with the same kind of header.
- **orch-cs** folds the checklist into `$M/DEMO-SCRIPT.md`: the local-hub kill scene, the floors, the continuous takes. It re-checks every URL, command and balance at 03:30, because the checklist's numbers were read at 21:57.
- **The firstmate** hands the checklist to the project lead, who records.
- **HBAR:** the checklist's own floor says the Hedera agent (0.575 HBAR against a 0.50 floor) runs the x402 beat once, and needs at least 2 HBAR before a second schedule. That is with the project lead, together with the WalletConnect test wallet's HBAR.
