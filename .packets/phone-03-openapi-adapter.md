# phone-03-openapi-adapter: the runner serves an offer backed by an OpenAPI operation (refs #167)

## Goal

The runner serves an offer backed by an OpenAPI operation, as the skill and mcp adapters already do. A seller names a local OpenAPI 3 JSON document and one `operationId`. The runner builds an offer whose input and output schemas come from that operation, publishes it, and serves each paid job by calling that operation over HTTP on the seller's own server. The call happens inside the same scrubbed child process the other adapters use, and the runner returns the JSON answer.

## Read first

- `packages/runner/src/child.ts`: `ChildSpec`, `runInChild`, the scrubbed child.
- `packages/runner/src/child-entry.ts`: how the child parses a spec and dispatches on `spec.adapter`.
- `packages/runner/src/skill.ts`: `skillOffer`, the model for building an offer.
- `packages/runner/src/mcp.ts` and `packages/runner/test/mcp.test.ts`: the model for an adapter, its output envelope (with `inputHash`) and its tests.
- `packages/runner/src/cli.ts`: `publish` and `serve`, and how `--skill` becomes a served offer.
- `packages/runner/src/publish.ts`: the stable `issuedAt`, keyed by `skillSha256`.
- `packages/runner/test/daemon.test.ts`: the stand-in hub over WebSocket that the runner's end-to-end tests use.
- `packages/core/src/offer.ts` (`assertOffer`), `packages/core/src/schema.ts` (`assertSchema`, `checkSchema`), `packages/core/src/canonical.ts` (canonical JSON allows safe integers only, never floats).

## What to build

### 1. `packages/runner/src/openapi.ts` (new)

- **The spec type.** Export it as follows. `baseUrl` is resolved when the offer is built: the seller's `--base-url`, otherwise the document's `servers[0].url`. It must be `http:` or `https:`.

  ```ts
  export interface OpenApiSpec {
    adapter: "openapi";
    specPath: string;
    operationId: string;
    baseUrl: string;
  }
  ```

- **`readOperation(specPath, operationId)`** reads the JSON document and returns `{ method, path, operation, document }` for the one operation with that `operationId`.
  - Accept only a document whose `openapi` field starts with `"3."`.
  - Methods are `get`, `post`, `put`, `patch` and `delete`.
  - Resolve local `$ref`s of the form `#/components/schemas/<name>` inline, including nested ones, and refuse a cycle.
  - Refuse each of these with an `Error` whose message is exactly:
    - unknown operation: `Refused. The OpenAPI document has no operation <id>.`
    - the same `operationId` twice: `Refused. The OpenAPI document repeats operation <id>.`
    - a `header` or `cookie` parameter: `Refused. Header and cookie parameters are not supported.`
    - a path or query parameter whose schema type is not `string`, `integer`, `number` or `boolean`: `Refused. Parameter <name> must be a string, number, integer or boolean.`
    - a request body without an `application/json` schema: `Refused. The request body must be application/json.`
    - any `$ref` that is not a local `#/components/schemas/...` reference: `Refused. Only local component references are supported.`
    - a document that is not OpenAPI 3: `Refused. Only OpenAPI 3 JSON documents are supported.`

- **`openApiInputSchema(op)`** returns a JSON Schema object:
  - `type: "object"` and `additionalProperties: false`;
  - one property per path or query parameter, named after it and carrying its schema;
  - a `body` property holding the request body's JSON schema, when the operation has a body;
  - `required` lists every path parameter, every query parameter marked `required: true`, and `body` when `requestBody.required` is true.

- **`openApiOutputSchema(op)`** returns:
  - `type: "object"`;
  - `required: ["operationId", "status", "inputHash", "result"]`;
  - `additionalProperties: false`;
  - the properties `operationId: { const: <id> }`, `status: { type: "integer" }` and `inputHash: { type: "string", pattern: "^0x[0-9a-f]{64}$" }`;
  - `result`: the `application/json` schema of the operation's `200` response, else of its `201` response, else `{}`.

- **`openApiOffer(args)`**, shaped like `skillOffer`, takes `{ seller, document path or parsed operation, operationId, price, deadline, rails, now, payTo?, upstream?, ens? }` and returns an `Offer`:
  - `adapter: "openapi"`;
  - `title`: the operation's `summary`, else its `operationId`, cut to 120 characters;
  - `summary`: its `description`, else its `summary`, else `""`, cut to 2000 characters;
  - `input` and `output` from the two functions above;
  - `bond: "0"`.

  It must pass `assertOffer`, and both schemas must pass `assertSchema`.

- **`runOpenApi(spec, input)`** makes the call.
  - Refuse an input that is not a plain object: `The input must be a JSON object.`
  - Build the URL as `baseUrl` (trailing `/` trimmed) plus the path, with each `{name}` replaced by `encodeURIComponent(String(input[name]))`.
    - A buyer must never change the path: an `id` of `../admin?x=1` stays one encoded segment.
    - Append query parameters present in the input with `URLSearchParams`.
  - Send `input.body` as JSON, with `content-type: application/json`, when the operation has a request body and the input carries `body`. Always send `accept: application/json`.
  - Send no cookies and no auth headers, use `redirect: "error"`, and put no environment value into the request.
  - Answer each failure with exactly this message:
    - a non-2xx status: `Refused. The operation answered <status>.`, with no response body in the message;
    - a 2xx answer that is not JSON, other than a `204` or an empty body: `Refused. The operation did not answer JSON.`;
    - a redirect, or a network error: `Refused. The operation could not be reached.`;
    - an answer containing any number that is not a safe integer, at any depth: `Refused. The response holds a number canonical JSON cannot carry.` Canonical JSON cannot hash floats, so this must be an explicit refusal, never a crash.
  - On success, return `{ operationId, status, inputHash: canonicalHash(input), result }`, where `result` is the parsed JSON, or `null` for a `204` or an empty body.

### 2. Wire it into the child

- `packages/runner/src/child.ts`: `ChildSpec = SkillSpec | McpSpec | OpenApiSpec`. Change nothing else there.
- `packages/runner/src/child-entry.ts`:
  - dispatch `adapter === "openapi"` to `runOpenApi`;
  - add `parseOpenApi`, which checks that `specPath`, `operationId` and `baseUrl` are strings and that the base URL is `http:` or `https:`, and otherwise throws `The child request is malformed.`;
  - update the file's header comment.
- `packages/runner/src/index.ts`: export `readOperation`, `openApiOffer`, `openApiInputSchema`, `openApiOutputSchema`, `runOpenApi` and `type OpenApiSpec`.

### 3. The CLI

In `packages/runner/src/cli.ts`, `publish` and `serve` take `--openapi <spec.json> --operation <operationId> [--base-url <url>]`, beside or instead of `--skill`:

- each `--openapi` pairs, in order, with the next `--operation`, and with `--base-url` when one is given;
- the existing `--price`, `--deadline`, `--rails`, `--pay-to`, `--upstream-url` and `--licence` flags apply to these offers as they do to skills;
- the stable `issuedAt` uses `skillSha256` = sha256 of the spec file's bytes followed by `\n` and the `operationId`, so a restart republishes the same offer hash;
- update the usage lines in the header comment.

### 4. Core: one comment line

In `packages/core/src/types.ts`, the comment above `AdapterKind` says `"openapi"` is not built. Change it to say the runner serves `skill`, `mcp` and `openapi`. Change nothing else in core.

## Tests: `packages/runner/test/openapi.test.ts` (new)

All tests are offline: a local Bun server on port 0, and nothing on the internet.

**Fixture.** Write `packages/runner/test/fixtures/invoices.openapi.json`, an OpenAPI 3.1 document with:
- `getInvoice`: `GET /invoices/{id}`, with a string path parameter `id`. Its 200 response schema is `$ref: "#/components/schemas/Invoice"`, where `Invoice` is `{ id: string, amount: string, status: string }`.
- `createInvoice`: `POST /invoices`, with a required JSON body `{ amount: string, memo?: string }` and a 201 response of `Invoice`.

The test server implements both, records each request path and body, and answers `404` for an unknown id. Add one route that answers a float, such as `{ "amount": 1.5 }`, for the canonical-JSON refusal. Bind a separate operation to it, either in the same fixture or in a second small document.

Write these tests:

1. **Offer.** `openApiOffer` passes `assertOffer`, and both schemas pass `assertSchema`. For `getInvoice`, `input.required` contains `id`; for `createInvoice`, it contains `body`. The output schema's `result` is the resolved `Invoice` schema, with no `$ref` left in it.
2. **Each refusal in `readOperation`.** Use small inline documents written to a temp directory:
   - unknown operation;
   - repeated operation;
   - header parameter;
   - an object-typed query parameter;
   - a non-JSON body;
   - an external `$ref`;
   - a Swagger 2 document.
3. **Through the child.** `runInChild({ adapter: "openapi", ... }, { id: "inv_1" }, limits)` returns `{ operationId: "getInvoice", status: 200, inputHash: canonicalHash(input), result: <the server's JSON> }`, and the output passes `checkSchema(offer.output, output)`.
4. **POST.** `createInvoice` with `{ body: { amount: "2500" } }` reaches the server with that JSON body and returns status 201.
5. **The path cannot be changed.** An `id` of `../admin?x=1` reaches the server as one encoded segment, `/invoices/..%2Fadmin%3Fx%3D1`, and never as `/admin`.
6. **A non-2xx answer** rejects with `The operation answered 404`.
7. **A float in the answer** rejects with `canonical JSON cannot carry`.
8. **End to end.** Use `startRunner` against a stand-in hub WebSocket, as in `daemon.test.ts`, with no `funding` config, so no chain read. Serve the openapi offer, send one job frame, and receive a `result` frame whose `slip.body.outputHash` equals `canonicalHash(output)` and whose `output.result` equals the server's JSON.
9. **CLI.** Pure tests of the argument parsing, if the CLI exposes a parse function. If it does not, test that `--openapi` and `--operation` pair in order, through whatever small exported helper you add.

## Lease

Touch only these paths. Nothing else.

- `packages/runner/src/openapi.ts` (new)
- `packages/runner/src/child.ts`
- `packages/runner/src/child-entry.ts`
- `packages/runner/src/cli.ts`
- `packages/runner/src/index.ts`
- `packages/runner/test/openapi.test.ts` (new)
- `packages/runner/test/fixtures/invoices.openapi.json` (new), plus at most one more small fixture document
- `packages/core/src/types.ts`: the one comment line above `AdapterKind`
- `.packets/reports/phone-03-openapi-adapter.md` (new)

## Constraints

- **No new dependency.** Do not add a YAML parser or an OpenAPI library, and do not edit any `package.json` or `bun.lock`. Use `fetch` and the JSON parser that already exists.
- **No browser of any kind on this machine.** No headless Chrome, Playwright, Puppeteer or screenshot tools.
- **No network beyond `127.0.0.1`** in tests.
- **Do not rewrite, weaken, skip or delete any existing test to make the suite pass.** If an existing test breaks, fix the code. If you cannot, stop and write the root cause in the report.
- **No widening.** Build exactly what is above. Leave out these and anything like them:
  - auth headers or security schemes;
  - YAML;
  - multiple operations per offer;
  - streaming.
- **Keep the existing adapters behaving exactly as they do now.**
- **Do not push, merge, deploy or touch any key.**

## Acceptance

Run this from the worktree root. It must be green:

```
bun run typecheck && bun test packages/runner && bun test packages/core
```

Then run the full `bun test` once. Report its pass, skip and fail counts, and name any test that fails outside `packages/runner`.

## Stop conditions

- If one problem has blocked you for more than 15 minutes, stop, commit what passes, and write the report.
- If the code you need to change is outside the lease, stop and say so in the report.

## Commits and report

- Commit with small present-tense messages, each ending `(refs #167)`, with no trailers.
- Write `.packets/reports/phone-03-openapi-adapter.md`. It holds what you built, the test list with its counts, the full-suite counts, and anything you were unsure of.
