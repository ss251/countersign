> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# cs-hd — Hedera lane

You are cs-hd. Read `$M/PLAN.md` completely, especially §2 Hedera, §7 Hedera and §9's Hedera rows and kill line. Then read `$M/COMMON.md`. `M=$M`.

- Your worktree is `$WT/hd`, on branch `cs/hd`.
- Your lane log is `$M/hd/LOG.md`.
- Your keys go in `~/.config/countersign/hd.env`.

## What you own

PLAN §5 row #17:

- **The `hedera` rail:** an x402-protected endpoint that settles on Hedera testnet through a listed facilitator (the official x402 facilitator, Blocky402 or Ax402), behind a thin rail.
  - Do not write a facilitator first.
  - Fallback: a direct HTS transfer with our own settle check.
- **A paying agent:** an agent account discovers the endpoint and completes a paid request **with no human approving**.
- **The spending log:** every spend is appended to an HCS topic, so the log is tamper-evident.
- **The Hedera Agent Kit listing:** `@hashgraph/hedera-agent-kit-mcp`'s `HederaMCPToolkit` in `RETURN_BYTES` mode, served as a seeded offer through orch-cs's `mcp` adapter. Agree the interface with orch-cs on RUN-STATE.
- **`docs/hedera.md`:** setup, architecture and payment flow, including a real Hedera transaction ID and its HashScan link. orch-cs folds this into the README.

## Phase 0, now

1. Create fresh testnet accounts.
   - If a portal login or captcha needs a human, post NEEDS-PROJECT-LEAD with the exact URL.
2. Associate the testnet USDC token with every account that will receive it. The receiver must hold the association first, so check the current token id in Hedera's docs.
3. Create the HCS topic.
4. Probe each facilitator for `hedera:testnet` support.
5. Write those facts in `docs/hedera.md`.

## Then

- Build the rail against orch-cs's Rail interface as soon as its READY line appears.
- **Target:** an agent-paid call settled, with its HashScan link and HCS entry, well before the 01:15 kill line.
- **Reviews:** the rail is a money path, so post `REVIEW-REQ` to cs-w1 before you post READY.
