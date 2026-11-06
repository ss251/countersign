# Status

What countersign has built, what is still on a branch, and what is only a design. Every row was checked against the code, not against another page. If any other page in this repository disagrees with this one, the other page is wrong.

Checked on 06 Nov 2026 against `cs/int` at `232ce7f`. `SHIPPED` means on `main` and deployed. A row that is merged or on `main` but not deployed says which, and flips only when it is both. The proof transactions linked from the README were read back from Arc, Whitechain and Hedera for this page: each one exists with the status the README gives it, and the moved-price transaction reverted.

| Status | Meaning |
|---|---|
| `SHIPPED` | On `main` and deployed where it is used: on the production hub or console, or on chain for a contract. With a test or a proof link. |
| `IN PROGRESS` | A branch or pull request exists, or the code is on `main` but not deployed: not switched on in production, not hosted, or waiting on a contract that is not deployed. |
| `IN DESIGN` | Written down as a design. No code. |
| `NOT BUILT` | Described somewhere, absent from the code. |
| `CUT` | Decided not to build for this event ([decisions.md](decisions.md), D14). |

A pull request that changes a row's status changes it here too.

## Offer, countersignature and escrow

| Capability | Status | Evidence | Claimed in |
|---|---|---|---|
| A seller signs each offer, `offerHash` fixes it, and the hub refuses a signature from another key | `SHIPPED` | `apps/hub/test/publish.test.ts`, `packages/core/test/offer-slip.test.ts` | README, [spec/offer.md](spec/offer.md), [terms.md](terms.md) §1 |
| Canonical JSON, a strict subset of RFC 8785 | `SHIPPED` | `packages/core/test/canonical.test.ts` | [spec/offer.md](spec/offer.md), D5 |
| The countersignature: one EIP-3009 `ReceiveWithAuthorization` whose nonce is the `jobId` | `SHIPPED` | `contracts/test/Parity.t.sol`, `packages/core/test/countersign.test.ts` | README, [spec/countersignature.md](spec/countersignature.md), [terms.md](terms.md) §3 |
| `CountersignedEscrow` v1: fund, release, refund and cancel, with no owner, pause or proxy, and a 1% toll to a `FeeSplit` | `SHIPPED` | 29 tests in `contracts/test/`; Arc [`0x19c2…1b76`](https://explorer.testnet.arc.io/address/0x19c27d770969291e6a0a305dc1be1a845e7c1b76), Whitechain [`0x9279…7eb4`](https://explorer.testnet.whitechain.io/address/0x9279D3edeef4c3738a0b200D762e2985Ff3B7eb4) | README, [spec/escrow.md](spec/escrow.md), [terms.md](terms.md) §4 and §5 |
| A settlement at a moved price reverts on chain | `SHIPPED` | Arc [`0xca61…0e76`](https://explorer.testnet.arc.io/tx/0xca61627848d1ea952c5953ac58df7b8bd780777563e24ebccf5bb90315d20e76); e2e `arc-wrong-amount` | README, [proof.md](proof.md) |
| After the deadline anyone can refund the buyer in full | `SHIPPED` | Arc [`0x1cd2…9e35`](https://explorer.testnet.arc.io/tx/0x1cd2a5a624a6c166d6b85e99dfaffcbd03c1c65c17fe7010109610872c499e35); e2e `arc-deadline-refund` | README, [proof.md](proof.md), [terms.md](terms.md) §4 |
| The payee cancels a held job and the buyer gets the full amount back | `SHIPPED` | Whitechain [`0x1e99…c5d9`](https://explorer.testnet.whitechain.io/tx/0x1e99d1aceab0ddfcebc3f91e6c6650c0c9214f737552382ff68098704cfec5d9) | [whitechain.md](whitechain.md), D7 |
| Seller bond: locked at funding, paid to the buyer when a delivery fails the hub's gate | `IN PROGRESS` | The contract code is on `main` through promotion [#125](https://github.com/ss251/countersign/pull/125) (`e2176b7`), from [#118](https://github.com/ss251/countersign/pull/118) ([#93](https://github.com/ss251/countersign/issues/93)). No escrow with it is deployed, so no deployed contract collects a bond. Every offer declares `bond` | `Offer.bond` in `packages/core/src/types.ts`, [spec/offer.md](spec/offer.md), [spec/escrow.md](spec/escrow.md) "Escrow v2", D11, README "Safety limits", [terms.md](terms.md) §6 |
| Delivery review window: the buyer accepts, or disputes for a refund | `IN DESIGN` | [spec/escrow.md](spec/escrow.md) "Escrow v2" and D12. [#98](https://github.com/ss251/countersign/issues/98) holds the work. No code | [spec/escrow.md](spec/escrow.md), D12 |
| `erc8183` escrow rail with a `JobHook` committing the slip | `NOT BUILT` | No contract and no rail ([#24](https://github.com/ss251/countersign/issues/24)) | `RAIL_IDS` comment in `packages/core/src/types.ts` |

## Rails

| Capability | Status | Evidence | Claimed in |
|---|---|---|---|
| One `Rail` interface; every rail is declared on `/rails` and named on every slip | `SHIPPED` | `packages/rail/src/rail.ts`, `apps/hub/test/rails.test.ts` | README, [spec/rail.md](spec/rail.md) |
| Arc escrow rail, USDC | `SHIPPED` | release [`0x02b6…2809`](https://explorer.testnet.arc.io/tx/0x02b65aabec26062e828e1b91203a9d8de5cdab0a6717bbf087054c76b3702809); through the hosted hub [`0x0a01…ed69`](https://explorer.testnet.arc.io/tx/0x0a0118e9e81c21517eaf0f387e7801e1fafef947cfccd1c05ff989201433ed69) | README, [proof.md](proof.md) |
| Circle Gateway rail: the buyer is debited at once and the seller is credited in a later batch | `SHIPPED` | transfer `a69f94c8-8771-4d8b-96ba-fe189501f80c`, and `196e409b-4855-4001-bafc-37ddbaa80076` on the hosted hub; `packages/rail/test/gateway.test.ts`; e2e `arc-gateway`, `public-gateway` | README, [proof.md](proof.md), [terms.md](terms.md) §2 |
| Whitechain rail: USDT in the same escrow on chain 1874, the relay pays the gas | `SHIPPED` | On `main`, and the production hub's `/rails` lists `whitechain` (`eip155:1874`) through the hosted relay. A paid call through the production hub: [fund `0x1d45…1e73`](https://explorer.testnet.whitechain.io/tx/0x1d45e70ff0ac33d9fee2b503f7acb22370a107232a98eb3d7afa7b7d4d321e73), [release `0xd60d…5971`](https://explorer.testnet.whitechain.io/tx/0xd60dd634a1b326947ef855eee129cf7f994f0c6fdd5b58843f3d5310fdcc5971), the buyer holding no WBT; the offer is online only while the merchant's runner runs. Earlier, on a local hub: fund [`0x415b…b08c`](https://explorer.testnet.whitechain.io/tx/0x415bddc897b459a2d2342809e1a2621ac3999ca1d5812b3670b563fce504b08c), release [`0x90ed…c812`](https://explorer.testnet.whitechain.io/tx/0x90ed826a41f21290db924e4afc1e06bffe806e2966d8582618a074efa0c3c812); `packages/rail/test/whitechain.test.ts`; e2e `whitechain`. It runs on a hub started with `WC_RELAY_URL`; the production hub has declared it since 20:00 IST, 06 Nov | README, [whitechain.md](whitechain.md) |
| The relay's guards: allowlist, simulation first, fee cap, hourly ceiling, balance floor, one transaction at a time, refunds tied to a recorded payment | `SHIPPED` | `packages/relay/src/relayer.ts`; `packages/relay/test/relayer.test.ts`, `ceiling.test.ts`, `refund.test.ts` | [whitechain.md](whitechain.md) |
| A USDT paywall and a paying `fetch` for any API (`whitechainPaywall`, `createPayFetch`) | `SHIPPED` | `packages/relay/examples/`, `packages/relay/test/dropin-e2e.test.ts`; [`0x1c36…5f07`](https://explorer.testnet.whitechain.io/tx/0x1c366946e8dc6e1256e16880c9345b2cb84613fd5cef920f2214ae840b475f07) | [whitechain.md](whitechain.md) |
| Hedera rail: x402 v2 `exact` through a hosted facilitator, with no human approving | `SHIPPED` | [`0.0.9185802@1793962668.996163078`](https://hashscan.io/testnet/transaction/0.0.9185802@1793962668.996163078), and [`0.0.9185802@1793966332.720364516`](https://hashscan.io/testnet/transaction/0.0.9185802@1793966332.720364516) on the hosted hub; `packages/rail/src/hedera/test/` | README, [hedera.md](hedera.md) |
| HCS spend log and its audit | `SHIPPED` | topic [`0.0.11337070`](https://hashscan.io/testnet/topic/0.0.11337070); `packages/buyer/src/hedera/test/spendlog.test.ts`, `scripts/hedera/audit.ts` | README, [hedera.md](hedera.md) |
| Hedera scheduled checkout | `IN PROGRESS` | On `main` through promotion [#125](https://github.com/ss251/countersign/pull/125) (`e2176b7`), from [#105](https://github.com/ss251/countersign/pull/105) ([#41](https://github.com/ss251/countersign/issues/41)). Live on Hedera testnet: schedule [`0.0.11338645`](https://testnet.mirrornode.hedera.com/api/v1/schedules/0.0.11338645) executed when the seller signed, and schedule [`0.0.11338653`](https://testnet.mirrornode.hedera.com/api/v1/schedules/0.0.11338653) expired with nothing moved ([hedera.md](hedera.md) "Scheduled checkout"). Not deployed: the production hub does not use it yet; it runs from `scripts/hedera`, and making it the default Hedera path is STEER-1950 item 4 | [e2e.md](e2e.md) flow 6 reads its log entries |
| `eip3009` rail: direct USDC on Arc, no escrow | `IN PROGRESS` | On `main` through promotion [#125](https://github.com/ss251/countersign/pull/125) (`e2176b7`), from `361151b` ([#19](https://github.com/ss251/countersign/issues/19)). Not deployed: the hub loads it only with `EIP3009_RAIL=1`, and the production hub's `/rails` does not list it | `RAIL_IDS` comment in `packages/core/src/types.ts` |
| MPP rail: pays on Tempo testnet; Stripe's card method sits behind a flag | `IN PROGRESS` | On `main` through promotion [#125](https://github.com/ss251/countersign/pull/125) (`e2176b7`), from [#84](https://github.com/ss251/countersign/pull/84). Real payments through the rail on Tempo testnet: [`0xd525…5c33`](https://explore.testnet.tempo.xyz/tx/0xd525b18b225c939c1ba9c819fb536e036fd0405f0090c2ded0aabaf519b35c33) and, after the review fix, [`0x4866…a89f`](https://explore.testnet.tempo.xyz/tx/0x4866e130e21972d08eb7c52eab353bb6259b0f9866621979682cef2179e3a89f). Not deployed on the hub: it is not wired in yet (cs-16) | README "Rails", `docs/architecture.svg`, `RAIL_IDS` comment |
| The payment waits in escrow until the output checks out | `SHIPPED` | On the escrow rails only, Arc and Whitechain: `release` needs the seller's signature over a slip the hub's gate passed. See the escrow rows above | README, console copy |
| A payment on a direct rail (Hedera, Gateway) returned when the delivery fails | `NOT BUILT` | The hub settles a direct rail before the seller runs. On 06 Nov a live call settled and was never delivered: [`0.0.9185802@1793968507.953096251`](https://hashscan.io/testnet/transaction/0.0.9185802@1793968507.953096251). The hub's failure message on a direct rail now says the payment is not returned automatically (`apps/hub/src/call.ts`). Production said "Your money returns at the deadline" on every rail until this promotion | [terms.md](terms.md) §4, which says so; console copy |
| Rail router: the cheapest healthy rail, a fallback on failure, and a recorded reason | `SHIPPED` | On `main` through promotion [#125](https://github.com/ss251/countersign/pull/125) (`e2176b7`), from `a565edf` ([#94](https://github.com/ss251/countersign/issues/94)). `packages/rail/src/router.ts`; the hub calls it from `apps/hub/src/route.ts` | D13 |

## Hub

| Capability | Status | Evidence | Claimed in |
|---|---|---|---|
| Input gate: a call whose input fails the offer's schema is refused with 422 before payment | `SHIPPED` | `apps/hub/test/call.test.ts`; e2e `refusals` | [terms.md](terms.md) §2, [spec/offer.md](spec/offer.md) |
| The input gate also refuses, with 422 before any 402, an input that canonical JSON cannot hash, such as a fractional number | `SHIPPED` | `apps/hub/src/call.ts`; `apps/hub/test/call.test.ts` "an input canonical JSON refuses is refused before any rail method runs" (`27f9015`) | |
| Delivery gate: the output is checked against the schema, and the slip against the job, before release | `SHIPPED` | `apps/hub/src/delivery.ts`, `apps/hub/test/call.test.ts` | README, [terms.md](terms.md) §2, [spec/offer.md](spec/offer.md) |
| The janitor refunds expired escrow jobs every 30 seconds | `SHIPPED` | `apps/hub/src/index.ts`, `apps/hub/test/call.test.ts`; e2e `ratings` | [terms.md](terms.md) §4 |
| The hub and the console are hosted on Railway | `SHIPPED` | [hub](https://hub-production-e85e.up.railway.app/healthz), [console](https://web-production-a58de.up.railway.app) | README, [deploy.md](deploy.md) |
| Ratings and stats derived from slips: `/ratings`, `/ratings/:seller`, `/stats` | `SHIPPED` | `apps/hub/src/ratings.ts`, `apps/hub/test/ratings.test.ts`; e2e `ratings` ([#20](https://github.com/ss251/countersign/issues/20)) | [ratings.md](ratings.md) |
| Offer search, the sellers list and recent settlements | `SHIPPED` | `apps/hub/src/frontdoor.ts`, `apps/hub/test/frontdoor.test.ts` | [e2e.md](e2e.md) flow 14b |
| A seller's orders and jobs: `GET /orders?seller=`, `GET /orders/:id`, `GET /jobs?seller=` | `SHIPPED` | `apps/hub/src/orders.ts`, `apps/hub/test/orders.test.ts` (`37464ed`, [#32](https://github.com/ss251/countersign/issues/32)) | the console's merchant desk and seller dashboard |
| ERC-8004 seller identity, operator grant and feedback | `SHIPPED` | Library and scripts: `packages/identity`, `scripts/erc8004` (`8499866`, [#2](https://github.com/ss251/countersign/issues/2)), tested against mock registries. Live on Arc testnet: seller `0x6BE98051…ca4a` is agentId 897802 (register `0x845648b6…c267a`, hub relayer as operator `0x1d0586b5…bf27`), seller `0xA55a31E3…B093` is agentId 897803 (`0x23015540…e1cf`), and the buyer gave agent 897802 feedback whose hash is a released slip (`0x3af33b85…d1072`); evidence on #2. Live on Hedera testnet: the MCP seller is agentId 158 (`0xfd8d8683…8235`). The hub shows identities on `/sellers` only where `ERC8004_FROM_BLOCK` is set | [ratings.md](ratings.md) "Limits" |
| A held call cleared from the phone with the approver's signature; one decision clears exactly one call | `IN PROGRESS` | The hub and the agent side are on `main` ([#21](https://github.com/ss251/countersign/issues/21), `apps/hub/test/buyerplumbing.test.ts`, `packages/buyer/test/w1-approval-replay.test.ts`). It is not usable end to end yet: the console's phone does not sign version 2 decisions, and a hub without `HUMAN_APPROVAL_TOKEN` (production today) answers 503 to every decision. Until both land, the human clears a held call on the agent's machine with `buy --approve` | D10, [spec/envelope.md](spec/envelope.md), `docs/architecture.svg` |
| ENS seller names and a payee lock | `IN PROGRESS` | PR [#91](https://github.com/ss251/countersign/pull/91) ([#28](https://github.com/ss251/countersign/issues/28)). Offers name the seller by address | [terms.md](terms.md) §7, true as written |
| A mainnet configuration that refuses to boot while anything is pending | `IN PROGRESS` | PR [#97](https://github.com/ss251/countersign/pull/97) ([#29](https://github.com/ss251/countersign/issues/29)). There is no mainnet configuration | README "Safety limits", [terms.md](terms.md) §6, true as written |
| OpenAI-compatible endpoint for the buyer agent | `IN PROGRESS` | A first cut on `cs/cs-14`, not merged ([#53](https://github.com/ss251/countersign/issues/53)) | |
| Delisting: a route, a canary, automatic delisting | `NOT BUILT` | [#26](https://github.com/ss251/countersign/issues/26). The store has a `delisted` state and no route sets it | [terms.md](terms.md) §1, true as written |
| Refusing a purchase cycle before payment | `NOT BUILT` | [#27](https://github.com/ss251/countersign/issues/27). A call's `lineage` is carried and recorded (`apps/hub/src/call.ts`); nothing refuses a cycle | |
| Receipt trees: `/trees/:root` and the tree view | `NOT BUILT` | [#18](https://github.com/ss251/countersign/issues/18). There is no `/trees` route. Slips carry a `children` list, always empty today; the slip view draws a tree when a slip has children, which so far only the sample data has | [spec/README.md](spec/README.md), [spec/tree.md](spec/tree.md), [spec/slip.md](spec/slip.md), `SlipBody.children` comment |

## Seller's runner

| Capability | Status | Evidence | Claimed in |
|---|---|---|---|
| `skill` adapter: serves a real `SKILL.md` | `SHIPPED` | `packages/runner/test/skill.test.ts`; e2e `arc-spine` | README, [spec/offer.md](spec/offer.md) |
| The runner dials out to the hub, and a restart republishes the same offer | `SHIPPED` | `packages/runner/test/daemon.test.ts`, `restart.test.ts`; e2e `runner-restart` | README, `docs/architecture.svg` |
| `mcp` adapter | `SHIPPED` | On `main` through promotion [#125](https://github.com/ss251/countersign/pull/125) (`e2176b7`), from [#107](https://github.com/ss251/countersign/pull/107). A runner built from it serves the production hub's MCP offer (next row) | [spec/offer.md](spec/offer.md), `docs/architecture.svg`, `AdapterKind` in `packages/core/src/types.ts` |
| Hedera Agent Kit MCP server as a metered listing, paid per call on Hedera | `SHIPPED` | [#42](https://github.com/ss251/countersign/issues/42). On `main` through promotion [#125](https://github.com/ss251/countersign/pull/125) (`e2176b7`), from [#107](https://github.com/ss251/countersign/pull/107). Live on the production hub as offer `0xa594…d04f`: paid with no human in [`0.0.9185802@1793969029.758994311`](https://hashscan.io/testnet/transaction/0.0.9185802@1793969029.758994311) | |
| `openapi` adapter | `NOT BUILT` | No branch | [spec/offer.md](spec/offer.md), `docs/architecture.svg`, `AdapterKind` |
| Phone runner: a phone serves location and photo jobs | `SHIPPED` | On `main` through promotion [#125](https://github.com/ss251/countersign/pull/125) (`e2176b7`), from #104 and #121 (the escrow is read on Arc before a job is served). Hosted on the console at [/phone/](https://web-production-a58de.up.railway.app/phone/) against the production hub ([#96](https://github.com/ss251/countersign/issues/96)). A phone serves only while its page is open. Acceptance passed in a browser against the production hub, and both jobs released on Arc: [`0xa389…ff73`](https://explorer.testnet.arc.io/tx/0xa3898552f658247fc3e4e259ec61e1e99259af762e68a5b885171e41ca98ff73), [`0xd3fc…94a8`](https://explorer.testnet.arc.io/tx/0xd3fc76540f0d91767b56f1c0ebceef077eb0208a044614e207b6bb53bb0994a8). The photo came from a file in an emulated browser; a real phone camera is not checked yet | |

## Buyer agent

| Capability | Status | Evidence | Claimed in |
|---|---|---|---|
| Envelope: cap, per-merchant limit, allowlist, revoke, expiry and the ask-above hold, all checked before signing | `SHIPPED` | `packages/core/test/envelope.test.ts`, `packages/buyer/test/buy.test.ts`; e2e `refusals` | README, [spec/envelope.md](spec/envelope.md), [terms.md](terms.md) §3 |
| The spend is reserved under a journal lock, and a refund gives it back only after `jobOf` reads refunded | `SHIPPED` | `packages/buyer/src/journal.ts`, `packages/buyer/src/resume.ts` | [spec/envelope.md](spec/envelope.md) |
| The 402 is checked against the fetched offer and a pinned rail table before signing | `SHIPPED` | `packages/buyer/test/terms.test.ts`, `packages/buyer/test/w1-attacks.test.ts` | [spec/countersignature.md](spec/countersignature.md), [terms.md](terms.md) §3 |
| The buyer reads Circle's discovery catalogue, and the Circle CLI reads the hub | `SHIPPED` | `packages/buyer/test/catalogue.test.ts`, `scripts/circle/interop.ts` ([#25](https://github.com/ss251/countersign/issues/25)) | [spec/discovery.md](spec/discovery.md) |
| The hub listed in Circle's own catalogue | `NOT BUILT` | Circle's catalogue adds services through the facilitator that settles them, and it held no testnet services on 06 Nov | [spec/discovery.md](spec/discovery.md), which says so |

## Slip and verifier

| Capability | Status | Evidence | Claimed in |
|---|---|---|---|
| The slip, signed by the seller with EIP-712 `Release(jobId, slipHash)` | `SHIPPED` | `packages/core/test/offer-slip.test.ts` | README, [spec/slip.md](spec/slip.md) |
| The slip hash is committed on chain in `Released`, and the verifier checks it | `SHIPPED` | D9; `packages/core/test/slip-commit.test.ts`, `packages/verify/test/onchain.test.ts`; e2e `slip-onchain-arc`, `slip-onchain-whitechain` | README, [spec/slip.md](spec/slip.md) |
| The verifier imports nothing from the hub and prints `VALID` with the hub stopped | `SHIPPED` | `packages/verify/test/verify.test.ts`; e2e `arc-spine` | README, [spec/slip.md](spec/slip.md) |

## Discovery

| Capability | Status | Evidence | Claimed in |
|---|---|---|---|
| A2A card, skills index, OpenAPI 3.1, the Bazaar list, and `extensions.bazaar` on every 402 | `SHIPPED` | `apps/hub/test/discovery.test.ts`; e2e `discovery` | README, [spec/discovery.md](spec/discovery.md) |

## Console

The console at [web-production-a58de.up.railway.app](https://web-production-a58de.up.railway.app) reads the production hub by default; `?hub=off` shows sample data instead. Strings on these screens that claim more than the rows below are being corrected by the console's owners.

| Capability | Status | Evidence | Claimed in |
|---|---|---|---|
| Overview at `#/`: the live offer count, the rails, and recent settlements with explorer links | `SHIPPED` | `apps/web/src/routes/home/`; e2e `production-hub` checks every hub route it reads | README "Live links" |
| Registry: every seller and its offers from the hub, with delivery counts, and the ERC-8004 identity where the hub's lookup is on | `SHIPPED` | `apps/web/test/registry.test.ts`; `GET /sellers` | |
| Assistant: searches the live offers, says why each one matches, checks the envelope, and hands back the command the agent runs to countersign. Holding on the page signs nothing | `SHIPPED` | `apps/web/test/assistant.test.ts`; `GET /offers/search` | |
| Offer page: the terms, both schemas, the rails and the hub's discovery links | `SHIPPED` | `apps/web/src/routes/offer/`; e2e `production-hub` | |
| Slip view and the in-browser verifier: the hash and signatures are recomputed in the browser, and the chain is read for escrow slips | `SHIPPED` | `apps/web/test/verify.test.ts`, and `apps/web/test/onchain.live.test.ts` with `CS_LIVE=1` | README "The receipt" |
| Buyer phone: the agent's envelope, its pending approvals and its history | `IN PROGRESS` | History reads `GET /jobs?buyer=` (`apps/web/test/buyer.test.ts`). The envelope and approval reads answer 503 on a hub without `HUMAN_APPROVAL_TOKEN`, which production does not set, and approving needs the console to sign version 2 decisions (the approvals row above) | `docs/architecture.svg` |
| Merchant desk: a seller's orders from the hub, falling back to the Whitechain relay's records, with net, fees, refunds and the accountant's CSV | `SHIPPED` | `apps/web/test/merchant.test.ts`; #83 (`34cb1d1`) and `55221ef`; e2e `merchant` tests the merchant service behind the desk, not the screen. The public console shows orders but cannot refund them: refunds go through the merchant's own service, and it has none configured | [whitechain.md](whitechain.md) |
| Merchant desk review states: in review, disputed, failed | `IN PROGRESS` | On `main` through promotion [#125](https://github.com/ss251/countersign/pull/125) (`e2176b7`), from [#114](https://github.com/ss251/countersign/pull/114). Dormant until the review contract (#98) is deployed | |
| Seller dashboard: the seller's listings and calls from the hub | `SHIPPED` | `apps/web/src/routes/seller/Dashboard.tsx`; `GET /jobs?seller=` | |
| Publish wizard: builds the offer and the runner command that signs and publishes it. The page itself publishes nothing | `SHIPPED` | `apps/web/test/seller.test.ts`, `apps/web/src/routes/seller/logic.ts` | |

## Operations

| Capability | Status | Evidence | Claimed in |
|---|---|---|---|
| End-to-end suite that checks every payment on chain | `SHIPPED` | `e2e/`, [e2e/runs/LATEST.md](../e2e/runs/LATEST.md) | README, [e2e.md](e2e.md) |
| CI runs typecheck, the bun tests, forge and the web build on every pull request, offline | `SHIPPED` | `.github/workflows/ci.yml` | CONTRIBUTING |
| Squash-only merges and delete-branch-on-merge | `SHIPPED` | repository settings | CONTRIBUTING |
| An Arc Studio project link that opens logged out | `NOT BUILT` | Studio has no public-project link (D6) | README, which says so |
| Threat model, seller and buyer guides, interop doc | `IN PROGRESS` | PR [#100](https://github.com/ss251/countersign/pull/100) ([#30](https://github.com/ss251/countersign/issues/30)) | |
| Railway's GitHub app, so production follows `main` | `NOT BUILT` | Needs the owner's install | [deploy.md](deploy.md), as a target |

## Cut

| Capability | Status | Evidence | Claimed in |
|---|---|---|---|
| Paid sessions | `CUT` | D14 | |
| Unified balance | `CUT` | D14 | |
| Subgraph and `/graph/stats` | `CUT` | D14: no indexer account for Arc testnet ([#4](https://github.com/ss251/countersign/issues/4)) | |
| Railway preview environments per pull request | `CUT` | D14 | [deploy.md](deploy.md) |
| A headless browser for the e2e `web` flow | `CUT` | D14. The visual checks are done by hand in a real browser | [e2e.md](e2e.md) flow 9 |
