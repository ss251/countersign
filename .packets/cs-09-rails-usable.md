# cs-09-rails-usable — gateway and hedera usable end to end: runner payTo and stable offers, hub rail isolation, gateway hardening, buyer gateway payer (refs #3 #6)

## Setup

Run `bun install` at the worktree root before anything else.

## Goal

Make every rail usable through the real hub and buyer:

- The runner can publish an offer whose payee differs per rail.
- An offer keeps its hash across runner restarts.
- One broken rail never breaks a 402.
- The gateway rail is hardened.
- The buyer CLI can pay a nanopayment over Circle Gateway with the same discipline it applies to the escrow rail.

Facts from a live run on 06 Nov (#3 comment):

- Circle Gateway's verify **requires** `paymentPayload.resource` with `url`, `description` and `mimeType`. The buyer copies the 402's `resource` object into the payment.
- A Gateway settlement's `transaction` is a transfer id (a UUID), not a chain tx.
- The Arc testnet Gateway kind is `exact` with `extra {name: "GatewayWalletBatched", version: "1", verifyingContract: "0x0077777d7eba4688bdef3e311b846f25870a19b9"}`, asset USDC `0x3600000000000000000000000000000000000000`.

Reviews to satisfy: `$M/reports/review-20c2ebf.md` (should-fix 1–3).

## Lease

You may create or change only these paths:

- `packages/runner/src/**` and `packages/runner/test/**`
- `apps/hub/src/call.ts`, `apps/hub/src/discovery.ts` (the shared challenge helper), `apps/hub/src/store.ts` (only to add the nonce claim) and `apps/hub/test/**`
- `packages/rail/src/gateway/**` and `packages/rail/test/gateway.test.ts`
- `packages/buyer/src/**` except `packages/buyer/src/hedera/`, and `packages/buyer/test/**`. Never edit `packages/buyer/test/w1-attacks.test.ts`.
- `.packets/reports/cs-09-rails-usable.md`

Do not edit any `package.json`, `bun.lock`, `packages/core/**` or anything else.

## What to build

### A. Runner

1. `--pay-to <rail>=<id>` is repeatable, for example `--pay-to hedera=0.0.11337065`. It writes `offer.payTo[rail] = id`. Refuse a rail id that is not in `RAIL_IDS`.
2. **Stable offers.** `publishOffer` keeps a state file `~/.countersign/runner/offers.json`. `--state <dir>` overrides the directory, and tests use a temp dir. The key combines seller, skill sha256, price, deadline, rails and payTo. When the key matches a stored offer, reuse its `issuedAt`, so the republished offer has the same hash. Otherwise use `now` and store it.
3. Front matter: support YAML block scalars `key: >` (folded) and `key: |` (literal), with the indented lines that follow, and strip one level of surrounding `"` or `'` from plain values. Test it against `examples/catalogue/whitechain/whitechain-dev/SKILL.md`, whose `description: >` must parse to its real text. Test that the five Circle skills under `examples/catalogue/circle/*/SKILL.md` still parse.

### B. Hub (`call.ts` and the shared challenge helper)

1. A rail whose `challenge` throws is skipped. Log one line naming the rail; never log the offer body. The 402 lists the others. If none are left, answer 503 `no-rail` as now.
2. Any exception thrown by `rail.verify` or `rail.settle` becomes a 402 with error "Refused. The payment could not be checked." It is never a 500. Log the rail and the error message's first line only.
3. Should-fix 3, a nonce claim: before dispatching to the runner, claim the payment's authorization nonce (the jobId) in the store, with a unique insert into `jobs`. A second paid call carrying the same nonce gets 409 `duplicate-payment`, "Refused. This payment was already used.", and is never delivered twice.
4. When the rail's `declaration.explorerTx` is empty, the slip's `settlement.url` is omitted, never a broken link.

### C. Gateway rail (`packages/rail/src/gateway`)

1. `verify` catches facilitator errors and returns `{isValid: false, invalidReason: "Refused. " + <first line>}`. It never throws.
2. Should-fix 2: `settle` runs the same local `matches(payment.accepted, req)` check as `verify` before calling the facilitator.
3. `declaration.explorerTx` is `""`: a Gateway transfer id is not a chain tx.
4. `gatewayPayment(signer, requirements, resource?)` sets `payment.resource = resource` when given.

### D. Buyer (`packages/buyer`), should-fix 1

1. `known-rails.ts` gains `KNOWN_GATEWAYS: Array<{network: "eip155:5042002"; verifyingContract: Address; asset: Address; name: "GatewayWalletBatched"; version: "1"}>` with the Arc testnet entry above.
2. `gatewayPayer(account: LocalAccount, known = KNOWN_GATEWAYS): Payer`.
   - `canPay(req)` is true when `req.scheme === "exact"`, `req.extra.name === "GatewayWalletBatched"`, and network, asset, verifyingContract and version all match a known gateway, compared case-insensitively.
   - `pay(req, ctx)` builds the payload with `gatewayPayment(account, req, ctx.resource)` and returns `{payment, jobId: payload.authorization.nonce}`.
   - Extend the `pay` context with an optional `resource` that `buy()` passes from the 402.
3. Terms for gateway in `terms.ts`. Before signing, refuse unless:
   - `entry.payTo` equals `offer.payTo?.gateway ?? offer.seller`;
   - `entry.amount === offer.price`;
   - the gateway is known (as in `canPay`).

   Messages follow the `checkTerms` style. A countersign entry keeps its existing path untouched.
4. `buy()`: pick the first accept a payer can pay **and** whose terms check passes, in the order `required.accepts` lists them. `--rail <id>` in the CLI restricts the choice to that rail id, read from `extra.rail` for countersign and `"gateway"` for exact batched entries. For a gateway slip (`slip.body.escrow` absent):
   - verify the hash, the seller signature, the offer, `jobId === nonce`, the amount, the input and output hashes, and the output schema;
   - journal it as `settled`.
5. The CLI registers both payers, countersign first, then gateway. `--rail gateway` forces Gateway.

## Tests

- Runner:
  - `--pay-to` lands in `offer.payTo`;
  - an unknown rail is refused;
  - two publishes with identical inputs produce the same `offerHash`, using a fake hub and a temp state dir;
  - the whitechain-dev description parses as real text, not `">"`;
  - the Circle skills still parse.
- Hub:
  - a FakeRail whose `challenge` throws is skipped, and the other rail is still offered;
  - a rail whose `verify` throws gives 402 "Refused. The payment could not be checked.";
  - replaying the same paid call gives 409 `duplicate-payment`, and the runner is dispatched once;
  - an empty `explorerTx` gives no `settlement.url`.
- Gateway rail:
  - a facilitator `verify` that throws gives `isValid: false`;
  - `settle` with a mismatched `accepted` makes no facilitator call;
  - `gatewayPayment` with a resource sets it.
- Buyer:
  - `gatewayPayer.canPay` is false for an unknown `verifyingContract`, false for the wrong asset, and true for the pinned entry;
  - a gateway 402 whose `payTo` is not the seller is refused before signing;
  - a full fake-hub gateway purchase journals `settled`;
  - every existing buyer test, `w1-attacks` included, still passes unedited.

## Constraints

- **Never launch a browser of any kind on this machine**: no Chrome or Chromium, headless or not, no Playwright, Puppeteer or screenshot tools. UI checks go back to the lane, which raises NEEDS-BROWSER.
- No view code. No network in tests: inject fakes, no live Gateway or Circle calls. Use only fixed anvil test keys.
- TypeScript strict, no `any`.

## Acceptance

From the worktree root:

```
bun install && bun run typecheck && bun test packages/runner packages/buyer packages/rail apps/hub && bun test && forge test
```

Every command passes, with no skipped tests.

## Stop conditions

- You need to edit outside the lease: stop and write the report.
- One problem has blocked you for more than 20 minutes: stop, commit what passes, and write the report.

## Finish

Commit with small present-tense messages ending `(refs #3)` or `(refs #6)`, and no trailers. Write `.packets/reports/cs-09-rails-usable.md`. Do not push, merge or deploy.
