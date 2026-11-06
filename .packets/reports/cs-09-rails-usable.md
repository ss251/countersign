# cs-09-rails-usable — report

Date: 2026-11-06
Branch: `cs/cs-09`

## Landed

### Runner
- `--pay-to <rail>=<id>` is repeatable and writes `offer.payTo`; a rail outside `RAIL_IDS` is refused before any network call.
- `publishOffer` now reuses the `issuedAt` stored for the same seller, skill sha256, price, deadline, rails and payTo in `offers.json`, so a restart republishes the same hash. `--state <dir>` overrides `~/.countersign/runner`.
- Front matter handles `key: >` and `key: |`, strips one level of matching quotes, and ignores nested keys. The whitechain-dev folded description and all five Circle skills parse as real text.

### Hub
- `challengeOptions` skips a rail whose `challenge` throws, logs only `[hub] rail <id> challenge failed: <first line>`, and still offers the others. An empty set is still 503 `no-rail`.
- A thrown `rail.verify` or `rail.settle` is a 402 with `Refused. The payment could not be checked.` and one rail-prefixed log line; it is never a 500.
- Before settling, an already-claimed nonce is refused with 409 `duplicate-payment` / `Refused. This payment was already used.`; `Store.claimJob` then inserts the job with `INSERT OR IGNORE` as the race-safe claim before dispatch. The runner is dispatched once.
- A slip whose rail has `explorerTx: ""` omits `settlement.url` entirely.

### Gateway rail
- `verify` catches facilitator errors and returns `{ isValid: false, invalidReason: "Refused. <first line>" }`; it never throws.
- `settle` runs the same local `matches(payment.accepted, req)` pre-check and makes no facilitator call on a mismatch.
- `declaration.explorerTx` is `""`; a Gateway transfer id is not a chain transaction.
- `gatewayPayment(signer, requirements, resource?)` copies the resource object when one is supplied.

### Buyer
- `KNOWN_GATEWAYS` pins the Arc testnet `GatewayWalletBatched` kind (`0x0077…19b9`, USDC `0x3600…0000`, version `1`).
- `gatewayPayer` accepts only exact batched entries matching a pinned Gateway, copies the 402 resource into the payment, and returns the authorisation nonce as `jobId`.
- `checkGatewayTerms` requires the payee from `offer.payTo.gateway ?? offer.seller`, the offer price, and a pinned Gateway before signing.
- `buy()` walks `required.accepts` in order, choosing the first entry that a payer can pay *and* whose terms pass. `--rail <id>` restricts the choice (`extra.rail` for countersign, `gateway` for exact batched entries). Gateway slips get the same hash/signature/offer/jobId/amount/input/output/schema checks and are journaled `settled`.
- The CLI registers countersign first, then Gateway.

## Review 20c2ebf
- Should-fix 1 (buyer signs hostile Gateway terms): closed by `gatewayPayer` pinning, `checkGatewayTerms`, and the in-order accept selection; the payer also re-checks the pinned Gateway before signing.
- Should-fix 2 (settle had no local pre-check): closed by running `matches` in `settle` before the facilitator call.
- Should-fix 3 (no local replay guard): closed by the hub nonce claim and 409 duplicate path.

## Verification

From the worktree root:

```
bun install
bun run typecheck
bun test packages/runner packages/buyer packages/rail apps/hub   # 147 pass, 0 fail
bun test                                                         # 231 pass, 3 skip, 0 fail
forge test                                                       # 29 pass, 0 fail
```

The 3 skips are the pre-existing `apps/web/test/onchain.live.test.ts` suite, gated by `CS_LIVE=1`; no new test is skipped.

No browser, Playwright, Puppeteer or screenshot tool was launched. No live Gateway, Circle, Hedera or chain call was made by the tests; all rails and hubs were fakes.
