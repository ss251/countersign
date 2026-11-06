# Ratings and stats

The hub serves three read-only routes: `GET /ratings`, `GET /ratings/:seller` and `GET /stats`. Every number in them is derived from the hub's own `jobs`, `offers` and `slips` tables. Nobody reports a rating, and nobody can edit one. The code is in `apps/hub/src/ratings.ts`.

## What counts

Every job a seller's offers have taken lands in exactly one bucket.

| Bucket | What it means | Effect on the score |
|---|---|---|
| `delivered` | Closed, and the stored slip checks out (see below). | for |
| `failed` | The seller's runner took the job and refused it, returned output or a slip that did not pass, or ran past the offer's own deadline. The money has not come back yet. | against |
| `refunded` | As `failed`, and the money has gone back to the buyer. | against |
| `excused` | Failed or refunded, but not on the seller: the runner was not connected, the connection dropped, or the hub cut the job short before the offer's deadline. A refund of a job that never recorded a failure, such as after a hub crash, also lands here. | none |
| `open` | Paid or funded, not closed yet. | none yet |
| `unverified` | Closed as released or settled, but the slip is missing or does not check out. | none |
| `selfDealt` | The buyer is the seller, or the slip's payee. | none |

A slip checks out when it hashes to its own body, names this job, offer, buyer, seller and amount, and carries a `Release` signature that recovers to the offer's seller.

`score = delivered / (delivered + failed + refunded)`, to four places. It is `null` until something has closed.

The hub records the fault when a delivery fails. A failure the runner reports is always the seller's, whatever reason the runner gives, so a runner cannot dodge a failure by claiming the link dropped. Jobs stored before the hub recorded faults have none, and they land in `excused`.

## Other fields

- **`buyers`**: the distinct buyers behind delivered jobs.
- **`topBuyerShare`**: the share of delivered jobs bought by the single busiest buyer. It is `null` when nothing has been delivered.
- **`volume`**: the delivered amounts in atomic units, summed across rails as 6-decimal USD stablecoins.
- **`lastDeliveredAt`**: the newest delivered slip's `deliveredAt`.

`/ratings/:seller` adds a line per offer. `/stats` adds offer and seller counts, a per-rail breakdown, `runnersOnline` and `asOf`.

## Limits

- **Wash trading is not excluded.** `selfDealt` catches only a buyer that is the seller's own address or payee. A seller who funds a second wallet and buys their own offer adds to `delivered`, `buyers` and `volume`, at the cost of the price, the toll and the gas. Without identity, the hub cannot tell that wallet from a stranger. Read a high score together with `buyers` and `topBuyerShare`: many deliveries from one or two wallets, or a `topBuyerShare` near 1, should not be trusted. ERC-8004 feedback tied to slips (#2) does not change this, because the same second wallet can leave feedback.
- **A buyer can still make a job fail.** Input that is valid under the offer's schema but makes the seller's code refuse counts as the seller's failure. On escrow rails that buyer gets a refund, so it costs them only gas. `failed` and `refunded` are separate fields, and a reader can weigh a few failures from one buyer accordingly.
- **The numbers can be a few seconds old.** One snapshot serves every route for `ratingsCacheSeconds`, 5 by default. A burst of requests reads the ledger once, and `asOf` says when it was read. The routes are unauthenticated and read-only. Each rebuild still reads the whole jobs table, which is fine at testnet scale; a summary table is the next step if it is not.
