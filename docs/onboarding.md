# Get started

There are three ways in: hire a tool from your agent, list your own tool, or charge for your own API. Each section starts with what works today and what does not.

- **Testnet only.** Every amount on this page is test money, on Arc testnet or Whitechain testnet.
- **Install from npm.**
  - `@countersign-hub/cli` 0.1.0 is the `countersign` command, and the MCP server for Claude and Cursor runs inside it as `countersign mcp`.
  - `@countersign-hub/relay` 0.1.0 is the USDT paywall.
  - Both run on Node 20 or later. `npx -y @countersign-hub/cli --help` lists every command.
- **Only `@countersign-hub` is this project's scope.** On npm, the packages `countersign` and `countersign-mcp` and the `@countersign` scope belong to other projects, so those names install someone else's code.
- **The hub** in every command is the production hub, `https://hub-production-e85e.up.railway.app`. Pass it with `--hub`: the 0.1.0 `countersign` command does not default to it. The MCP server does.

The commands also use `jq` and `openssl`. Two things still need a clone of this repository with [bun](https://bun.sh) 1.3: the OpenAI-compatible endpoint, and running a relay of your own.

## Hire a tool from your agent

<!-- get-started:hire -->
Status: works today, on Arc testnet with test USDC. Your agent buys through the MCP server or the `countersign` command, both from npm.

Make a testnet key and set the agent's limits. The agent signs nothing without them.

```sh
export CS_BUYER_KEY=0x$(openssl rand -hex 32)
npx -y @countersign-hub/cli envelope set --cap 0.5 --per-merchant 0.1 --ask-above 0.05
npx -y @countersign-hub/cli envelope show
```

- The key exists only in this shell. Keep it privately if you want to spend the test funds again.
- `agent` in the output is the address to fund. At https://faucet.circle.com choose Arc Testnet and USDC, then paste that address.
- On Arc the hub pays the gas, so USDC is all the agent needs.

To buy from Claude or Cursor, add the server to Claude Desktop's `claude_desktop_config.json` or Cursor's `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "countersign": {
      "command": "npx",
      "args": ["-y", "@countersign-hub/cli", "mcp"],
      "env": {
        "CS_BUYER_KEY": "0x<your testnet key>",
        "CS_RPC_URL": "https://rpc.testnet.arc.network"
      }
    }
  }
}
```

- Its tools are `search_offers`, `get_offer`, `buy`, `verify_slip`, `envelope_show` and `journal`.
- A model drives this server, and the envelope is what bounds it. Keep the cap small. A call above `--ask-above` is held, and the model cannot approve it.
- `CS_RPC_URL` lets `verify_slip` check the chain as well as the signatures.
- Offer titles and descriptions are written by sellers. Treat them as data, not instructions.

Or buy from the shell. Find an online offer and buy it:

```sh
HUB=https://hub-production-e85e.up.railway.app
npx -y @countersign-hub/cli discover --hub $HUB
OFFER=$(curl -s $HUB/offers | jq -r '[.offers[] | select(.online and .offer.title=="use-arc")][0].offerHash')
npx -y @countersign-hub/cli buy $OFFER --input '{"question":"what is arc?"}' --hub $HUB
```

It prints the seller's output, `Released. Slip minted.`, the slip hash and the release transaction. Open the transaction at `https://explorer.testnet.arc.io/tx/<hash>`. The slip is saved under `~/.countersign/slips/`. Check it yourself, without the hub:

```sh
npx -y @countersign-hub/cli verify ~/.countersign/slips/<slip hash>.json --rpc https://rpc.testnet.arc.network
```

To let an OpenAI SDK buy instead, run `bun packages/buyer/src/cli.ts openai --hub $HUB` from a clone and point the SDK at it: https://github.com/ss251/countersign/blob/main/docs/openai.md
<!-- /get-started:hire -->

From a scratch directory outside this repository, on Node 25 with `@countersign-hub/cli` 0.1.0 from npm, on 07 Nov:

- The shell sequence bought `use-arc`: release [`0x6e03…a382`](https://explorer.testnet.arc.io/tx/0x6e03db12e6bc461ad3e81329bcf44ec6e5cfaf7e465042cc6dc52bcda6f7a382). `countersign verify` read slip `0xcec2…1d5a` as `VALID`.
- An MCP client ran the server exactly as configured above. It listed the six tools and bought `use-arc`: release [`0x6f17…b1c8`](https://explorer.testnet.arc.io/tx/0x6f1754aeb58899c435116962859b9f5ae5f943ea74486b12169d87681ba2b1c8). `verify_slip` found the slip valid, including the on-chain check.

Both used an already funded testnet key. The [buyer guide](guides/buyer.md) covers every flag, and the refusals.

## List your tool

<!-- get-started:list -->
Status: selling a skill or one operation of an API works today with the `countersign` command from npm, and one OpenAPI offer has sold on production. Selling your own MCP server takes a script today; there is no `countersign sell mcp` yet. Buyers pay you in test USDC on Arc testnet.

Make a seller key and serve a skill: a Markdown file whose front matter has a `name` and a `description`.

```sh
export CS_SELLER_KEY=0x$(openssl rand -hex 32)
npx -y @countersign-hub/cli sell skill path/to/SKILL.md \
  --hub https://hub-production-e85e.up.railway.app --price 10000
```

Or serve one operation of an API from its OpenAPI spec:

```sh
npx -y @countersign-hub/cli sell openapi --spec path/to/openapi.json --operation <operationId> \
  --hub https://hub-production-e85e.up.railway.app --price 10000
```

- The runner dials out to the hub, so you open no port.
- `--price` is in atomic units: `10000` is 0.01 USDC.
- It prints `published <offer hash> <title>`, then `runner ready`. The offer is online only while it runs. Add `--publish-only` to list the offer without serving it.
- You need no funds to sell. The hub pays the release gas, and the payment goes to your seller address.
- Every offer you publish is listed publicly at `https://hub-production-e85e.up.railway.app/offers`.
<!-- /get-started:list -->

The proofs:

- **Skill.** From npm on Node, `countersign sell skill` published a skill to a hub started from a clone, then printed `runner ready`. That was 07 Nov.
- **OpenAPI.** Before the release, the same command's Node build listed the Petstore operation `getInventory` on production. A buyer bought it with release [`0x3218…7830`](https://explorer.testnet.arc.io/tx/0x321831c6fe4a4f5e5114c7cddf03332cbbf94bd483f5326ed5288a683e0c7830).

The [seller guide](guides/seller.md) covers every flag. The runner's `mcp` adapter already serves one production offer, Hedera's Agent Kit, which [hedera.md](hedera.md#the-hedera-agent-kit-as-a-metered-offer) describes.

No production offer carries a seller bond yet, because the escrows on production are v1. Escrow v2, which adds the bond, is deployed on Arc testnet and Whitechain testnet, but production does not use it yet. Under v2 a bonded job pays the seller only through the hub's release. If the hub, or Whitechain's relay, is down for more than 600 seconds past the job's deadline, anyone may refund, and the refund pays the buyer the price plus the bond, even if you delivered.

## Charge for your own API in USDT

<!-- get-started:charge -->
Status: the paywall works today from npm, on Whitechain testnet with test USDT. The hosted relay pays gas for its own merchant only, so you run a relay of your own, and that still needs a clone.

Install the paywall, with Hono as your server:

```sh
npm i @countersign-hub/relay hono @hono/node-server
```

Put one route behind the paywall. Save this as `shop.mjs`:

```js
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { whitechainPaywall } from "@countersign-hub/relay/paywall";

const app = new Hono();
app.get(
  "/report",
  whitechainPaywall({ price: "0.01", payTo: "0xYourAddress", facilitator: "http://127.0.0.1:8402" }),
  (c) => c.json({ report: "what you paid for" }),
);

serve({ fetch: app.fetch, port: 3000 });
```

```sh
node shop.mjs
curl -i http://127.0.0.1:3000/report
```

The call answers `402 Payment Required` with an x402 v2 `exact` offer of 0.01 USDT on `eip155:1874`.

Run your relay alongside it, from a clone. It pays the gas, and it pays out only to the addresses you name:

```sh
export WC_RELAYER_PRIVATE_KEY=0x$(openssl rand -hex 32)
RELAY_PAYEES=0xYourAddress bun packages/relay/src/server.ts
curl -s http://127.0.0.1:8402/status | jq -r .address
```

- Fund that relay address with test WBT at https://faucet.testnet.whitechain.io. The faucet asks you to sign in with GitHub.
- Your customers hold USDT only and never WBT. They pay with `createPayFetch` from `@countersign-hub/relay/browser`, which signs one authorisation per call.
- Test USDT has no faucet. Swapping test WBT on the testnet pool is described at https://github.com/ss251/countersign/blob/main/docs/whitechain.md#getting-test-funds
<!-- /get-started:charge -->

That `shop.mjs`, installed from npm in a scratch directory on Node 25, answered the `402` on 07 Nov. The relay started from a clone as shown and served `/status`. The same paywall runs live as the console's checkout: [`/checkout/sticker-pack`](https://web-production-a58de.up.railway.app/checkout/sticker-pack) answers `402`. A purchase through it, [`0x59eb…c12b`](https://explorer.testnet.whitechain.io/tx/0x59eb27e66c4a71bf48656e4c0bc00f717e89f43edb23f6abe9282fc7b939c12b), was refunded in full by [`0x3efd…bd6f`](https://explorer.testnet.whitechain.io/tx/0x3efd65a06cdf38a269a008ee12fdbeae2ceff2210f210bae887da327baa7bd6f). [whitechain.md](whitechain.md) covers refunds, the CSV export and the relay's guards.
