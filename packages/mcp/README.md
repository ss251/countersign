# @countersign-hub/mcp

A buyer MCP server for countersign. Claude Desktop, Cursor or any MCP client can hire paid offers (APIs, skills, MCP tools) and pay in testnet USDC, under a spending envelope you set. Every purchase returns the seller's output and a slip you can verify on chain. It is testnet only.

## Run it

```sh
npx -y @countersign-hub/cli mcp
```

That is the CLI's `countersign mcp`. Or install the CLI once:

```sh
npm i -g @countersign-hub/cli
countersign mcp
```

This package, `@countersign-hub/mcp`, is the server library and has no bin of its own.

## 1. A testnet key and USDC

Use a key that only ever holds testnet funds. Fund its address with Arc testnet USDC from [https://faucet.circle.com](https://faucet.circle.com).

## 2. Set a spending envelope (once)

```sh
CS_BUYER_KEY=0xYOUR_TESTNET_KEY npx -y @countersign-hub/cli envelope set --cap 1 --per-merchant 0.5
```

Add `--ask-above <usd>` and purchases above it are held, never approved by the model.

## 3. Add it to your client

**Claude Desktop.** The config path is `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS and `%APPDATA%\Claude\claude_desktop_config.json` on Windows. Use exactly:

```json
{
  "mcpServers": {
    "countersign": {
      "command": "npx",
      "args": ["-y", "@countersign-hub/cli", "mcp"],
      "env": {
        "CS_BUYER_KEY": "0xYOUR_TESTNET_KEY",
        "CS_RPC_URL": "https://rpc.testnet.arc.network"
      }
    }
  }
}
```

**Cursor:** the same `mcpServers` block, in `~/.cursor/mcp.json` or a project's `.cursor/mcp.json`.

**Then:** restart the client.

## Tools

| Tool | Arguments | What it does |
|---|---|---|
| `search_offers` | `query?`, `limit?` | List countersign offers for sale. A query filters on title, description, adapter and rails, case-insensitively. |
| `get_offer` | `offerHash` | Read one signed offer by its hash: terms, schemas, rails and payee. |
| `buy` | `offerHash`, `input`, `rail?` | Buy an offer under the agent's envelope and return the seller's output and slip. Requires `CS_BUYER_KEY`. |
| `verify_slip` | `slip?`, `slipHash?` | Verify a slip object, or a slip hash read from local state or the hub. |
| `envelope_show` | | Read the agent's envelope and what the journal says it has spent. |
| `journal` | `limit?` | Read the most recent journal entries, newest last. |

## Configuration

| Setting | Flag | Meaning |
|---|---|---|
| `CS_BUYER_KEY` | | required for `buy` |
| `CS_HUB` | `--hub` | defaults to production |
| | `--state` | defaults to `~/.countersign` |
| `CS_RPC_URL` | `--rpc` | without it, `verify_slip` skips the on-chain check, and `valid` then covers signatures and terms only |
| `CS_NETWORK` | | must be unset or `testnet` |

## Safety

- The envelope is checked before anything is signed, and a refusal signs nothing.
- A purchase that needs a human comes back `Held.`, and the model cannot approve it.
- The key stays on your machine; the server never prints it, and it logs to stderr only.
- Testnet only.
- Install only `@countersign-hub/*`; the npm packages named `@countersign/*`, `countersign` and `countersign-mcp` belong to other projects, so never npx or npm install them.

## Try it

Ask your client:

> Find a countersign offer about Arc, buy it, then verify the slip.

A real run bought the `use-arc` offer, `0xdd24c0f8d53f5f4d87630be73cf438eab990ffd63e73f0953e58d4ad3964efc7`, released on Arc at [https://explorer.testnet.arc.io/tx/0x8fff4e3f540a07b75d89abc8baca83794855d39340c4e9d1e96892f3767f8722](https://explorer.testnet.arc.io/tx/0x8fff4e3f540a07b75d89abc8baca83794855d39340c4e9d1e96892f3767f8722). `verify_slip` returned `valid: true`, including the on-chain `Released` event.

## Use it as a library

```ts
import { main, createCountersignMcpServer } from "@countersign-hub/mcp";
```

`main(argv)` runs the stdio server, which is what `countersign mcp` calls. `createCountersignMcpServer(deps)` returns an MCP server you can connect to any transport.
