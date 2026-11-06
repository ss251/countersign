# Discovery

The hub publishes what it sells in the formats x402 clients already read. Code: `apps/hub/src/discovery.ts` and `apps/hub/src/openapi.ts`.

| Route | Format | Contents |
|---|---|---|
| `GET /discovery/resources?limit&offset&query` | x402 Bazaar list, in the same response shape as Circle's public discovery API (`{data: {x402Version, items, pagination}}`) | One item per listed offer: the paid resource URL, its `accepts` (built by the same helper the 402 uses, so the two never drift), provider, path, method, and the offer's input and output schemas |
| every `402` | x402 v2 `PaymentRequired` with an `extensions.bazaar` entry | The discovery extension declared with `@x402/extensions`, describing the POST body and output |
| `GET /.well-known/agent-card.json` (and `/.well-known/agent.json`) | A2A agent card, protocol 0.3.0 | One skill per offer; interfaces for the Bazaar list and OpenAPI |
| `GET /.well-known/skills/index.json` | skills index | The `skill` offers with price, upstream and rails |
| `GET /openapi.json` | OpenAPI 3.1 | Generic routes, plus one explicit `POST /offers/<hash>/call` per listed offer with that offer's input and output schemas |

Circle's catalogue (`https://api.circle.com/v2/x402/discovery/resources`) is public and needs no key. On 06 Nov it listed 2,780 resources, none of them on a testnet. Services enter it through the facilitator that settles them. So these routes make the hub readable by the same client code that reads Circle's catalogue; they do not by themselves place a testnet hub in that catalogue.
