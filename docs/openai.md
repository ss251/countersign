# An OpenAI-compatible endpoint for the buyer

The buyer can present every live countersign offer as a model. A local server speaks the OpenAI chat completions and models API, and an ordinary OpenAI SDK can call it. Each completion runs the buyer's normal path: it fetches the offer, checks its terms against the pinned rails and the envelope, signs the countersignature, and waits for the seller's slip. The answer is the seller's output, and a `countersign` field points at the slip that paid for it.

The server runs on the buyer's machine because paying needs the buyer's key. Nothing here moves a key off the device.

## Start it

```sh
CS_BUYER_KEY=0x... bun packages/buyer/src/cli.ts openai --hub http://127.0.0.1:8787
```

Flags: `--port 8788` (the default), `--hub <url>`, `--state <dir>` (the default is `~/.countersign`).

At startup it generates a random 32-byte session token, writes it to `<state>/openai.token` with mode `0600`, and prints exactly two lines: the base URL and the token file's path. The token itself is never printed. The listener binds to `127.0.0.1` only, so no other machine can reach it.

The envelope must already exist; the server refuses to start without one.

## Point an SDK at it

```ts
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import OpenAI from "openai";

const apiKey = readFileSync(`${homedir()}/.countersign/openai.token`, "utf8");
const client = new OpenAI({ baseURL: "http://127.0.0.1:8788/v1", apiKey });
```

Every request needs `Authorization: Bearer <token>`. A missing or wrong token is a 401.

## Models

`client.models.list()` returns the hub's offers that are listed and online. The model id is the offer hash, `owned_by` is the seller's address, and `created` is the offer's `issuedAt`.

```ts
const models = await client.models.list();
const model = models.data[0].id;
```

## Completions

```ts
const answer = await client.chat.completions.create({
  model,
  messages: [{ role: "user", content: "what is arc?" }],
});
```

The server takes the last `user` message and joins its text parts. Then:

- If that text parses as JSON and the offer's input schema accepts it, the JSON is the input.
- Otherwise, if the schema has exactly one required property and it is a string, the text becomes that property. An offer that asks a single `question` therefore takes a plain sentence.
- Otherwise the call is a 400 `bad_input` naming the required fields.

The reply's `choices[0].message.content` is `JSON.stringify` of the seller's output. The top-level `countersign` field is extra to the OpenAI shape and is ignored by SDKs:

```json
"countersign": {
  "slipHash": "0x...",
  "tx": "0x...",
  "explorer": "https://...",
  "amount": "250000",
  "rail": "escrow"
}
```

`tx` is the settlement transaction, `explorer` is the seller's explorer link when the rail provides one (otherwise `null`), and `amount` is atomic 6-decimal USDC. The slip itself is stored under the buyer's state directory.

With `stream: true` the reply is `text/event-stream`: one `chat.completion.chunk` carrying the whole content with `finish_reason: "stop"`, then `data: [DONE]`.

## Errors

Errors use OpenAI's `{ "error": { "message", "type", "code" } }` shape.

| Status | `type` | When |
|---|---|---|
| 401 | `invalid_request_error` | Missing or wrong bearer token (`code: unauthorized`). |
| 404 | `invalid_request_error` | `model` is not a listed offer hash (`code: model_not_found`). |
| 400 | `invalid_request_error` | The user text cannot be shaped into the offer's input (`code: bad_input`). |
| 403 | `envelope_refused` | The envelope refused the spend: budget, per-seller limit, allowlist, revoked, expired, or a held call. |
| 402 | `payment_refused` | Any other refusal from the buyer: unknown rail, moved price, offline seller, a slip that does not verify. |
| 502 | `server_error` | The hub could not be reached. |
| 500 | `server_error` | An unexpected failure; the message is its first line. |

## Why localhost

The server holds the buyer's agent key in memory and signs one countersignature per completion. It binds to `127.0.0.1` and marks the token file `0600` so the key never leaves the machine and no other host on the network can spend under the envelope. The hub only ever sees the signatures the buyer chooses to send.
