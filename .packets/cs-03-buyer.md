# cs-03-buyer — the buyer agent: discover, envelope, countersign, pay, verify, journal, resume

## Setup

Run `bun install` at the worktree root before anything else, and again after any merge of `cs/int`.

## Goal

Build `packages/buyer`, the buyer's agent: a library and a CLI. It discovers offers on a hub, checks the human's envelope, countersigns, and pays over x402 v2. It receives the output and the slip, verifies the slip locally, and keeps an append-only journal so an interrupted call can be resumed. The agent never pays gas and never sees a chain: the payer module signs typed data and nothing else.

## Lease

You may create or change only these paths:

- `packages/buyer/src/**`, except `packages/buyer/src/hedera/`, which belongs to another lane
- `packages/buyer/test/**`
- `.packets/reports/cs-03-buyer.md`

Do not edit any `package.json`, `bun.lock`, `packages/core/**`, `packages/rail/**`, `apps/**` or anything else. Do not add dependencies. You have `viem`, `@countersign/core` and Bun built-ins.

## Read first

- `packages/core/src/types.ts`: Offer, PaymentRequired, PaymentRequirements, PaymentPayload, SettleResult, CountersignExtra, CountersignPayload, Slip, Envelope and EnvelopeSpend.
- `packages/core/src/wire.ts`: the `PAYMENT-*` header names, `toBase64Json`/`fromBase64Json`, `CallRequest`, `CallResult` and `ErrorBody`.
- `packages/core/src/countersign.ts`: `authorizationTypedData`, `countersignPayload` and `jobIdOf`.
- `packages/core/src/envelope.ts`: `checkEnvelope`, `recordSpend` and `needsHuman`.
- `packages/core/src/slip.ts`: `slipHash` and `slipSigner`.
- `packages/core/src/canonical.ts`: `canonicalHash`.
- `packages/core/src/schema.ts`: `checkSchema`.

The hub's HTTP surface, which you are a client of:

- `GET /offers` returns `{offers: Listing[]}`, where `Listing = {offerHash, offer, online, status}`.
- `GET /offers/:hash` returns a `Listing`.
- `POST /offers/:hash/call` takes body `{input, lineage?}`:
  - without payment it answers 402, with body `PaymentRequired` and header `PAYMENT-REQUIRED`;
  - with header `PAYMENT-SIGNATURE: base64(PaymentPayload)` it answers 200, with body `{output, slip}` and header `PAYMENT-RESPONSE`;
  - errors come back as `{code, message}`, or as a 402 whose body has `error`.
- `GET /jobs/:jobId` returns `{jobId, offerHash, rail, status, deadline, settleTx, closeTx, slipHash}`.
- `GET /slips/:hash` returns a `Slip`.

## What to build

- `src/payer.ts`:
  - `interface Payer { canPay(req: PaymentRequirements): boolean; pay(req: PaymentRequirements, ctx: {now: number}): Promise<{payment: PaymentPayload; jobId: Hex}> }`.
  - `countersignPayer(account: LocalAccount): Payer`. It can pay when `req.scheme === "countersign"` and `req.network` starts with `eip155:`.
  - To pay, it reads `extra` as `CountersignExtra` and builds the terms:
    - `offerHash: extra.offerHash`, `buyer: account.address`, `payee: req.payTo`, `amount: req.amount`;
    - `deadline: now + extra.deadlineSeconds`;
    - `salt`: a random uint256 as a decimal string, from `crypto.getRandomValues`.

    It then builds the `AuthorizationInput`: `chainId`, `escrow`, `tokenName` and `tokenVersion` from `extra`, `token: req.asset`, `validAfter: 0`, `validBefore: now + 600`. It signs with `account.signTypedData(authorizationTypedData(input))` and returns `{payment: {x402Version: 2, accepted: req, payload: countersignPayload(input, sig)}, jobId: jobIdOf(terms, chainId, escrow)}`.
- `src/hub-client.ts`: `class HubClient`, constructed with `(baseUrl: string, fetchImpl = fetch)`.
  - `listOffers()` and `getOffer(hash)`.
  - `call(hash, input, payment?)` returns `{kind: "required", required: PaymentRequired}`, `{kind: "paid", result: CallResult, settle: SettleResult | null}` or `{kind: "error", status, code, message}`. Treat a 402 that has an `error` field as `error`, with code `refused` and the message from `error`.
  - `job(jobId)` and `slip(hash)`.
- `src/journal.ts`: `class Journal(path)`, append-only JSONL.
  - Each entry is `{at: number, kind: "countersigned" | "released" | "settled" | "refused" | "failed" | "refunded", offerHash, seller, amount, rail?, jobId?, slipHash?, closeTx?, reason?}`.
  - `entries()` returns every entry.
  - `spend()` returns an `EnvelopeSpend` that counts each `countersigned` amount once and subtracts it again when a `refunded` entry with the same `jobId` exists. Money is committed when signed and given back when refunded.
  - `open()` returns the `countersigned` jobIds that have no later `released`, `settled`, `refunded` or `failed` entry.
- `src/state.ts`: the state directory, by default `~/.countersign` and overridable. It holds `envelope.json`, `journal.jsonl` and `slips/<slipHash>.json`. `loadEnvelope()` throws with a helpful message when the file is missing; `saveEnvelope(env)` writes it.
- `src/buy.ts`: `buy({hub, offerHash, input, payers, envelope, journal, state, now, approve?: boolean, lineage?})` returns `CallResult`, in this order:
  1. `listing = hub.getOffer(offerHash)`. If it is offline or delisted, throw `BuyError("Refused. The seller is offline.")` or `BuyError("Refused. The offer is delisted.")`.
  2. Input gate: `checkSchema(offer.input, input)`. If it fails, throw `BuyError("Refused. The input does not match the offer's schema.")` before anything is signed.
  3. `hub.call` without payment, expecting `required`. Pick the first entry of `required.accepts` that some payer `canPay`. If there is none: `BuyError("Refused. No rail here that this agent can pay.")`.
  4. Envelope: `checkEnvelope(envelope, journal.spend(), {seller: offer.seller, offerHash, amount: entry.amount}, now)`. If it refuses, append a `refused` entry and throw `BuyError(decision.message)`. If `needsHuman(envelope, entry.amount) && !approve`, append `refused` with reason `held` and throw `BuyError("Held. This call is above your ask-above limit; approve it to countersign.")`.
  5. `payer.pay(entry, {now})`, then append `countersigned` with its jobId, amount and rail.
  6. `hub.call` with the payment. On `error`, append `failed` with the message, then throw `BuyError(message)`.
  7. Verify the slip locally. Every check must pass:
     - `slip.hash === slipHash(slip.body)`;
     - `await slipSigner(slip) === offer.seller` (compare checksummed);
     - `slip.body.offerHash === offerHash`;
     - `slip.body.jobId === jobId`;
     - `slip.body.amount === entry.amount`;
     - `slip.body.inputHash === canonicalHash(input)`;
     - `slip.body.outputHash === canonicalHash(result.output)`;
     - `checkSchema(offer.output, result.output)` is ok.

     If any check fails, append `failed` with reason `bad-slip` and throw `BuyError("Refused. The slip does not verify; the escrow refunds at the deadline.")`.
  8. Save the slip under `slips/`. Append `released` when the slip's rail is escrow-like (`slip.body.escrow` is set), otherwise `settled`, with the slipHash and `closeTx: slip.settlement.transaction`. Return the result.
- `src/resume.ts`: `resume({hub, journal, state})`. For each `journal.open()` jobId, call `hub.job(jobId)`:
  - `released` or `settled`: fetch and save the slip, then append `released` or `settled`;
  - `refunded`: append `refunded`;
  - `failed`: append `failed`.

  It returns a summary list.
- `src/cli.ts`, run as `bun packages/buyer/src/cli.ts <cmd>`. The agent key comes only from env `CS_BUYER_KEY`; never print it and never accept it as an argument. `--hub` defaults to `http://127.0.0.1:8787`, and `--state <dir>` is optional.
  - `discover`: one line per offer, with the short hash (10 characters), title, price in USDC via `formatUnits(price, 6)`, rails, and online or offline.
  - `buy <offerHash> --input '<json>' [--approve]`: print the output JSON, then `Released. Slip minted.` and the slip hash and close tx. On a `BuyError`, print its message and exit 1.
  - `envelope show`, and `envelope set [--cap <usd>] [--per-merchant <usd>] [--ask-above <usd>] [--allow <addr|hash>]... [--revoke] [--unrevoke]`. Amounts are entered in USDC decimals and stored atomic via `parseUnits(x, 6)`. `agent` is set from the key's address.
  - `journal`: print the entries, one per line.
  - `resume`.

  Parse arguments by hand.
- `src/index.ts`: export the library pieces.

## Tests (`packages/buyer/test/`)

Run a fake hub with `Bun.serve({port: 0})` that has one offer from a seller key (viem `privateKeyToAccount`):

- `GET /offers/:hash` returns the listing.
- `POST /offers/:hash/call` without a header returns 402 with `accepts: [{scheme: "countersign", network: "eip155:5042002", amount: offer.price, asset: "0x3600000000000000000000000000000000000000", payTo: seller, maxTimeoutSeconds: 120, extra: {rail: "escrow", escrow: "0x4444444444444444444444444444444444444444", chainId: 5042002, offerHash, deadlineSeconds: 120, tokenName: "USDC", tokenVersion: "2"}}]`.
- With a header, it decodes the payment, checks it with `checkCountersign`, and replies with an output plus a slip. The slip is built with `slipBodyFor` from core, using `jobId = payload.authorization.nonce`, and signed by the seller with `slipTypedData`.

Cover at least:

1. Happy path:
   - `buy` returns the output;
   - the slip verifies;
   - the journal holds `countersigned` then `released`;
   - the slip file exists;
   - `journal.spend().total` equals the price.
2. The envelope cap refuses: no payment header is ever sent (count requests) and a `refused` entry is appended.
3. `askAbove` holds without `approve` and goes through with `approve: true`.
4. Input that fails the schema is refused before any 402 request.
5. A fake hub that signs the slip with a different key: `BuyError` with "does not verify", and a `failed` entry.
6. A fake hub that answers the paid call with a 402 `{error: "Refused. The price moved after you signed."}`: `BuyError` carrying that message.
7. `resume`: write a `countersigned` entry, have the fake hub's `/jobs/:jobId` say `released` and `/slips/:hash` return a slip, then check that resume appends `released`.
8. `journal.spend()` subtracts refunded jobs.

## Constraints

- TypeScript strict. No `any`.
- The buyer key never reaches a log line or argv.
- Keep each file under about 250 lines.

## Acceptance

From the worktree root:

```
bun install && bun run typecheck && bun test packages/buyer && bun test && forge test
```

Every command passes, with no skipped or todo tests.

## Stop conditions

- You need to edit outside the lease: stop and write the report.
- One problem has blocked you for more than 20 minutes: stop, commit what passes, and write the report.

## Finish

Commit on your branch with small present-tense messages and no co-author trailers. Write `.packets/reports/cs-03-buyer.md` with:

- what you built;
- the acceptance output, with the last lines of each command;
- anything you could not do.

Do not push, merge or deploy.
