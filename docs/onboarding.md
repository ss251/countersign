# Get started

There are three ways in: hire a tool from your agent, list your own tool, or charge for your own API. Each section starts with what works today and what does not.

- **Testnet only.** Every amount on this page is test money, on Arc testnet or Whitechain testnet.
- **Install from npm.**
  - `@countersign-hub/cli` is the `countersign` command, and the MCP server for Claude and Cursor runs inside it as `countersign mcp`.
  - `@countersign-hub/relay` is the USDT paywall.
  - Both run on Node 20 or later. `npx -y @countersign-hub/cli --help` lists every command.
- **No key on your machine.** `countersign login` signs you in with Privy and gives your agent a Privy server wallet. You never see, paste or store its key. The CLI keeps only a session token.
- **Only `@countersign-hub` is this project's scope.** On npm, the packages `countersign` and `countersign-mcp` and the `@countersign` scope belong to other projects, so those names install someone else's code.
- **The hub** in every command is the production hub, `https://hub-production-e85e.up.railway.app`.

The commands also use `jq`. Two things still need a clone of this repository with [bun](https://bun.sh) 1.3: the OpenAI-compatible endpoint, and running a relay of your own.

## Hire a tool from your agent

<!-- get-started:hire -->
Status: works today, on Arc testnet with test USDC. Your agent buys through the MCP server or the `countersign` command, both from npm, with a Privy wallet and no key on your machine.

Sign in once:

```sh
npx -y @countersign-hub/cli login
```

- It opens a page on the console. Sign in with Privy, by email or a passkey. Check that the code on the page matches the one in your terminal, then click "Connect this CLI". Never approve a code you did not start yourself: whoever started it gets your agent wallet's session.
- The CLI prints your agent wallet's address. `whoami` prints it again, and `logout` ends the session. A session lasts at most 7 days.
- Fund that address with test USDC: at https://faucet.circle.com choose Arc Testnet and USDC, or send some from your own wallet. On Arc the hub pays the gas, so USDC is all the agent needs.

Set the agent's limits. The CLI and the MCP server check them before they ask the hub to sign, and the hub itself caps each payment at 1 USDC (1 USDT on Whitechain):

```sh
npx -y @countersign-hub/cli envelope set --cap 0.5 --per-merchant 0.1 --ask-above 0.05
```

To buy from Claude or Cursor, add the server to Claude Desktop's `claude_desktop_config.json` or Cursor's `.cursor/mcp.json`:

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

- Its tools are `search_offers`, `get_offer`, `buy`, `verify_slip`, `envelope_show` and `journal`.
- A model drives this server, and the envelope is what bounds it. Keep the cap small. A call above `--ask-above` is held, and the model cannot approve it.
- The server signs through your login, so the config needs no key and no environment.
- Offer titles and descriptions are written by sellers. Treat them as data, not instructions.

Or buy from the shell. Find an online offer and buy it:

```sh
HUB=https://hub-production-e85e.up.railway.app
npx -y @countersign-hub/cli discover --hub $HUB
OFFER=$(curl -s $HUB/offers | jq -r '[.offers[] | select(.online and .offer.title=="use-arc")][0].offerHash')
npx -y @countersign-hub/cli buy $OFFER --input '{"question":"what is arc?"}' --hub $HUB
```

It prints the seller's output, `Released. Slip minted.`, the slip hash and the release transaction. When you are signed in, it also prints one line, `[buyer] envelope mirror failed: This wallet signs only through the hub's typed-data route.` The purchase still completes. Open the transaction at `https://explorer.testnet.arc.io/tx/<hash>`. The slip is saved under `~/.countersign/slips/`. Check it yourself, without the hub:

```sh
npx -y @countersign-hub/cli verify ~/.countersign/slips/<slip hash>.json --rpc https://rpc.testnet.arc.network
```

To let an OpenAI SDK buy instead, run `bun packages/buyer/src/cli.ts openai --hub $HUB` from a clone and point the SDK at it: https://github.com/ss251/countersign/blob/main/docs/openai.md
<!-- /get-started:hire -->

From a scratch directory outside this repository, on Node 25 with `@countersign-hub/cli` 0.1.0 from npm, on 07 Nov:

- The shell sequence bought `use-arc`: release [`0x6e03…a382`](https://explorer.testnet.arc.io/tx/0x6e03db12e6bc461ad3e81329bcf44ec6e5cfaf7e465042cc6dc52bcda6f7a382). `countersign verify` read slip `0xcec2…1d5a` as `VALID`.
- An MCP client ran the server exactly as configured above. It listed the six tools and bought `use-arc`: release [`0x6f17…b1c8`](https://explorer.testnet.arc.io/tx/0x6f1754aeb58899c435116962859b9f5ae5f943ea74486b12169d87681ba2b1c8). `verify_slip` found the slip valid, including the on-chain check.

Both used an already funded testnet key, before `login` existed. With `login`, from a clean directory with `npx -y @countersign-hub/cli@0.1.1` on 06 Nov, and no key on the machine:

- A CLI buy on Arc escrow v2 released [`0x2416…995c`](https://explorer.testnet.arc.io/tx/0x241615b59ad44ccb464e81c328d161233fd3d49258fe3fdc94e194de29b2995c), and its slip verified `VALID` with `--rpc`. `countersign mcp`, with no key in its environment, bought and released [`0x1efa…b531`](https://explorer.testnet.arc.io/tx/0x1efac4b4129019519cbcc3a44395827d98ef12e54c026274c68f9569ee64b531).
- On Whitechain, the agent bought `whitechain-dev` in USDT through escrow v2, holding no WBT: fund [`0xdc9e…e00b`](https://explorer.testnet.whitechain.io/tx/0xdc9e6c3be640b6cfbe9be23460dc18d81e8bd253c22798c34ac5e7c82f9fe00b), release [`0x8e49…c615`](https://explorer.testnet.whitechain.io/tx/0x8e497c737aedb2e15139b6ef4d0717226b06294914da34bd56b70368e1e4c615). The merchant then refunded it from the public merchant screen: [`0xe554…2956`](https://explorer.testnet.whitechain.io/tx/0xe55477a5615af49d5653a754062183439aaf7c405e1a8d3d17de3da6d3af2956).

The [buyer guide](guides/buyer.md) covers every flag, and the refusals.

## List your tool

<!-- get-started:list -->
Status: selling a skill or one operation of an API works today with the `countersign` command from npm, and one OpenAPI offer has sold on production. Selling your own MCP server takes a script today; there is no `countersign sell mcp` yet. Buyers pay you in test USDC on Arc testnet.

Sign in with `npx -y @countersign-hub/cli login` as above, then serve a skill: a Markdown file whose front matter has a `name` and a `description`.

```sh
npx -y @countersign-hub/cli sell skill path/to/SKILL.md \
  --hub https://hub-production-e85e.up.railway.app --price 10000
```

Or serve one operation of an API from its OpenAPI spec:

```sh
npx -y @countersign-hub/cli sell openapi --spec path/to/openapi.json --operation <operationId> \
  --hub https://hub-production-e85e.up.railway.app --price 10000
```

- Your offers and slips are signed by your Privy wallet through the hub, so you hold no key. Buyers pay that wallet's address.
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

No production offer carries a seller bond yet, because production runs only unbonded jobs on escrow v2, on both chains. Escrow v2, which adds the bond, is deployed on Arc testnet and Whitechain testnet, and production's Whitechain rail now runs on it, for unbonded jobs only. Under v2 a bonded job pays the seller only through the hub's release. If the hub, or Whitechain's relay, is down for more than 600 seconds past the job's deadline, anyone may refund, and the refund pays the buyer the price plus the bond, even if you delivered.

## What signing in allows

The agent wallet is a Privy server wallet that the countersign app controls, and you hold no key to it. That makes the hub a delegated signer:
- it signs only for a signed-in CLI session;
- it signs only a payment into a known escrow, your offers and slips, or a runner's own messages.

`logout` ends your session, and the hub stops signing for it. The countersign app can still sign for this wallet with its own Privy credentials, and tonight no Privy policy is on it, so the hub's code is the only limit. Logging out ends your CLI's session, not the app's control.

Keep only small testnet amounts in the wallet. Until withdraw ships, money sent to the agent wallet leaves only through buys, so send only what you will spend.

Not yet: a Hedera wallet under the same login, a balance command, and withdrawing back to your own wallet.

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

Run a relay of your own alongside it, from a clone. It pays the gas, and it pays out only to the addresses you name. Hosting one, its settings and its guards are in https://github.com/ss251/countersign/blob/main/docs/whitechain.md#hosting-the-relay

- Fund the relay's address with test WBT at https://faucet.testnet.whitechain.io. The faucet asks you to sign in with GitHub.
- Your customers hold USDT only and never WBT. They pay with `createPayFetch` from `@countersign-hub/relay/browser`, which signs one authorisation per call.
- Test USDT has no faucet. Swapping test WBT on the testnet pool is described at https://github.com/ss251/countersign/blob/main/docs/whitechain.md#getting-test-funds
<!-- /get-started:charge -->

That `shop.mjs`, installed from npm in a scratch directory on Node 25, answered the `402` on 07 Nov. The same paywall runs live as the console's checkout: [`/checkout/sticker-pack`](https://counter-sign.up.railway.app/checkout/sticker-pack) answers `402`. A purchase through it, [`0x59eb…c12b`](https://explorer.testnet.whitechain.io/tx/0x59eb27e66c4a71bf48656e4c0bc00f717e89f43edb23f6abe9282fc7b939c12b), was refunded in full by [`0x3efd…bd6f`](https://explorer.testnet.whitechain.io/tx/0x3efd65a06cdf38a269a008ee12fdbeae2ceff2210f210bae887da327baa7bd6f). [whitechain.md](whitechain.md) covers refunds, the CSV export and the relay's guards.
