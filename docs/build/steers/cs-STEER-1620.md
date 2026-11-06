> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Steer for orch-cs, 16:20 IST

## 1. hd-06 (MPP) starts now as a fourth writer

This is the project lead's one-time exception to the three-writer cap; cs-hd launches it. Do not count it against your three, and take it out of your queue line. Every other packet still waits for a slot.

## 2. Scope: the project lead wants the full surface, and a cut is his decision, not an omission

| Item | Where it stands | Owner |
|---|---|---|
| Assistant, offer page, publish wizard | Built on `cs/ui` a0cf33a; now in the polish and browser-check pass | cs-ui |
| Front-door hub reads | cs-11, next after cs-09 | you |
| OpenAI-compatible endpoint | New: open an issue and a packet (design below) | you |
| ENS name policy | New: small packet after cs-08, because `packages/identity` is in cs-08's lease (design below) | you |
| Marketplace terms doc | `docs/terms.md`, docs only, starts now | cs-readme |
| MPP rail | hd-06, starting now | cs-hd |
| Hedera schedule | hd-08 | cs-hd |
| Paid sessions, unified balance | No work. The project lead is deciding whether to cut them. If he does, record both in `docs/decisions.md` as deliberate cuts with a one-line reason each, and do not say where the list came from. | — |

**Queue suggestion.** The project lead's Hedera rule is that the schedule ships even if nothing else on Hedera does, so keep hd-08 ahead of cs-08 unless cs-08 blocks something:

cs-09 (running) → cs-11 → hd-07 → hd-08 → openai → cs-08 → ens → cs-12 → cs-10

cs-10 waits on the project lead's Goldsky call anyway.

## 3. OpenAI-compatible endpoint: design note for your packet

- **It runs on the buyer side, not the hub.** Paying needs the buyer's countersignature, and keys stay on the device. `packages/buyer` gets a local server, for example `bun run buyer openai --port 8787`, bound to 127.0.0.1 only.
  - It generates a session bearer token at start and stores it at mode 0600. Every request must carry it. It is not a key, but it is never logged.
- **`GET /v1/models`** lists the hub's live offers in OpenAI's model-list shape: `id` = offer hash (or a stable slug), `owned_by` = seller.
- **`POST /v1/chat/completions`**, with `model` = offer:
  - **Input.** If the last user message parses as JSON that fits the offer's input schema, use it. If the schema has exactly one required string field, map the text onto it. Otherwise return 400 with OpenAI's error shape, naming the required fields.
  - **Payment.** Run the existing buyer path under the local envelope (cap, per-merchant limit, allowlist), countersign and pay.
  - **Reply.** The seller's output goes in `choices[0].message.content` as a JSON string, in the standard chat.completion shape with `finish_reason: "stop"`. Add a top-level `countersign: {slipHash, tx, explorer, amount, rail}`; SDKs ignore fields they do not know.
  - **Envelope refusal** is 403 with `{error: {message, type: "envelope_refused"}}`.
  - **`stream: true`** emits one SSE chunk and `[DONE]`, so streaming clients still work.
- **Acceptance:**
  - Offline tests use the official `openai` npm client with `baseURL` pointed at the local server and the fake rail: list models, one paid completion, one envelope refusal and one bad input.
  - Then one live Arc testnet call through it, whose slip verifies.
  - `docs/openai.md` shows the three-line client setup.

## 4. ENS name policy: design note

- **Resolution.** `packages/identity` gets a name resolver: a reverse record on Ethereum mainnet, kept only when the forward record resolves back to the same address. It caches for 10 minutes, times out after 2 seconds, and returns null on any failure. The RPC is configurable.
- **Where names appear.** The hub fills `name` in `/sellers` with it. The registry shows the name with the address beside it.
- **Payments never use names.** `payTo` always comes from the signed offer.
- **Docs.** cs-readme writes `docs/ens.md` once this code exists, stating exactly these rules.

