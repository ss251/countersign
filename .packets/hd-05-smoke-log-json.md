# hd-05-smoke-log-json: every spend by the agent key is logged; demo evidence as JSON

## Goal

Two small changes to the Hedera lane scripts. Tracked by issue #6.

1. **The smoke test logs its spend.** `scripts/hedera/smoke.ts` pays with the agent's key but never writes to the agent's HCS spend log. The audit (`scripts/hedera/audit.ts`) therefore reports its payments as `unlogged`, which is correct behaviour for the audit and a gap in the smoke test. After a settled smoke payment, append a `spend` entry exactly as the agent does, so every spend made with the agent's key is on the log.
2. **Evidence as JSON for the `#/demo` page.** With `--json`, `scripts/hedera/agent-run.ts` and `scripts/hedera/audit.ts` print their usual lines to stderr and exactly one JSON object to stdout at the end.

## Lease

- `scripts/hedera/smoke.ts`, `scripts/hedera/agent-run.ts` and `scripts/hedera/audit.ts`. No other file changes.
- Report: `$M/reports/hd-05-smoke-log-json.md`.

## Context

Read first:

- the three scripts and `scripts/hedera/env.ts`;
- `packages/buyer/src/hedera/spendlog.ts` (`appendEntry`, `readEntries`, `SpendEntry`);
- `packages/buyer/src/hedera/agent.ts` (`spentFromLog`, and how `log()` builds an entry);
- `packages/rail/src/hedera/txid.ts` (`hashscanTx`, `hashscanAccount`, `hashscanTopic`).

## Required changes

1. **`smoke.ts`.** After the settled payment is confirmed on the mirror node, and before the replay check:
   - read the topic (`HD_TOPIC_ID`) with `readEntries` and rebuild the spend with `spentFromLog`;
   - append one `spend` entry with `appendEntry`, using a client whose operator is the agent (`testnetClient(HD_AGENT_ID, key(env, "HD_AGENT_KEY"))`). Fields: `kind: "spend"`, `rail: "hedera"`, `network: "hedera:testnet"`, the smoke offer's hash and seller, `payTo`, `asset`, `amount`, `tx` = the settled transaction id, `total` = the rebuilt total plus this amount, `cap: "1000000"` (the agent's standing cap, the same default `agent-run.ts` uses), and `at` = unix seconds;
   - print the HCS sequence and the topic link.

   Only the `x402.org` and `blocky402` modes pay with the agent's key through the facilitator; `local` does too. Log in all three.
2. **`agent-run.ts --json`** prints `{beat: "hedera", ok, evidence: [{label, value, url?}]}`.
   - `ok` is true when every requested buy either paid or was refused by the envelope.
   - Entries, in order: `agent` (with its HashScan account URL), `offer` (the offer hash), `facilitator`, `payment` (the transaction id, with its HashScan transaction URL) and `spend log` (as `#<sequence>`, with the topic URL).
   - For `facilitator`, use the hosted facilitator's name when the challenge's fee payer matches one read from `FACILITATORS`; when it is the operator account, use `local`.
   - When a refusal happened, also add `refusal` (the sentence) and `refusal log` (`#<sequence>`, with the topic URL).
   - With several paid buys, repeat `payment` and `spend log` once per buy, in order.
3. **`audit.ts --json`** prints `{beat: "hedera-audit", ok, evidence: [{label: "matched", value}, {label: "unbacked", value}, {label: "unlogged", value}]}`, with `ok` true when unbacked and unlogged are both 0. Add one `{label: "unlogged tx", value, url}` entry per unlogged transaction, and one `{label: "unbacked", value: "#<seq> <why>"}` entry per unbacked one. Exit codes stay as they are.

Without `--json`, all three scripts print exactly what they print today, plus the new smoke log lines.

## Constraints

- No browser of any kind on this machine: no headless Chrome, Playwright, Puppeteer or screenshot tools. UI checks go back to the lane, which raises NEEDS-BROWSER.
- Do not run any of these scripts. They spend testnet funds; the lane runs them live after review. Do not read or print any key: use the `env.ts` helpers, which never print one.
- Change nothing outside the lease. Never stage `bun.lock`. Run `bun install` first if `node_modules` is missing.

## Acceptance

```
bun run typecheck && bun test packages/rail/src/hedera packages/buyer/src/hedera
```

Both must pass with no skipped tests. Commit on `cs/hd-05` with short present-tense messages ending `refs #6`, and no trailers.

## Stop conditions

- A change to a package source file looks necessary: stop and explain in the report.
