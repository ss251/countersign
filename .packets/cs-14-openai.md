# cs-14-openai — an OpenAI-compatible endpoint for the buyer agent (refs #53)

## Setup

Run `bun install` at the worktree root before anything else.

## Goal

Any OpenAI SDK can call a countersign offer as if it were a model. It runs on the buyer's machine, because paying needs the buyer's countersignature and keys stay on the device.

- A local server in `packages/buyer`, bound to `127.0.0.1` only and guarded by a session bearer token.
- It lists the hub's live offers as models.
- A chat completion runs the existing buyer path under the local envelope, then returns the seller's output plus a `countersign` object pointing at the slip.

## Lease

You may create or change only these paths:

- `packages/buyer/src/openai/**` (new) and `packages/buyer/src/cli.ts`, to add the `openai` command
- `packages/buyer/test/openai.test.ts` (new)
- `docs/openai.md` (new)
- `.packets/reports/cs-14-openai.md`

Do not edit any `package.json`, `bun.lock`, `packages/buyer/src/buy.ts` or anything else. `openai@7.53.0` is installed as a buyer dev dependency for the tests. Use `buy()` exactly as exported, and never edit `packages/buyer/test/w1-attacks.test.ts`.

## Read first

`packages/buyer/src/{buy,payer,terms,journal,state,hub-client,cli}.ts`, `packages/core/src/schema.ts` (`checkSchema`), and the OpenAI chat completions and models response shapes in `node_modules/openai/resources/chat/completions` and `.../models`.

## What to build

1. `packages/buyer/src/openai/server.ts` exports `startOpenAIServer({hub, account, envelope, journal, state, port, host = "127.0.0.1", token, now, payers})`, which returns `{url, stop}`.
   - **Auth.** Every request needs `Authorization: Bearer <token>`, compared in constant time. Otherwise answer 401 `{error: {message: "Missing or wrong bearer token.", type: "invalid_request_error", code: "unauthorized"}}`. Never log the token.
   - **`GET /v1/models`** lists listed and online offers from the hub as `{object: "list", data: [{id: offerHash, object: "model", created: issuedAt, owned_by: seller}]}`. If the hub cannot be reached, return 502 in OpenAI's error shape.
   - **`POST /v1/chat/completions`**, with body `{model, messages, stream?}`:
     - **Find the offer.** `model` must be a listed offer hash. Otherwise 404 `{error: {message: "No such offer.", type: "invalid_request_error", code: "model_not_found"}}`.
     - **Input.** Take the last message with `role: "user"` and its text content, joining the text parts if `content` is an array.
       - If the text parses as JSON and `checkSchema(offer.input, json)` passes, use the JSON.
       - Otherwise, if the input schema has exactly one required property and its type is `string`, use `{[thatProperty]: text}`.
       - Otherwise answer 400 `{error: {message: "This offer needs JSON input with: <required fields>", type: "invalid_request_error", code: "bad_input"}}`.
     - **Pay.** Call `buy({hub, offerHash: model, input, payers, envelope, journal, state, now})`.
       - A `BuyError` whose message starts with "Refused." and names the envelope (`budget`, `limit`, `allowlist`, `revoked`, `expired`, `Held`) answers 403 `{error: {message, type: "envelope_refused"}}`.
       - Any other `BuyError` answers 402 `{error: {message, type: "payment_refused"}}`.
       - Unexpected errors answer 500, with the message's first line only.
     - **Reply.** Answer 200 with this body. The extra top-level `countersign` field is ignored by SDKs.

       ```
       {
         id: "chatcmpl-" + slipHash.slice(2, 26),
         object: "chat.completion",
         created: now,
         model,
         choices: [{index: 0, message: {role: "assistant", content: JSON.stringify(output)}, finish_reason: "stop"}],
         usage: {prompt_tokens: 0, completion_tokens: 0, total_tokens: 0},
         countersign: {slipHash, tx: slip.settlement.transaction, explorer: slip.settlement.url ?? null, amount: slip.body.amount, rail: slip.body.rail}
       }
       ```
     - **`stream: true`.** Answer with `text/event-stream`: one `chat.completion.chunk` with `delta: {role: "assistant", content}` and `finish_reason: "stop"`, then `data: [DONE]`.
2. **CLI.** `buyer openai [--port 8788] [--hub <url>] [--state <dir>]`.
   - Generate a random 32-byte hex session token at start and write it to `<state>/openai.token` with mode 0600.
   - Print exactly two lines: the base URL `http://127.0.0.1:<port>/v1` and the path of the token file. **Never print the token.**
   - Bind to 127.0.0.1 only.
3. **`docs/openai.md`**: what it is, how to start it, the three-line client setup with `new OpenAI({ baseURL: "http://127.0.0.1:8788/v1", apiKey: <contents of the token file> })`, what `model` means (an offer hash from `models.list()`), how input maps, the `countersign` field, the error types, and that it binds to localhost only because keys stay on the device.

## Tests (`packages/buyer/test/openai.test.ts`), with no network beyond localhost

Use a fake hub (`Bun.serve`) that sells one offer, as in `packages/buyer/test/buy.test.ts`. That offer's input schema has exactly one required string property, `question`, and the fake hub returns a signed slip. The pinned known rail is passed the same way the existing buyer tests pass it. Start the OpenAI server on port 0 and point the official client at it: `new OpenAI({ baseURL: url + "/v1", apiKey: token })`. Cover:

1. `client.models.list()` returns the offer.
2. `client.chat.completions.create({model: offerHash, messages: [{role: "user", content: "what is arc?"}]})`:
   - the content parses to the fake output;
   - `countersign.slipHash` equals the slip's hash;
   - the journal holds `released`.
3. An envelope with a cap below the price gives a 403 with `type: "envelope_refused"`. The client throws an `APIError` with status 403.
4. Input that fits no schema, against an offer whose schema has two required fields, gives 400 `bad_input`.
5. A wrong token gives 401.
6. With `stream: true`, the client's stream yields the content once and ends.

## Constraints

- **Never launch a browser of any kind on this machine**: no Chrome or Chromium, headless or not, no Playwright, Puppeteer or screenshot tools. UI checks go back to the lane, which raises NEEDS-BROWSER.
- No view code. Never print or log the session token, a key or a signature. Use only fixed anvil test keys in tests. TypeScript strict, no `any`.

## Acceptance

From the worktree root:

```
bun install && bun run typecheck && bun test packages/buyer && bun test && forge test
```

Every command passes, with no new skipped tests.

## Stop conditions

- You need to edit outside the lease: stop and write the report.
- One problem has blocked you for more than 20 minutes: stop, commit what passes, and write the report.

## Finish

Commit with small present-tense messages ending `(refs #53)`, and no trailers. Write `.packets/reports/cs-14-openai.md`. Do not push, merge or deploy.
