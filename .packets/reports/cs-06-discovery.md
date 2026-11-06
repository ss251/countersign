# cs-06-discovery report

## What was built

The hub now publishes the same discovery metadata formats Circle's public x402 catalogue uses:

- `apps/hub/src/discovery.ts`
  - `challengeOptions(rails, offer, resource, now)` / `acceptsFor(...)`: one shared builder that calls `rail.challenge` for every configured rail the offer lists, in offer order. `call.ts` uses it for the 402 and every discovery route uses it too.
  - `bazaarExtension(offer)`: wraps `declareDiscoveryExtension` with `bodyType: "json"`, an example body (`{ <property>: "example" }` for each input schema property), the offer input as `inputSchema`, and the offer output as the discovery output schema.
  - `listResources`: `GET /discovery/resources` shaped as `{data: {x402Version, items, pagination}}`, Circle-style. `limit` defaults to 50 and clamps to 1..200, `offset` defaults to 0, and `query` matches title, summary or adapter case-insensitively before pagination.
  - `agentCard`: A2A 0.3.0 card with one skill per listed offer, `x402-bazaar` and `openapi` additional interfaces.
  - `skillsIndex`: one entry per `adapter === "skill"` offer, with price, call URL, rails and upstream when present.
- `apps/hub/src/openapi.ts`
  - OpenAPI 3.1.0 document: `info`, `servers`, the seven generic paths with summaries, the shared `PaymentRequired` component, and one explicit `POST /offers/<hash>/call` per listed offer with its input schema, output schema and `x-x402-accepts`.
- `apps/hub/src/app.ts`
  - Registers `GET /discovery/resources`, `GET /.well-known/agent-card.json`, `GET /.well-known/agent.json`, `GET /.well-known/skills/index.json` and `GET /openapi.json`. The existing global CORS middleware covers them.
- `apps/hub/src/call.ts`
  - Replaces its private rail loop with the shared `challengeOptions` helper and adds `extensions: bazaarExtension(offer)` to the 402 body (header included, since the header encodes the same body). No other 402 behaviour changed.
- `apps/hub/test/discovery.test.ts`
  - Circle shape, accepts deep-equal to an unpaid 402, metadata input equality, pagination, title/summary/adapter query matching, `extensions.bazaar`, both agent-card paths, the skills index, the OpenAPI generic and explicit paths, and a delisted offer appearing in none of the surfaces.

## Design decisions

- Every new route reads `store.listOffers()` with its default (listed only), so delisted offers never leak into the catalogue, agent card, skills index or OpenAPI.
- All `accepts` arrays come from `challengeOptions`, so the 402, discovery list and OpenAPI `x-x402-accepts` cannot drift.
- The discovery item type is defined locally rather than reusing `DiscoveryResource` from `@x402/extensions`, because that package's `PaymentRequirements` requires `extra` while the hub's own type keeps it optional; the wire shape still matches Circle's.
- `lastUpdated` is `new Date(offer.issuedAt * 1000).toISOString()`.
- `declareDiscoveryExtension` drops `output.schema` unless an output example is supplied; the call passes the output schema as specified, and the 402 extension therefore carries the input body example and input schema.

## Acceptance output

```
$ bun install
bun install v1.3.14 (0d9b296a)

Checked 72 installs across 93 packages (no changes) [85.00ms]

$ bun run typecheck
$ tsc -p tsconfig.json
(no output; exit 0)

$ bun test apps/hub
 20 pass
 0 fail
 156 expect() calls
Ran 20 tests across 4 files. [392.00ms]

$ bun test
 97 pass
 0 fail
 402 expect() calls
Ran 97 tests across 17 files. [2.90s]

$ forge test
Ran 3 test suites in 152.31ms (87.81ms CPU time): 29 tests passed, 0 failed, 0 skipped (29 total tests)
```

No tests are skipped.

## Not done

Nothing in the packet was left undone. No pushes, merges or deploys, and no browser was launched.
