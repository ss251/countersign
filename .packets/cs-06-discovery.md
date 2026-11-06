# cs-06-discovery — the hub publishes discovery metadata: Bazaar list, A2A card, skills index, OpenAPI

## Setup

Run `bun install` at the worktree root before anything else.

## Goal

Make the hub discoverable by any x402 client, in the same formats Circle's public discovery API uses:

- an x402 Bazaar resource list;
- the Bazaar extension on every 402;
- an A2A agent card;
- a skills index;
- an OpenAPI 3.1 document.

An agent that reads Circle's catalogue at `https://api.circle.com/v2/x402/discovery/resources` must be able to read the hub's list with the same code.

## Facts

- Circle's discovery API, read live on 06 Nov, returns `{"data": {"x402Version": 2, "items": [...], "pagination": {"limit": 200, "offset": 0, "total": 2780}}}`.
- Each item looks like this:

  ```
  {
    "resource": "https://<host>/<path>",
    "type": "http",
    "x402Version": 2,
    "lastUpdated": "<ISO time>",
    "accepts": [<x402 v2 PaymentRequirements>],
    "metadata": {
      "provider": {"name", "website", "docsUrl", "description", "category", "tags": [...]},
      "path": "/<path>",
      "method": "POST",
      "description": "...",
      "mimeType": "application/json",
      "input": {"body": <JSON Schema>},
      "output": {...}
    }
  }
  ```
- `@x402/extensions@2.30.0` is installed. It exports `declareDiscoveryExtension`, and the types `DiscoveryResource` and `DiscoveryResourcesResponse`, among others. Read `node_modules/@x402/extensions/dist/cjs/index-*.d.ts` for the exact shapes, and use `declareDiscoveryExtension` to build the `bazaar` extension for a POST body route.

## Lease

You may create or change only these paths:

- `apps/hub/src/discovery.ts` (new)
- `apps/hub/src/openapi.ts` (new)
- `apps/hub/src/app.ts`: register the new routes only
- `apps/hub/src/call.ts`: add `extensions` to the 402 body only
- `apps/hub/test/discovery.test.ts` (new)
- `.packets/reports/cs-06-discovery.md`

Do not edit any `package.json`, `bun.lock`, `packages/**`, other hub files or anything else.

## Read first

- `apps/hub/src/app.ts`, `apps/hub/src/call.ts` and `apps/hub/src/store.ts`.
- `apps/hub/test/support.ts` and `apps/hub/test/fake-rail.ts`, the existing test harness to reuse.
- `packages/core/src/types.ts`: `Offer` and `PaymentRequired`, whose `extensions` field now exists.

## What to build

All the routes below are GET, CORS-open, and list only offers that are listed, never delisted ones. Each item's `accepts` comes from calling `rail.challenge(offer, {resource, now})` for every configured rail that the offer lists, exactly as the 402 does. Factor that into one shared helper in `discovery.ts`, and make `call.ts` use the same helper so the two cannot drift.

1. `GET /discovery/resources?limit=<1..200, default 50>&offset=<default 0>&query=<text>` returns `{data: {x402Version: 2, items, pagination: {limit, offset, total}}}`.
   - `query` matches title, summary or adapter, case-insensitively.
   - Each item:
     - `resource` is `${publicUrl}/offers/${offerHash}/call`, `type` is `"http"`, `x402Version` is 2, and `lastUpdated` is the ISO time of `offer.issuedAt`;
     - `accepts` comes from the helper;
     - `metadata.provider` is `{name: "countersign", website: publicUrl, docsUrl: publicUrl + "/openapi.json", description: "Escrowed, countersigned x402 calls to software that sells itself.", category: "INFRASTRUCTURE", tags: ["x402", "escrow", offer.adapter, ...offer.rails]}`;
     - `metadata.path` is `/offers/${offerHash}/call`, `metadata.method` is `"POST"`, `metadata.description` is `offer.summary || offer.title`, and `metadata.mimeType` is `"application/json"`;
     - `metadata.input` is `{body: offer.input}` and `metadata.output` is `{schema: offer.output}`;
     - `metadata.offerHash` and `metadata.upstream` are included when the offer has them.
2. The 402 body gets an `extensions` field holding the result of `declareDiscoveryExtension(...)` for a POST JSON body. Use the offer's input schema and output schema, with an example input built from the schema's property names, and string fields set to `"example"`. The 402 behaviour must not change otherwise, and every existing hub test must still pass.
3. `GET /.well-known/agent-card.json`, also served at `/.well-known/agent.json`, returns an A2A AgentCard:
   - `protocolVersion: "0.3.0"`, `name: "countersign hub"`, `description`, `url: publicUrl`, `version: "0.1.0"`;
   - `provider: {organization: "countersign", url: publicUrl}`, `capabilities: {streaming: false, pushNotifications: false}`;
   - `defaultInputModes` and `defaultOutputModes` are both `["application/json"]`;
   - `skills`: one per offer, `{id: offerHash, name: title, description: summary or title, tags: [adapter, ...rails], inputModes: ["application/json"], outputModes: ["application/json"]}`;
   - `additionalInterfaces: [{url: publicUrl + "/discovery/resources", transport: "x402-bazaar"}, {url: publicUrl + "/openapi.json", transport: "openapi"}]`.
4. `GET /.well-known/skills/index.json` returns `{version: 1, skills: [...]}`, one entry per offer with `adapter === "skill"`: `{name: title, description: summary, offerHash, price: {amount: offer.price, decimals: 6, currency: "USD stablecoin"}, call: <resource url>, upstream?: offer.upstream, rails: offer.rails}`.
5. `GET /openapi.json` returns an OpenAPI 3.1.0 document:
   - `info: {title: "countersign hub", version: "0.1.0", description}` and `servers: [{url: publicUrl}]`;
   - generic paths `/offers`, `/offers/{offerHash}`, `/offers/{offerHash}/call`, `/slips/{slipHash}`, `/jobs/{jobId}`, `/discovery/resources` and `/rails`, each with a short summary. The call operation documents:
     - request body `{input: object, lineage?: string[]}`;
     - response 200 `{output, slip}`;
     - response 402 with header `PAYMENT-REQUIRED` and body `PaymentRequired`;
     - responses 422 and 503;
     - a header parameter `PAYMENT-SIGNATURE`.
   - For each listed offer, an explicit path `/offers/<hash>/call` whose POST has `summary: title`, request body schema `{type: "object", properties: {input: offer.input}, required: ["input"]}`, a 200 schema whose `output` property is `offer.output`, and an `x-x402-accepts` array taken from the helper.

## Tests (`apps/hub/test/discovery.test.ts`)

Reuse the existing harness: a FakeRail, one published skill offer and one non-skill offer. Check that:

- `/discovery/resources` has the Circle shape;
- `items[0].accepts` equals the `accepts` of an unpaid call's 402, deep-equal;
- `metadata.input.body` deep-equals `offer.input`;
- pagination and `query` work;
- the 402 body has `extensions.bazaar`;
- the agent card has one skill per offer, and both paths serve it;
- the skills index lists only the skill offer;
- the OpenAPI document has `openapi: "3.1.0"`, the generic call path and one explicit path per offer;
- a delisted offer appears nowhere.

## Constraints

- **Never launch a browser of any kind on this machine**: no Chrome or Chromium, headless or not, no Playwright, Puppeteer or screenshot tools. UI checks go back to the lane, which raises NEEDS-BROWSER.
- No network calls in tests. Never call Circle's API from the hub.
- TypeScript strict, no `any`. Keep files under about 250 lines.

## Acceptance

From the worktree root:

```
bun install && bun run typecheck && bun test apps/hub && bun test && forge test
```

Every command passes, with no skipped tests.

## Stop conditions

- You need to edit outside the lease: stop and write the report.
- One problem has blocked you for more than 20 minutes: stop, commit what passes, and write the report.

## Finish

Commit on your branch with small present-tense messages and no trailers. Write `.packets/reports/cs-06-discovery.md`. Do not push, merge or deploy.
