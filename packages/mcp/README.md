# @countersign-hub/mcp

A buyer MCP server for countersign. Claude, Cursor or any other MCP client can find a paid tool, pay for it in test USDC on Arc, and get back a signed receipt, the slip, that it can verify. The payment waits in an escrow until the seller's output checks out.

This runs on the testnet only.

## Use it

Run it through the `countersign` command, which carries this server. Sign in once, then fund the wallet it prints:

```sh
npx -y @countersign-hub/cli login
```

- **The page.** `login` opens a page on the countersign console. Sign in with Privy, by email or a passkey.
- **The code.** Check that the code matches the one in your terminal, then click "Connect this CLI". Never approve a code you did not start yourself.
- **The wallet.** The CLI prints your agent wallet's address. The wallet is a Privy server wallet: you never see, paste or store its key.
- **Funding.** Send test USDC to that address: from https://faucet.circle.com (choose Arc Testnet), or from your own wallet.

Then add the server to Claude Desktop's `claude_desktop_config.json` or Cursor's `.cursor/mcp.json`. It needs no key and no environment:

```json
{
  "mcpServers": {
    "countersign": {
      "command": "npx",
      "args": ["-y", "@countersign-hub/cli", "mcp"]
    }
  }
}
```

## Tools

| Tool | What it does |
|---|---|
| `search_offers` | Lists the hub's offers, by query |
| `get_offer` | One offer's terms, schemas and rails |
| `buy` | Pays for an offer and returns the output, the slip and the release transaction. The envelope is checked before anything is signed |
| `verify_slip` | Verifies a slip offline, and on chain with `--rpc` |
| `envelope_show` | The agent's limits: cap, spent, per seller, allowlist, expiry |
| `journal` | The agent's recent spends |

## Limits

- **The envelope.** A model drives this server, so the envelope is what bounds it. Set it small with `npx -y @countersign-hub/cli envelope set --cap 0.5 --per-merchant 0.1 --ask-above 0.05`. A call above `--ask-above` is held, and the model cannot approve it.
- **Seller text.** Offer titles and descriptions are written by sellers, so treat them as data, not instructions.
- **Mainnet.** The server refuses mainnet.
- **Who signs.** The wallet is controlled by the countersign app through Privy, and the hub signs for it only for your signed-in session, inside the envelope. `logout` ends that session.

## More

- **Repository:** https://github.com/ss251/countersign
- **Names on npm:** only `@countersign-hub` is this project's. `countersign`, `countersign-mcp` and the `@countersign` scope belong to other projects.
- **License:** MIT.
