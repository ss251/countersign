# Threat model

Who can do what to whom in countersign, what stops them, and what does not. It describes the code on `cs/int`. A defence named here has a test or a contract behind it, linked where it lives. A decision that is written down but not yet built is marked **decided, not built**.

## Parties and what each one holds

| Party | Holds | Trusted for |
|---|---|---|
| **Human** | The envelope: cap, per-merchant limits, allowlist, ask-above, revoke | Setting limits. Nothing else in the system acts for them. |
| **Buyer agent** (`packages/buyer`) | The buyer key (`CS_BUYER_KEY`), the envelope, a journal, slips | Signing only inside the envelope and only for terms it checked itself |
| **Seller runner** (`packages/runner`) | The seller key (`CS_SELLER_KEY`), the skills it serves | Doing the work and signing slips for it |
| **Hub** (`apps/hub`) | Offers, jobs, slips. On Arc, one relayer key (`CS_RELAYER_KEY`) | Nothing the buyer pays on. Every buyer-side check assumes the hub may be hostile. |
| **Relay** (`packages/relay`) | The Whitechain gas key | Submitting transactions it has checked. It cannot change what was signed. |
| **Escrow** (`contracts/src/CountersignedEscrow.sol`) | Funded jobs | Enforcing the countersignature, the release signature and the deadline. It has no owner, no pause and no proxy. |
| **Facilitators** (Hedera hosted x402, Circle Gateway) | Fee-payer keys, Gateway balances | Settling a transfer the buyer already signed |

The hub holds no buyer key and no seller key. The buyer's money never sits with the hub: it moves to the escrow, straight to the seller (Hedera), or into the buyer's own Gateway balance ([terms.md](terms.md), section 2).

## What the buyer's signature binds

On escrow rails the buyer signs one EIP-3009 `ReceiveWithAuthorization`. Its nonce is the `jobId`, an EIP-712 hash of the offer hash, buyer, payee, amount, deadline and salt under the escrow's domain. So one signature fixes:

- the offer;
- the payee and the amount;
- the deadline;
- the chain and the escrow ([spec/countersignature.md](spec/countersignature.md)).

On Hedera the signed transfer fixes the amount and the payee, and its memo `cs1:<offerHash>` fixes the offer.

## Threats and defences

### A hostile hub

The hub is the party with the most reach and the least trust. It serves the offer, the 402 and the job status, and on Arc it submits transactions.

| The hub tries to | What stops it | Where |
|---|---|---|
| Serve a different offer than the one asked for | The buyer re-hashes the served offer and refuses unless it equals the requested hash | `packages/buyer/src/buy.ts`; `w1-attacks.test.ts` |
| Ask a higher price, another payee, another offer hash or a longer delivery window in the 402 | The buyer compares every signed field with the fetched offer and refuses before signing | `packages/buyer/src/terms.ts`; `w1-attacks.test.ts` |
| Name its own escrow, token or chain | The buyer signs only for escrows and Gateways pinned in `known-rails.ts`, plus any the user adds in `rails.json` | `packages/buyer/src/known-rails.ts` |
| Pay someone other than a named seller | An offer that names an ENS seller is checked by the buyer itself on Sepolia. The name must resolve to the seller, and every EVM payee must be that address. Lookups never follow CCIP-Read. A Hedera payee is outside the lock. | `packages/core/src/ens.ts`; [spec/offer.md](spec/offer.md) |
| Change the amount after the buyer signed | The escrow derives `jobId` from the amount, so the authorisation no longer matches and `fund` reverts on chain | [Arc, price moved](https://explorer.testnet.arc.io/tx/0xca61627848d1ea952c5953ac58df7b8bd780777563e24ebccf5bb90315d20e76) |
| Replay one countersignature | The token's EIP-3009 nonce is spent once, and the escrow refuses an existing job | `contracts/test`; `spec/escrow.md` |
| Claim a refund happened, to give the buyer budget back | The journal returns the spend only when the escrow's `jobOf` on chain says refunded | [spec/envelope.md](spec/envelope.md) |
| Forge or edit a slip | The slip hash commits to the body. The seller's `Release` signature must recover to the seller, and with `--rpc` the escrow's `Released` event must carry the same hash. | `packages/verify`; [spec/slip.md](spec/slip.md) |
| Name a Hedera fee payer that never settles, parking the signed payment | The Hedera agent signs only for fee payers published by its trusted facilitator list | `packages/buyer/src/hedera/agent.ts` |
| Keep the buyer's money after a failed delivery | On escrow rails anyone may call `refund` after the deadline. The hub sweeps those refunds, but does not have to cooperate for them to happen. | `CountersignedEscrow.refund` |

What a hostile hub **can** still do:

- **Withhold service.** It can refuse calls, hide offers or go down. A funded escrow job that was never released refunds after the deadline.
- **Release, then withhold the result.** The hub releases the escrow before it answers the buyer (`paidCall`: settle, dispatch, check, release, respond). A hub, alone or with the seller, can release against the seller's real slip and then send the buyer nothing, or a tampered slip. The seller has been paid, and nothing refunds it. The buyer's evidence is the escrow's `Released(jobId, slipHash)` event. A buyer missing its result reads `jobOf(jobId)`: Funded means a refund after the deadline, and Released means the money is the seller's.
- **Pass bad output on direct rails.** On Hedera and Gateway the payment settles before delivery, and there is no escrow to refund from ([terms.md](terms.md), section 4).
- **Collude with a seller to release.** Release needs only the payee's signature. A hub and seller together can release a funded job against output the buyer never got. The slip's `outputHash` is the buyer's evidence, not a remedy.
- **Lie in its read routes.** `/ratings`, `/stats`, `/sellers` and `/settlements` are the hub's own account. A buyer that needs proof verifies slips itself.

### A hostile seller

| The seller tries to | What stops it | Where |
|---|---|---|
| Take payment and not deliver | On escrow rails the job refunds after the deadline | `CountersignedEscrow.refund` |
| Deliver output that fails the offer's schema | The hub checks output against the schema and the slip before release. A failure is never released. | `apps/hub/src/call.ts` |
| Raise the price on a listed offer | Any change is a new offer with a new hash, and the old countersignature names the old hash | [spec/offer.md](spec/offer.md) |
| Publish an offer under someone else's address | The hub requires the seller's EIP-191 signature over `countersign offer <offerHash>` | `apps/hub/src/app.ts` |
| Serve jobs as someone else's runner | The runner must sign the hub's fresh nonce with the seller key before it is sent any job | `apps/hub/src/runners.ts` |
| Read the runner's secrets from a skill | Each job runs in a child process with only `PATH` and a fresh empty `HOME`, a 30 s time limit and a 1 MB output limit | `packages/runner/src/child.ts`, `daemon.ts` |
| Inflate its rating | Ratings count only slips that check out, and ignore self-purchases by the seller's own address or payee | [ratings.md](ratings.md) |

What a hostile seller **can** still do:

- **Deliver junk that passes the schema.** Nothing judges content. The review window and dispute that would catch it (D12) are **partly built**: the buyer's `accept` and `dispute` commands are on `cs/int`, but the contract change is in progress (#98), and no deployed escrow has a review window.
- **Wash-trade its rating.** It can fund a second wallet and buy its own offer. Read `buyers` and `topBuyerShare` with the score ([ratings.md](ratings.md), Limits).
- **Dodge a failure by dropping the connection.** A runner that accepts a job and then closes its socket is marked `excused`, not failed. This is an open review finding on #20.
- **Post a bond it never has to pay, today.** The bond (D11) is built on `cs/int`:
  - the escrow locks it with `fundBonded`;
  - the hub's delivery gate pays it to the buyer through `failDelivery` (`apps/hub/src/bond.ts`);
  - the runner deposits and withdraws it with `runner bond`.

  The deployed escrows are still v1, so none of them holds a bond until the v2 deployment under #98.

### A hostile or careless buyer

| The buyer tries to | What stops it | Where |
|---|---|---|
| Pay less than the price | The hub refuses a payment whose amount is not the offer's price | `apps/hub/src/call.ts` |
| Reuse one payment for two calls | The hub refuses a payment it has already seen, and the token's nonce is spent | `apps/hub/src/call.ts` |
| Send input the seller cannot handle | The hub refuses input that fails the offer's input schema, before any payment | `apps/hub/src/call.ts` |

What a buyer **can** still do: send input that is valid under the schema but makes the seller's code refuse. That counts against the seller. On escrow rails the buyer gets a refund, at the cost of gas ([ratings.md](ratings.md), Limits).

### A compromised agent or prompt-injected agent

The envelope is the human's control over an agent that may be wrong or manipulated.

- **Before signing,** the agent checks revoke, expiry, the allowlist, the cap and the per-merchant limit. It then reserves the spend in its journal under a file lock, so two concurrent calls cannot both fit under one cap ([spec/envelope.md](spec/envelope.md)).
- **Above `askAbove`,** the call is held. It clears with `--approve` on the agent's machine, or, with `buy --approvals hub` and an `approver` key in the envelope, by a decision the phone signs (D10, [spec/envelope.md](spec/envelope.md)).
  - The agent rebuilds the signed body from its own request values and checks the signature against `approver`, so the hub's word never clears a hold.
  - Each approval id clears one call: the agent records the ids it has used and refuses an old one served again.
  - Without an `approver`, a held call can be approved only on the agent's machine.
- **A stolen agent key** spends up to the envelope's limits on whatever the thief chooses. The envelope is enforced by the agent's own code, not on chain. Keep the cap small, and use `envelope set --revoke` to stop it.

### Catalogues and discovery

A catalogue can list anything.

- The buyer marks only items whose rail it already pins, and a listing never adds a rail ([spec/discovery.md](spec/discovery.md)).
- `buy <callUrl>` re-reads the offer from the URL's hub and re-hashes it.

Open review findings on #25:

- one listing with an amount that is not a whole-number string crashes `discover --catalogue`;
- names and URLs are printed without removing control characters;
- `buy <callUrl>` accepts any `http` or `https` host, including private addresses. That matters if an untrusted prompt can choose the URL.

### Relayers and gas keys

- **Arc.** The hub's relayer key (`CS_RELAYER_KEY`) submits `fund` and `release` on the escrow rail, and the buyer's transfer on the eip3009 rail, and pays their gas. It cannot change what the buyer or seller signed. It can only refuse to submit, and the deadline refund still works without it.
  - **It has no spending limits.** It has none of the Whitechain relay's checks below: no ceiling, fee cap or balance floor.
  - **A seller can make the hub pay gas at almost no cost.** It lists an offer at the smallest price and buys it from a second wallet, so the hub pays `fund` and `release` gas on every call. Watch the relayer's balance, and keep only what a day of testnet calls needs on it.
- **Whitechain.** The relay pays gas for strangers, so it has its own checks, applied before anything is broadcast ([whitechain.md](whitechain.md), "What stops the relayer being drained"):
  - an allowlist of target calls;
  - simulate first;
  - a fee cap and an hourly ceiling;
  - a balance floor;
  - serial nonces;
  - refunds tied to a recorded payment.

### The token and the chain

- If the token blocklists the treasury, releases revert until the deadline, and buyers recover by refund.
- If the token blocklists a buyer, refunds to that buyer revert ([spec/escrow.md](spec/escrow.md), Known limits).
- Every rail is on a testnet. A testnet can reorganise, reset or change its token, and nothing here hedges against that.

## Out of scope

- Judging whether output is good. The gate is mechanical: schema, slip and signature.
- Arbitration of any kind.
- Seller identity beyond a key. ERC-8004 lookups are shown when present and prove registration, not honesty.
- Availability: denial of service against the hub, a relay or a facilitator.
- Keys taken from the machine that holds them. Every key is read from the environment, and its safety is the operator's.

## Reporting

Report a security problem privately to the repository owner rather than in a public issue.
