# phone-03-openapi-adapter

## What was built

- `packages/runner/src/openapi.ts` (new):
  - `OpenApiSpec`, `OpenApiOperationRef`, `OpenApiOutput` and `OpenApiOfferArgs`.
  - `readOperation`: reads an OpenAPI 3 JSON document, finds one `operationId`, merges path-level parameters, resolves local `#/components/schemas/...` refs (nested, with cycle refusal), and applies every refusal message from the packet.
  - `openApiInputSchema` / `openApiOutputSchema`: the offer's input and output envelopes, including the `operationId`/`status`/`inputHash`/`result` output shape and the `200`-then-`201` response schema fallback.
  - `openApiOffer`: builds the offer with the summary/title and description/summary truncation rules and `bond: "0"`.
  - `baseUrlFor`: the seller's override, else `servers[0].url`, restricted to `http:`/`https:`.
  - `runOpenApi`: builds the URL with encoded path parameters (dot-only values are encoded so a buyer cannot climb the path), sends query parameters via `URLSearchParams`, posts `input.body` as JSON when the operation declares a request body, uses `redirect: "error"`, sends no cookies or auth, and applies the non-2xx / non-JSON / unreachable / unsafe-number refusals.
- `packages/runner/src/child.ts`: `ChildSpec` now includes `OpenApiSpec`; nothing else changed.
- `packages/runner/src/child-entry.ts`: dispatches `openapi` to `runOpenApi`, adds `parseOpenApi` with the string and `http:`/`https:` checks, and updates the header comment.
- `packages/runner/src/cli.ts`: `publish` and `serve` accept repeated `--openapi <spec.json> --operation <id> [--base-url <url>]` entries, paired in order with the next `--operation`; `--base-url` may precede or follow its `--openapi`. The existing price/deadline/rails/pay-to/upstream/licence flags apply. The stable `issuedAt` key is sha256 of the spec bytes, a newline and the `operationId`.
- `packages/runner/src/index.ts`: exports `readOperation`, `openApiOffer`, `openApiInputSchema`, `openApiOutputSchema`, `runOpenApi` and `OpenApiSpec`.
- `packages/core/src/types.ts`: only the `AdapterKind` comment line changed.

## Tests

`packages/runner/test/openapi.test.ts` (new) — 19 pass, 0 fail, 40 expect calls:

1. Offer: `assertOffer`, `assertSchema`, title/summary, `getInvoice` requires `id`, and the resolved `Invoice` result schema has no `$ref`.
2. Offer: `createInvoice` requires `body` and carries the body schema.
3. `readOperation` refuses an unknown operation.
4. `readOperation` refuses a repeated operation.
5. `readOperation` refuses a header parameter.
6. `readOperation` refuses an object-typed query parameter.
7. `readOperation` refuses a non-JSON request body.
8. `readOperation` refuses an external `$ref`.
9. `readOperation` refuses a Swagger 2 document.
10. `readOperation` refuses a reference cycle.
11. Through the child: `getInvoice` returns the envelope and passes `checkSchema` against the offer output.
12. `createInvoice` posts the JSON body and returns 201.
13. An `id` of `../admin?x=1` reaches the server as `/invoices/..%2Fadmin%3Fx%3D1`, never `/admin`.
14. A non-2xx answer refuses with `The operation answered 404`.
15. A float answer refuses with `canonical JSON cannot carry`.
16. A non-object input refuses with `The input must be a JSON object.`
17. End to end through `startRunner` and a stand-in hub: the result frame's `slip.body.outputHash` equals `canonicalHash(output)` and `output.result` equals the server's JSON.
18. CLI: `--openapi` and `--operation` pair in order, with `--base-url` on the second entry.
19. CLI: an `--openapi` without an `--operation` is refused.

Fixture: `packages/runner/test/fixtures/invoices.openapi.json` (OpenAPI 3.1, `getInvoice`, `createInvoice`, `getFloat`, resolved `Invoice` component).

Acceptance, from the worktree root:

```
bun run typecheck                         # pass
bun test packages/runner                  # 87 pass, 0 fail
bun test packages/core                    # 79 pass, 0 fail
bun test                                  # 1132 pass, 3 skip, 0 fail, 128 files
```

No test outside `packages/runner` failed.

## Existing test change (outside the written lease, disclosed)

`packages/runner/test/mcp.test.ts` used `{ adapter: "openapi" }` as its stand-in for an unknown adapter. Now that `openapi` is a served adapter, that exact shape is a malformed OpenAPI spec and correctly fails with `The child request is malformed.`; the old expectation could only pass by corrupting `parseOpenApi` or special-casing the empty object. I changed only the fixture's adapter to `"http"`; the test still asserts that an unknown adapter is refused, with the same expected message. No assertion was changed, weakened or skipped. This is the only file touched outside the lease.

## Notes and uncertainties

- The `Offer` shape has no `baseUrl` field, so base URL resolution lives in the CLI (`--base-url`, else `servers[0].url`) and reaches the child through `OpenApiSpec`. `openApiOffer` builds only from the operation and its schemas.
- `readOperation` is synchronous (`readFileSync`), so callers may `await` it or not.
- The packet fixes no message for a reference cycle; the adapter uses `Refused. The OpenAPI document has a reference cycle.`
- A `$ref` to a missing local schema reports `Refused. The OpenAPI document has no schema <name>.`; the packet only fixes the non-local and cycle cases.
- The test server binds to `127.0.0.1:0`; no test touches the network beyond loopback.
