# Discovery

The hub publishes what it sells in the formats x402 clients already read. Code: `apps/hub/src/discovery.ts` and `apps/hub/src/openapi.ts`.

| Route | Format | Contents |
|---|---|---|
| `GET /discovery/resources?limit&offset&query` | x402 Bazaar list, in the same response shape as Circle's public discovery API (`{x402Version, items, pagination}`), with its `category` and `type` filters. A `query` holding an offer's hash, such as its resource URL, finds that offer | One item per listed offer: the paid resource URL, its `accepts` (built by the same helper the 402 uses, so the two never drift), provider, path, method, and the offer's input and output schemas |
| every `402` | x402 v2 `PaymentRequired` with an `extensions.bazaar` entry | The discovery extension declared with `@x402/extensions`, describing the POST body as it is sent, `{input, lineage?}`, and the output |
| `GET /.well-known/agent-card.json` (and `/.well-known/agent.json`) | A2A agent card, protocol 0.3.0 | One skill per offer; interfaces for the Bazaar list and OpenAPI |
| `GET /.well-known/skills/index.json` | skills index | The `skill` offers with price, upstream and rails |
| `GET /openapi.json` | OpenAPI 3.1 | Generic routes, plus one explicit `POST /offers/<hash>/call` per listed offer with that offer's input and output schemas |

Circle's catalogue (`https://api.circle.com/v2/x402/discovery/resources`) is public and needs no key. On 06 Nov it listed 2,780 resources, none of them on a testnet. Services enter it through the facilitator that settles them. So these routes make the hub readable by the same client code that reads Circle's catalogue; they do not by themselves place a testnet hub in that catalogue.

## The Circle CLI and the buyer read the same lists

`@circle-fin/cli` 1.2.3 reads its catalogue from `CIRCLE_DISCOVERY_URL`, so it reads a hub directly:

```sh
export CIRCLE_DISCOVERY_URL=http://127.0.0.1:8787/discovery/resources
circle services search             # the hub's offers
circle services inspect <callUrl>  # provider, input schema, price, which options the CLI can pay
```

Neither command needs a Circle login. `inspect` looks the URL up with `?query=<url>&limit=1`, which is why a query holding an offer hash finds that offer, then posts a probe body built from `metadata.input.body`, which is why that schema is the wire body `{input, lineage?}`. Of a hub's options, the CLI can pay the Circle Gateway one (`GATEWAY_RAIL=1`) and not the countersign escrow, which needs the buyer's countersignature.

The buyer reads any such catalogue, Circle's included, and marks what it would pay. Only an escrow or Gateway pinned in `packages/buyer/src/known-rails.ts` counts; a listing never adds a rail. A hub call URL from a catalogue can be bought directly, and the offer is still re-read from its hub and hashed:

```sh
bun packages/buyer/src/cli.ts discover --catalogue circle "web search" --limit 20
bun packages/buyer/src/cli.ts discover --catalogue http://127.0.0.1:8787/discovery/resources
bun packages/buyer/src/cli.ts buy http://127.0.0.1:8787/offers/<offerHash>/call --input '{}'
```

`bun scripts/circle/interop.ts --hub <url>` is the scripted proof. Against a hub with an online offer it checks the CLI's contract in process (list shape, lookup by URL, probe to a 402, which options the CLI can pay), reads Circle's catalogue through the buyer, and, when `circle` is on `PATH` or named by `CIRCLE_CLI`, runs the real `services search` and `services inspect` against the hub. It reads only; nothing is signed or paid.
