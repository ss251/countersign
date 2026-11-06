# hd-02-agent-tests: tests and scripts for the hedera agent and its HCS spend log

## Goal

The paying agent (`packages/buyer/src/hedera/agent.ts`) and its HCS spending log (`packages/buyer/src/hedera/spendlog.ts`) exist and typecheck, but nothing exercises them. Prove them offline with tests that fail when the behaviour is wrong. Then add the three small scripts the lane needs to run them live: one agent run, one audit of the log against the chain, and a stand-in hub to pay against until the real hub wires the hedera rail.

## Lease

- `packages/buyer/src/hedera/agent.ts`: one change only. Add an optional `appendLog?: (entry: SpendEntry) => Promise<{ sequence: number }>` to `HederaAgentOptions`, used instead of `appendEntry(opts.logClient, opts.topicId, entry)` when given, and make `logClient` optional when `appendLog` is given. No other edit to this file.
- Create `packages/buyer/src/hedera/test/agent.test.ts` and `packages/buyer/src/hedera/test/spendlog.test.ts`.
- Create `scripts/hedera/agent-run.ts`, `scripts/hedera/audit.ts` and `scripts/hedera/hub-standin.ts`.
- Report: `/Users/thescoho/Developer/countersign-mumbai/reports/hd-02-agent-tests.md`.

## Context

Read first:

- `packages/buyer/src/hedera/agent.ts`, `spendlog.ts`, `signer.ts`;
- `packages/rail/src/hedera/rail.ts` and `packages/rail/src/hedera/test/rail.test.ts`, for the fake facilitator and the fake mirror `fetch`;
- `packages/core/src/envelope.ts` (`checkEnvelope`, `needsHuman`, `recordSpend`) and `packages/core/src/wire.ts` (the `PAYMENT-*` headers, `toBase64Json`/`fromBase64Json`, `CallResult`);
- `scripts/hedera/env.ts` and `scripts/hedera/smoke.ts`, to see how scripts load ids and keys from `~/.config/countersign/hd.env`. Use these helpers and never print a key.

## Constraints

- **Tests are offline.**
  - The hub is a `Bun.serve({ port: 0 })` inside the test. It uses a real `createHederaRail` with a fake facilitator and `verifyPayerSignature: async () => ({ ok: true })`, so the agent's signed transfer goes through the real rail checks.
  - Keys come from `PrivateKey.generateECDSA()`, and the mirror node is a fake `fetch`.
- **`agent.test.ts` covers at least these cases:**
  - Discover keeps only listed, online offers whose rails include `hedera` and that have `payTo.hedera`.
  - A paid call logs one `spend` entry whose `tx` equals the id the agent signed, and raises `spent.total`.
  - An over-cap or over-merchant-limit envelope refuses before any `PAYMENT-SIGNATURE` request is made and logs one `refused` entry with the reason.
  - `needsHuman` refuses, because the agent never asks a person.
  - A hub that challenges for a higher price, or a different payee, than the listing is refused, and nothing is signed or sent.
  - A 200 whose `PAYMENT-RESPONSE` names a different transaction throws.
  - A non-200 after paying logs a `spend` only when the fake mirror shows the transfer landed.
  - `spentFromLog` rebuilds totals per seller.
- **`spendlog.test.ts`:** `readEntries` follows `links.next` across pages and skips messages that are not spend entries. `reconcile` sorts entries into `matched`, `unbacked` (missing tx, failed result, wrong credit, wrong memo) and `unlogged` (an outgoing USDC transfer after `since` that no entry names). An outgoing HBAR-only transfer is never `unlogged`.
- **Scripts** run live and print ids and links only:
  - `agent-run.ts [hub-url]` (default `http://127.0.0.1:8787`) builds the agent from `hd.env`: payer `HD_AGENT_ID`/`HD_AGENT_KEY`, topic `HD_TOPIC_ID`, a log client with the agent as operator, and envelope `{cap: "1000000", perMerchant: "500000", allowlist: [], revoked: false}` with `agent` set to `HD_AGENT_EVM`. It rebuilds `spent` from the topic with `readEntries` and `spentFromLog`, discovers, buys the first hedera listing with input `{}`, and prints each step: the listing, the envelope decision, the signed transaction id, the settlement, the HashScan transaction link, and the HCS sequence with the topic link.
    - Flags `--cap <atomic>` and `--per-merchant <atomic>` override the envelope; `--times <n>` buys n times in a row. With `--cap` set below two prices, a run therefore shows one paid call, then the cap refusal and its HCS entry.
  - `audit.ts` reads the topic, runs `reconcile` for the agent and USDC `0.0.429274`, prints the counts and every unbacked or unlogged item, and exits 1 if there are any.
  - `hub-standin.ts [port]` (default 8787) serves `GET /offers`, with one listing for an offer paid to `HD_SELLER_ID` at `price: "10000"` with `rails: ["hedera"]`, and `POST /offers/:offerHash/call`. That route answers 402 with `PAYMENT-REQUIRED`, or verifies and settles through `createHederaRail()` with the default facilitators and answers `{output: {ok: true}, slip: {settlement: {transaction, network, url}}}` with `PAYMENT-RESPONSE`. Its first line says it is a stand-in, not the hub.
- Never stage `bun.lock`. Run `bun install` first if `node_modules` is missing.

## Acceptance

```
bun test packages/buyer/src/hedera packages/rail/src/hedera && bun run typecheck
```

Both must pass with no skipped tests. Commit on `cs/hd-02` with short present-tense messages and no trailers.

## Stop conditions

- A test exposes a bug in `agent.ts`, `spendlog.ts`, `signer.ts` or the rail: keep the failing test, do not fix the source, describe it in the report and stop.
- Anything needs a network call in a test: stop and report.
