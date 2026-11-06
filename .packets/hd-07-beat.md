# hd-07-beat: one command for the recorded Hedera demo beat

## Goal

The humans record the Hedera beat of the video from one command. `scripts/hedera/beat` runs the live, agent-paid call from start to finish and prints what the camera needs. Tracked by issue #6.

The beat, in order:

1. the agent finds the offer;
2. the envelope approves;
3. the agent countersigns, and the facilitator settles on Hedera;
4. the HashScan link of the payment and the HCS spend-log entry;
5. a second call refused by the budget cap, and its HCS entry;
6. an audit of this run that reconciles.

It must be re-runnable, idempotent and honest: every line printed is a fact read back from the network.

## Lease

- Create `scripts/hedera/beat.ts`, plus `scripts/hedera/beat`, an executable `#!/bin/sh` wrapper that runs `bun "$(dirname "$0")/beat.ts" "$@"`.
- Report: `$M/reports/hd-07-beat.md`.

## Context

Read first:

- `scripts/hedera/agent-run.ts`, `hub-standin.ts`, `audit.ts` and `env.ts`;
- `packages/buyer/src/hedera/agent.ts` (`createHederaAgent`, `spentFromLog`) and `spendlog.ts` (`readEntries`, `reconcile` with its `since` option);
- `packages/rail/src/hedera/index.ts` (`createHederaRail`, `hashscanTx`, `hashscanTopic`, `hashscanAccount`, `waitForTransaction`).

## Required

- **Hub:** `beat.ts [--hub <url>] [--json]`. With `--hub`, use that hub. Without it, start the same one-offer stand-in hub inside the process on a free port (the logic of `hub-standin.ts`), and stop it at the end.
- **Budget check first.** Read the agent's USDC and HBAR from the mirror node. If either is under its floor (1.00 USDC, 0.50 HBAR), print which one, print the faucet to use (`faucet.circle.com` for USDC on Hedera Testnet, or `portal.hedera.com/faucet` for HBAR to the agent's EVM address), and exit 2 before spending anything.
- **Cap:** set it so exactly one call fits. Rebuild `spent` from the HCS log with `readEntries` + `spentFromLog`, then `cap = spent + price + price / 2`, with `perMerchant` set high enough not to interfere. Buy twice: the first pays, the second is refused over the cap.
- **Window:** record the run's start time as a consensus-style `"<secs>.000000000"` before the first buy. At the end, call `reconcile(entries, agent, "0.0.429274", { since })` and print `matched`, `unbacked` and `unlogged` for this run.
- **Output.** These lines are for a screen recording: short, aligned, in this order. Monospace is fine; no colours are required.
  - the agent account and its HashScan link;
  - the offer title, price in USDC, payee and offer hash;
  - the envelope: cap, spent so far, and "approved";
  - "Countersigned" with the transaction id;
  - "Settled on Hedera by <facilitator>" with the HashScan transaction link;
  - the spend-log entry: sequence, the topic link, and the mirror message link `https://testnet.mirrornode.hedera.com/api/v1/topics/<topic>/messages/<seq>`;
  - the refusal sentence exactly as the agent returns it, and its spend-log entry with the same two links;
  - the audit line for this run.
- **`--json`:** human lines go to stderr. stdout gets one object `{beat: "hedera", ok, evidence: [{label, value, url?}]}`, using the labels `agent-run.ts --json` already uses, plus `audit` (value `"matched N, unbacked 0, unlogged 0"`). `ok` is true only when the payment settled, the refusal happened, and both audit lists are empty.
- **Exit codes:** 0 when `ok`, 1 otherwise, 2 for the funds check.

## Constraints

- No browser of any kind on this machine: no headless Chrome, Playwright, Puppeteer or screenshot tools. UI checks go back to the lane, which raises NEEDS-BROWSER.
- Do not run `beat`. It spends testnet funds, and the lane runs it live after review. Never read or print a key: use the `env.ts` helpers only.
- Change nothing outside the lease. Never stage `bun.lock`. Run `bun install` first if `node_modules` is missing.

## Acceptance

```
bun run typecheck && bun test packages/rail/src/hedera packages/buyer/src/hedera
```

Both must pass. Commit on `cs/hd-07` with short present-tense messages ending `refs #6`, and no trailers.

## Stop conditions

- A change to a package source file looks necessary: stop and explain in the report.
