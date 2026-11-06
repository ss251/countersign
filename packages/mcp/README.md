# @countersign-hub/mcp

The buyer MCP server for countersign. Claude Desktop, Cursor or any MCP client can hire paid offers and pay in testnet USDC under a spending envelope; every purchase returns the output and a slip you can verify. Testnet only.

## Quickstart

Testnet only. Node 20 or later.

```sh
npx -y @countersign-hub/cli login
```

`login` opens a page in your browser. Sign in with Privy (email or a passkey), check that the code matches the one in your terminal, and click "Connect this CLI". Never approve a code you did not start yourself: whoever started it gets your agent wallet's session. The CLI prints your agent wallets' addresses. The wallet's key is held by Privy, and never exists on your machine or on the countersign hub. The CLI keeps only a session token, which `logout` ends; it expires after 7 days.

Fund the EVM address with test USDC from https://faucet.circle.com (choose Arc Testnet), or send some from your own wallet. Then buy, or sell:

```sh
npx -y @countersign-hub/cli buy <offer hash> --input '{"question":"what is arc?"}'
npx -y @countersign-hub/cli sell openapi --spec openapi.json --operation <id> --price 10000
```

`whoami` prints both wallets' addresses and balances. `logout` ends the session.

For Claude or Cursor, the MCP config needs no key and no environment:

```json
{ "mcpServers": { "countersign": { "command": "npx", "args": ["-y", "@countersign-hub/cli", "mcp"] } } }
```

**One login, two Privy wallets, no key on your side.**
- **The EVM wallet** pays on Arc and Whitechain.
- **The Hedera wallet** pays on Hedera.

The countersign app controls both wallets through Privy, and you hold no key to them. That makes the hub a delegated signer:
- it signs only for a signed-in CLI session;
- each signature stays inside your envelope;
- the EVM wallet's Privy policy allows only typed-data payments into known escrows on Arc and Whitechain.

`logout` ends your CLI's session, so the hub stops signing for it. Keep only small testnet amounts in either wallet.

Only `@countersign-hub` on npm is this project's. `countersign`, `countersign-mcp` and the `@countersign` scope belong to other projects.

## In Claude Desktop or Cursor

Claude Desktop reads `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, and `%APPDATA%\Claude\claude_desktop_config.json` on Windows. Cursor reads `~/.cursor/mcp.json`.

Add the server with no `env` block:

```json
{ "mcpServers": { "countersign": { "command": "npx", "args": ["-y", "@countersign-hub/cli", "mcp"] } } }
```

Before sign-in, every tool answers `Not signed in. Run: npx -y @countersign-hub/cli login`.

## Tools

| Tool | What it does |
|---|---|
| `search_offers` | List countersign offers for sale. A query filters on title, description, adapter and rails, case-insensitively. |
| `get_offer` | Read one signed offer by its hash: terms, schemas, rails and payee. |
| `buy` | Buy an offer under the agent's envelope and return the seller's output and slip. |
| `verify_slip` | Verify a slip object, or a slip hash read from local state or the hub. |
| `envelope_show` | Read the agent's envelope and what the journal says it has spent. |
| `journal` | Read the most recent journal entries, newest last. |

## Safety

- The envelope is checked before anything is signed.
- A purchase that needs a human comes back `Held.`, and the model cannot approve it.
- No key on your machine or in any config.
- The session is revocable with `npx -y @countersign-hub/cli logout`.
- Testnet only.
- Only `@countersign-hub` on npm is this project's.

While you are signed in, the hub can ask Privy to sign for your agent's wallet, within your envelope and the wallet's policy.

## Try it

Ask your MCP client:

> Find a countersign offer about Arc, buy it, then verify the slip.

One real run bought the `use-arc` offer, released on Arc at https://explorer.testnet.arc.io/tx/0x8fff4e3f540a07b75d89abc8baca83794855d39340c4e9d1e96892f3767f8722. `verify_slip` returned `valid: true`, with the on-chain `Released` event.

## Options

- `--hub` or `CS_HUB`: the countersign hub (default `https://hub-production-e85e.up.railway.app`).
- `--state`: where the envelope, journal and slips live (default `~/.countersign`).
- `--rpc` or `CS_RPC_URL`: the RPC `verify_slip` reads the chain from (optional; without it, the on-chain check is skipped).

## Use it as a library

```ts
import { main, createCountersignMcpServer } from "@countersign-hub/mcp";
```

`main(argv, { loadAccount })` starts the stdio server with an account loader of your own.

## Advanced: CI

A CI job can sign with a key of its own instead of a session: set `CS_BUYER_KEY` or `CS_SELLER_KEY` to a fresh testnet private key made only for the job, never a main wallet's. It signs locally and is never sent to the hub.
