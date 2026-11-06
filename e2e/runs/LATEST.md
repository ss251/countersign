<!-- the latest full run; its own file is 20261106-112218-694a.md -->
# e2e run 20261106-112218-694a

| | |
|---|---|
| commit | `e803f1e` on `HEAD` |
| started | 2026-11-06 11:22:18 UTC (16:52 IST) |
| duration | 224.6 s |
| scope | full run, every flow |
| result | 14 pass · 0 fail · 0 skipped · 1 not run |

| # | Flow | Status | Time | Failed step |
|---|---|---|---|---|
| 1 | `arc-spine` | PASS | 7.3 s |  |
| 1b | `runner-restart` | PASS | 2.2 s |  |
| 2 | `arc-wrong-amount` | PASS | 2.6 s |  |
| 3 | `arc-deadline-refund` | PASS | 50.2 s |  |
| 4a | `slip-onchain-arc` | PASS | 2.6 s |  |
| 10 | `arc-gateway` | PASS | 2.7 s |  |
| 11 | `refusals` | PASS | 2.7 s |  |
| 13 | `ratings` | PASS | 66.1 s |  |
| 5 | `whitechain` | PASS | 30.5 s |  |
| 4b | `slip-onchain-whitechain` | PASS | 3.8 s |  |
| 6 | `hedera` | PASS | 15.5 s |  |
| 7 | `merchant` | PASS | 21.0 s |  |
| 8 | `discovery` | PASS | 3.7 s |  |
| 12 | `public-spine` | PASS | 13.0 s |  |
| 9 | `web` | NOT RUN (browser rule) |  |  |

## Transactions

**arc-spine**

- fund: [`0x380edbe1…198779`](https://explorer.testnet.arc.io/tx/0x380edbe1a71e77c2b4b0ac487cc1e54167c56c988dd3e3bd2c1fcc662a198779)
- release: [`0xa01871aa…9dc4ca`](https://explorer.testnet.arc.io/tx/0xa01871aa077b9c2204821c69803de0c45a47a1ba892e938425cd43bedb9dc4ca)

**arc-wrong-amount**

- fund at twice the signed price (reverted, as expected): [`0xd6e3dfea…6839f1`](https://explorer.testnet.arc.io/tx/0xd6e3dfea0ad855c6d6d47038f1ccac8c1c5b2a9d742be32915d4f70d196839f1)

**arc-deadline-refund**

- fund: [`0x3fc3094d…635c95`](https://explorer.testnet.arc.io/tx/0x3fc3094d0583e871d3e169401808031f5cbc2c5ad966e80055ab31cb03635c95)
- refund by a stranger: [`0xd9361f02…f946e5`](https://explorer.testnet.arc.io/tx/0xd9361f0210d061c98ea2e27fdba6ea81037d5894e0099c252207c3df5cf946e5)

**slip-onchain-arc**

- release: [`0xa01871aa…9dc4ca`](https://explorer.testnet.arc.io/tx/0xa01871aa077b9c2204821c69803de0c45a47a1ba892e938425cd43bedb9dc4ca)

**ratings**

- refund by the hub's janitor: [`0xb4c09bd9…5240c4`](https://explorer.testnet.arc.io/tx/0xb4c09bd965791152595d877db45fef3cc4ff5316410a36357c34868fa05240c4)

**whitechain**

- sale fund: [`0x583217fd…e77af3`](https://explorer.testnet.whitechain.io/tx/0x583217fda078484141a0f29438bb38b4bb1e27ee0912cd2ebf63902635e77af3)
- sale release: [`0x3c5e1d57…5d155b`](https://explorer.testnet.whitechain.io/tx/0x3c5e1d57954af8df28dc8ab7108c74efe2c42750c7f130d35fa4798e665d155b)
- one-click refund: [`0x3fff5a15…92c4d7`](https://explorer.testnet.whitechain.io/tx/0x3fff5a15757485742274622e64a355c3779c9794645753e33e2c3e01aa92c4d7)

**slip-onchain-whitechain**

- release: [`0x3c5e1d57…5d155b`](https://explorer.testnet.whitechain.io/tx/0x3c5e1d57954af8df28dc8ab7108c74efe2c42750c7f130d35fa4798e665d155b)

**hedera**

- agent payment: [`0.0.918580…723866`](https://hashscan.io/testnet/transaction/0.0.9185802@1793964308.321723866)

**merchant**

- sale fund: [`0x3abe2327…c0c72c`](https://explorer.testnet.whitechain.io/tx/0x3abe23276070b3e25f81ddc6901ed8a2a4c6236c9094dd44f3c20e875fc0c72c)
- sale release: [`0x52ead041…ec9363`](https://explorer.testnet.whitechain.io/tx/0x52ead041863ca7c12af14e10f0b06ce322ea094030512f4f529a73aee9ec9363)
- partial refund: [`0xc41d8d7f…c8dc83`](https://explorer.testnet.whitechain.io/tx/0xc41d8d7f728ea7608a85525a657f82df863defae790a978316b3027467c8dc83)

**public-spine**

- fund (public hub): [`0xae1fccd9…321acc`](https://explorer.testnet.arc.io/tx/0xae1fccd971024ff78798f21bdf4b7a7226d50d111061d5eaccaf5167ba321acc)
- release (public hub): [`0x2fdd0733…d83382`](https://explorer.testnet.arc.io/tx/0x2fdd07337366c90882b674a61cc18e2d2f847f6efdaceadde4d5528730d83382)

## Notes

- `arc-gateway`: Gateway transfer 9d5c6c3a-7481-4d4b-a64c-0c38007fd381; the seller is credited in Gateway's next batch
- `hedera`: facilitator: x402.org
- `hedera`: spend log: topic 0.0.11337070 sequence 21
- `hedera`: reconciled 1 agent payment(s) and 1 spend entry since 1793964305
- `public-spine`: bought use-arc 0xdd24c0f8 from seller 0x6BE98051B852824A3923E3B27f9781Ceb0C0ca4a

## Steps

**arc-spine**

- ok · hub up · 465 ms
- ok · seller publishes use-arc · 234 ms
- ok · buyer discovers · 216 ms
- ok · envelope approves · 169 ms
- ok · seller balance before · 182 ms
- ok · countersign, fund, deliver, release · 3.3 s
- ok · hub job record · 1 ms
- ok · chain agrees · 1.1 s
- ok · slip names its rail · 717 ms
- ok · hub stopped · 12 ms
- ok · verifier VALID with the hub stopped · 936 ms

**runner-restart**

- ok · hub up · 348 ms
- ok · runner serves use-arc · 158 ms
- ok · runner stops, offer goes offline · 4 ms
- ok · runner restarts: same offer, back online · 141 ms

**arc-wrong-amount**

- ok · hub up · 345 ms
- ok · seller publishes use-arc · 213 ms
- ok · 402 challenge · 3 ms
- ok · buyer countersigns the listed price · 4 ms
- ok · hub refuses a moved price · 186 ms
- ok · chain refuses a moved price · 1.6 s
- ok · the signature holds at the signed price · 200 ms

**arc-deadline-refund**

- ok · hub up · 345 ms
- ok · seller publishes use-arc with a 45 s deadline · 156 ms
- ok · envelope approves · 143 ms
- ok · buyer pays, seller cannot deliver · 1.8 s
- ok · escrow holds the money · 365 ms
- ok · hub stopped · 16 ms
- ok · a refund before the deadline is refused · 357 ms
- ok · chain passes the deadline · 44.0 s
- ok · a stranger refunds · 2.8 s
- ok · the refund is final · 184 ms

**slip-onchain-arc**

- ok · the slip agrees with itself · 0 ms
- ok · Released carries the slip hash · 653 ms
- ok · the escrow stores the slip hash · 178 ms
- ok · the genuine slip verifies · 990 ms
- ok · a tampered slip fails on chain · 776 ms

**arc-gateway**

- ok · hub up with the escrow and Gateway rails · 829 ms
- ok · seller publishes use-arc on both rails · 217 ms
- ok · 402 offers Circle Gateway · 2 ms
- ok · envelope approves · 147 ms
- ok · buyer's Gateway balance before · 280 ms
- ok · buyer pays through Gateway · 817 ms
- ok · Gateway debits the buyer at once · 267 ms
- ok · slip names the gateway rail and verifies · 108 ms

**refusals**

- ok · hub up · 341 ms
- ok · seller publishes use-arc · 158 ms
- ok · the hub's input gate refuses a bad input · 1 ms
- ok · the buyer refuses a bad input before signing · 313 ms
- ok · over the budget · 308 ms
- ok · over the per-seller limit · 326 ms
- ok · seller not on the allowlist · 317 ms
- ok · envelope revoked · 307 ms
- ok · held above ask-above until the human approves · 354 ms
- ok · seller offline: refused, nothing charged · 296 ms

**ratings**

- ok · hub up · 332 ms
- ok · seller publishes use-arc with a 45 s deadline · 158 ms
- ok · a buyer's call is delivered · 3.1 s
- ok · the seller buys from itself · 3.0 s
- ok · a buyer's call fails delivery · 1.9 s
- ok · the seller's rating counts what the slips prove · 4 ms
- ok · hub stats agree · 1 ms
- ok · the hub's janitor refunds the failed call after its deadline · 57.6 s
- ok · the rating follows the refund · 2 ms

**whitechain**

- ok · relay up with the suite's gas wallet · 1.1 s
- ok · merchant server up · 161 ms
- ok · hub up on the Whitechain rail · 435 ms
- ok · merchant publishes whitechain-dev · 206 ms
- ok · buyer holds no gas before paying · 926 ms
- ok · sale · envelope approves · 142 ms
- ok · sale · buyer pays in USDT, released · 16.7 s
- ok · sale · chain agrees, relayer paid every fee · 1.5 s
- ok · buyer holds no gas after paying · 552 ms
- ok · the merchant sees the order · 14 ms
- ok · merchant refunds in one click · 8.1 s
- ok · buyer holds no gas after the refund · 554 ms

**slip-onchain-whitechain**

- ok · the slip agrees with itself · 0 ms
- ok · Released carries the slip hash · 745 ms
- ok · the escrow stores the slip hash · 193 ms
- ok · the genuine slip verifies · 1.5 s
- ok · a tampered slip fails on chain · 1.4 s

**hedera**

- ok · hub up with the Hedera rail · 1.4 s
- ok · seller lists an offer paid on Hedera · 196 ms
- ok · 402 names the Hedera rail · 2 ms
- ok · agent pays with no human step · 5.5 s
- ok · mirror node confirms the transfer · 320 ms
- ok · spend log entry on HCS · 309 ms
- ok · envelope refuses past its cap, and logs it · 6.8 s
- ok · the spend log is complete for this run · 927 ms

**merchant**

- ok · relay up with the suite's gas wallet · 1.2 s
- ok · merchant server up · 162 ms
- ok · hub up on the Whitechain rail · 336 ms
- ok · merchant publishes whitechain-dev · 194 ms
- ok · sale · envelope approves · 159 ms
- ok · sale · buyer pays in USDT, released · 12.7 s
- ok · sale · chain agrees, relayer paid every fee · 923 ms
- ok · totals match the chain · 12 ms
- ok · partial refund of 0.005 USDT · 5.3 s
- ok · totals move by the refund and nothing else · 5 ms
- ok · the accountant's export · 6 ms
- ok · no token, no refund · 5 ms

**discovery**

- ok · local hub up · 416 ms
- ok · seller publishes use-arc · 184 ms
- ok · local · healthz · 1 ms
- ok · local · offer list · 1 ms
- ok · local · A2A agent card · 4 ms
- ok · local · skills index · 1 ms
- ok · local · OpenAPI · 1 ms
- ok · local · Bazaar list · 1 ms
- ok · local · unpaid call answers 402 · 2 ms
- ok · public · healthz · 419 ms
- ok · public · offer list · 293 ms
- ok · public · A2A agent card · 1.2 s
- ok · public · skills index · 294 ms
- ok · public · OpenAPI · 292 ms
- ok · public · Bazaar list · 282 ms
- ok · public · unpaid call answers 402 · 299 ms

**public-spine**

- ok · the public hub lists a live Arc offer · 297 ms
- ok · envelope approves · 143 ms
- ok · buyer pays through the public hub · 10.1 s
- ok · chain agrees · 935 ms
- ok · slip verifies with no hub · 1.6 s

Artifacts for this run (bodies, logs, slips) stay on the build machine under `e2e/artifacts/20261106-112218-694a/`.
