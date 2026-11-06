# cs-14-openai report

Date: 2026-11-06
Branch: `cs/cs-14`

## Landed

### Buyer — `packages/buyer/src/openai/server.ts`

`startOpenAIServer({hub, account, envelope, journal, state, port, host, token, now, payers, known})`
returns `{url, stop}` and serves the OpenAI models and chat completions API on `127.0.0.1` by
default.

- Every request needs `Authorization: Bearer <token>`. The token is compared through SHA-256
  digests with `timingSafeEqual`, so the comparison is constant time and does not leak length.
  A miss is the 401 `{message: "Missing or wrong bearer token.", type: "invalid_request_error",
  code: "unauthorized"}` body. Nothing logs the token.
- `GET /v1/models` asks the hub for its listings and returns the `listed` and `online` ones as
  `{id: offerHash, object: "model", created: issuedAt, owned_by: seller}`. A hub failure is a
  502 in OpenAI's error shape.
- `POST /v1/chat/completions` reads the last `user` message and joins its text parts. It uses
  parsed JSON when the offer's input schema accepts it, otherwise the single-required-string
  shorthand, otherwise 400 `bad_input` naming the required fields. `model` is resolved with
  `hub.getOffer`, and a missing, delisted or offline offer is 404 `model_not_found`.
- Payment goes through the existing `buy()` with `approvals: "local"`. A held or envelope
  refusal is 403 `envelope_refused`; any other `BuyError` is 402 `payment_refused`; an
  unexpected error is 500 with the first line of its message. Every other response is the
  `chat.completion` body with the extra `countersign` field (`slipHash`, `tx`, `explorer`,
  `amount`, `rail`). `stream: true` answers one `chat.completion.chunk` with the whole content
  and `finish_reason: "stop"`, then `data: [DONE]`.
- `now` accepts a number or a clock function, so the CLI can keep the server's time current.
  The optional `known` argument carries the pinned rails; without it the server uses
  `KNOWN_RAILS` plus the state directory's `rails.json`, matching the CLI's buy path.

### Buyer — `packages/buyer/src/cli.ts`

- New `openai [--port 8788]` command. It creates a random 32-byte hex session token, writes it
  to `<state>/openai.token` with mode `0600`, binds to `127.0.0.1`, and prints exactly the base
  URL (`http://127.0.0.1:<port>/v1`) and the token path. The token is never printed.
- Existing commands and flags are unchanged; the usage line now includes `openai`.

### Docs

`docs/openai.md` covers what the endpoint is, how to start it, the three-line client setup, the
offer-hash model ids, the input mapping, the `countersign` field, the error table, and why the
listener is localhost-only.

### Tests — `packages/buyer/test/openai.test.ts`

A fake hub sells a one-required-string offer and a two-required-field offer, signs slips, and
serves `/offers` and `/offers/:hash`. The official `openai@7.53.0` client points at the server
on port 0. Covered:

1. `models.list()` returns the listed, online offers and hides the delisted one.
2. A completion returns the fake output, the `countersign.slipHash` matches the slip, and the
   journal holds `released`.
3. An envelope cap below the price is a 403 `envelope_refused` through `APIError`.
4. Input that fits no schema on the two-field offer is a 400 `bad_input`.
5. A wrong token is a 401.
6. A streamed completion yields the content exactly once and ends.

Fixed anvil keys are the only keys used.

## Verification

From the worktree root:

```
bun install
bun run typecheck
bun test packages/buyer
bun test
forge test
```

All pass. `bun test` reports 586 pass, 3 skip, 0 fail; the three skips are pre-existing and no
test was skipped by this change. `forge test` reports 29 passed, 0 failed.
