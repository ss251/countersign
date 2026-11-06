# Get started

There are three ways in: hire a tool from your agent, list your own tool, or charge for your own API. Each section starts with what works today and what does not.

- **Testnet only.** Every amount on this page is test money, on Arc testnet or Whitechain testnet.
- **Nothing is installable yet.** Every command on this page runs from a clone of this repository with [bun](https://bun.sh) 1.3. The installable packages, the `countersign` command and the MCP server for Claude and Cursor are being built, and this page changes when each one runs for real.
- **Do not install from npm.** On npm, the packages `countersign` and `countersign-mcp` and the `@countersign` scope belong to other projects, so any of those names installs someone else's code. None of countersign's own packages are on npm yet.
- **The hub** in every command is the production hub, `https://hub-production-e85e.up.railway.app`.

Every path assumes a clone:

```sh
git clone https://github.com/ss251/countersign
cd countersign
bun install --frozen-lockfile
```

The commands also use `jq` and `openssl`.

## Hire a tool from your agent

<!-- get-started:hire -->
Status: works today from a clone, on Arc testnet with test USDC. The MCP server for Claude and Cursor is not built yet. Until it is, your agent buys through the buyer CLI, or through its OpenAI-compatible endpoint.

Make a testnet key and set the agent's limits. The agent signs nothing without them.

```sh
export CS_BUYER_KEY=0x$(openssl rand -hex 32)
bun packages/buyer/src/cli.ts envelope set --cap 0.5 --per-merchant 0.1
bun packages/buyer/src/cli.ts envelope show
```

- The key exists only in this shell. Keep it privately if you want to spend the test funds again.
- `agent` in the output is the address to fund. At https://faucet.circle.com choose Arc Testnet and USDC, then paste that address.
- On Arc the hub pays the gas, so USDC is all the agent needs.

Find an online offer and buy it:

```sh
HUB=https://hub-production-e85e.up.railway.app
bun packages/buyer/src/cli.ts discover --hub $HUB
OFFER=$(curl -s $HUB/offers | jq -r '[.offers[] | select(.online and .offer.title=="use-arc")][0].offerHash')
bun packages/buyer/src/cli.ts buy $OFFER --input '{"question":"what is arc?"}' --hub $HUB
```

It prints the seller's output, `Released. Slip minted.`, the slip hash and the release transaction. Open the transaction at `https://explorer.testnet.arc.io/tx/<hash>`. The slip is saved under `~/.countersign/slips/`. Check it yourself, without the hub:

```sh
bun packages/verify/src/cli.ts ~/.countersign/slips/<slip hash>.json --rpc https://rpc.testnet.arc.network
```

To let an OpenAI SDK buy instead, run `bun packages/buyer/src/cli.ts openai --hub $HUB` and point the SDK at it: https://github.com/ss251/countersign/blob/main/docs/openai.md
<!-- /get-started:hire -->

This exact sequence ran from a fresh clone of `main` at `25e8104` on 07 Nov, with an already funded testnet key and a fresh state directory. Its release is [`0x4acc…994e`](https://explorer.testnet.arc.io/tx/0x4accfeb980378f4b2d16dd32b1c6bf44c0cd791516620c75ac95b081de06994e), and slip `0x128c50097ac43684b547458c94e3754402ba6d8c0d9175b8c402a4d31d3bcbf2` checks `VALID`, including the on-chain check. The [buyer guide](guides/buyer.md) covers every flag, and the refusals.

## List your tool

<!-- get-started:list -->
Status: selling a skill works today from a clone. Selling an OpenAPI operation is on main, and one OpenAPI offer has sold on production. Selling your own MCP server takes a script today; the one command for it is not built yet. Buyers pay you in test USDC on Arc testnet.

Make a seller key and serve a skill: a Markdown file whose front matter has a `name` and a `description`.

```sh
export CS_SELLER_KEY=0x$(openssl rand -hex 32)
bun packages/runner/src/cli.ts serve --hub https://hub-production-e85e.up.railway.app \
  --skill path/to/SKILL.md --price 10000
```

Or serve one operation of an API from its OpenAPI spec:

```sh
bun packages/runner/src/cli.ts serve --hub https://hub-production-e85e.up.railway.app \
  --openapi path/to/openapi.json --operation <operationId> --price 10000
```

- The runner dials out to the hub, so you open no port.
- `--price` is in atomic units: `10000` is 0.01 USDC.
- The runner prints `published <offer hash> <title>`, then `runner ready`. The offer is online only while the runner runs.
- You need no funds to sell. The hub pays the release gas, and the payment goes to your seller address.
- Every offer you publish is listed publicly at `https://hub-production-e85e.up.railway.app/offers`.
<!-- /get-started:list -->

Both commands ran from the same clone on 07 Nov against a hub started from that clone, and each printed its offer hash and `runner ready`. The [seller guide](guides/seller.md) covers every flag. The runner's `mcp` adapter already serves one production offer, Hedera's Agent Kit, which [hedera.md](hedera.md#the-hedera-agent-kit-as-a-metered-offer) describes.

No production offer carries a seller bond yet, because the escrows on production are v1. Escrow v2, which adds the bond, is deployed on Whitechain testnet, but production does not use it yet. Under v2 a bonded job pays the seller only through the hub's release. If the hub, or Whitechain's relay, is down for more than 600 seconds past the job's deadline, anyone may refund, and the refund pays the buyer the price plus the bond, even if you delivered.

## Charge for your own API in USDT

<!-- get-started:charge -->
Status: the paywall works today from a clone, on Whitechain testnet with test USDT. Two limits apply. The package exists only inside this repository until it is released. Do not install `@countersign/*` from npm: that scope belongs to another project. This relay's release name is `@countersign-hub/relay`, imported from `@countersign-hub/relay/paywall`. It is not published yet, so install nothing under it from npm until this page says where the release is. The hosted relay pays gas for its own merchant only, so you run a relay of your own.

Put one route behind the paywall. Save this as `mine/shop.ts` inside the clone:

```ts
import { Hono } from "hono";
import { whitechainPaywall } from "@countersign/relay"; // the workspace package: it resolves only inside this clone

const app = new Hono();
app.get(
  "/report",
  whitechainPaywall({ price: "0.01", payTo: "0xYourAddress", facilitator: "http://127.0.0.1:8402" }),
  (c) => c.json({ report: "what you paid for" }),
);

export default app;
```

```sh
PORT=3000 bun mine/shop.ts
curl -i http://127.0.0.1:3000/report
```

The call answers `402 Payment Required` with an x402 v2 `exact` offer of 0.01 USDT on `eip155:1874`.

Run your relay alongside it. It pays the gas, and it pays out only to the addresses you name:

```sh
export WC_RELAYER_PRIVATE_KEY=0x$(openssl rand -hex 32)
RELAY_PAYEES=0xYourAddress bun packages/relay/src/server.ts
curl -s http://127.0.0.1:8402/status | jq -r .address
```

- Fund that relay address with test WBT at https://faucet.testnet.whitechain.io. The faucet asks you to sign in with GitHub.
- Your customers hold USDT only and never WBT. They pay with `createPayFetch` from `@countersign/relay/browser`, which signs one authorisation per call.
- Test USDT has no faucet. Swapping test WBT on the testnet pool is described at https://github.com/ss251/countersign/blob/main/docs/whitechain.md#getting-test-funds
<!-- /get-started:charge -->

The route above answered that `402` from a fresh clone of `main` on 07 Nov. The same paywall runs live as the console's checkout: [`/checkout/sticker-pack`](https://web-production-a58de.up.railway.app/checkout/sticker-pack) answers `402`. A purchase through it, [`0x59eb…c12b`](https://explorer.testnet.whitechain.io/tx/0x59eb27e66c4a71bf48656e4c0bc00f717e89f43edb23f6abe9282fc7b939c12b), was refunded in full by [`0x3efd…bd6f`](https://explorer.testnet.whitechain.io/tx/0x3efd65a06cdf38a269a008ee12fdbeae2ceff2210f210bae887da327baa7bd6f). [whitechain.md](whitechain.md) covers refunds, the CSV export and the relay's guards.
