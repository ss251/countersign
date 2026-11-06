<!-- the latest full run; its own file is 20261106-110132-1319.md -->
# e2e run 20261106-110132-1319

| | |
|---|---|
| commit | `e99b54b with local changes` on `cs/e2e` |
| started | 2026-11-06 11:01:32 UTC (16:31 IST) |
| duration | 153.6 s |
| scope | full run, every flow |
| result | 9 pass · 1 fail · 0 skipped · 1 not run |

| # | Flow | Status | Time | Failed step |
|---|---|---|---|---|
| 1 | `arc-spine` | PASS | 6.9 s |  |
| 1b | `runner-restart` | FAIL | 2.2 s | `runner restarts: same offer, back online` |
| 2 | `arc-wrong-amount` | PASS | 2.6 s |  |
| 3 | `arc-deadline-refund` | PASS | 49.7 s |  |
| 4a | `slip-onchain-arc` | PASS | 2.4 s |  |
| 5 | `whitechain` | PASS | 33.7 s |  |
| 4b | `slip-onchain-whitechain` | PASS | 3.8 s |  |
| 6 | `hedera` | PASS | 17.8 s |  |
| 7 | `merchant` | PASS | 29.8 s |  |
| 8 | `discovery` | PASS | 4.2 s |  |
| 9 | `web` | NOT RUN (browser rule) |  |  |

## Transactions

**arc-spine**

- fund: [`0x5c054777…0c473a`](https://explorer.testnet.arc.io/tx/0x5c054777b89de01b4f7762e024929d6012be05ff0207b00ec258dced520c473a)
- release: [`0x2599a182…04ea9e`](https://explorer.testnet.arc.io/tx/0x2599a1828d3799dc4547b6f0cf699a71d10b50cff993f6b6778fe4f02504ea9e)

**arc-wrong-amount**

- fund at twice the signed price (reverted, as expected): [`0x8b21f479…4d8d56`](https://explorer.testnet.arc.io/tx/0x8b21f4791e6a9486de3375f5c330bdd4900fbda6581b94a41c7ca786c14d8d56)

**arc-deadline-refund**

- fund: [`0x9174428b…71a181`](https://explorer.testnet.arc.io/tx/0x9174428b9ab127cde138d6212e2870837f0a2a51cc70c9ef0e1e01e6ad71a181)
- refund by a stranger: [`0x005b2fc5…ca73c6`](https://explorer.testnet.arc.io/tx/0x005b2fc55153102c7cd2078e4a3b5752b047c50488052a7d0af3dd134cca73c6)

**slip-onchain-arc**

- release: [`0x2599a182…04ea9e`](https://explorer.testnet.arc.io/tx/0x2599a1828d3799dc4547b6f0cf699a71d10b50cff993f6b6778fe4f02504ea9e)

**whitechain**

- sale fund: [`0xc00f7895…b0ff8d`](https://explorer.testnet.whitechain.io/tx/0xc00f7895b254926077b20f8daf064c3a1e37b1393e758fa4da5bc53638b0ff8d)
- sale release: [`0x11f8cf41…cf02b9`](https://explorer.testnet.whitechain.io/tx/0x11f8cf412f45d6f157e8b1313e288c9fc4569e726bb7469cef8970aa66cf02b9)
- one-click refund: [`0x0eed6412…5fa854`](https://explorer.testnet.whitechain.io/tx/0x0eed641214a6ee51244c1fd60adb8d23cbd0795f35f36202ea8cf084e75fa854)

**slip-onchain-whitechain**

- release: [`0x11f8cf41…cf02b9`](https://explorer.testnet.whitechain.io/tx/0x11f8cf412f45d6f157e8b1313e288c9fc4569e726bb7469cef8970aa66cf02b9)

**hedera**

- agent payment: [`0.0.918580…602960`](https://hashscan.io/testnet/transaction/0.0.9185802@1793962991.941602960)

**merchant**

- sale fund: [`0x56d6ac37…020e67`](https://explorer.testnet.whitechain.io/tx/0x56d6ac370b2c256a6bf8b720103fdc93e814cd1f0a0a55697050872ecc020e67)
- sale release: [`0x1c9e6f05…c10078`](https://explorer.testnet.whitechain.io/tx/0x1c9e6f053cbd3fa305ed062004a52f437d73f9a077cebd1939ae552b3ac10078)
- partial refund: [`0x264426f3…f6ffdd`](https://explorer.testnet.whitechain.io/tx/0x264426f328c3c92ccdd979aae21b62e5fc7f9fcebef121bf012f5bb92ff6ffdd)

## Failures

**runner-restart** · step `runner restarts: same offer, back online` · owner orch-cs

> offer online: expected true, got false

## Notes

- `hedera`: facilitator: x402.org
- `hedera`: spend log: topic 0.0.11337070 sequence 12

## Steps

**arc-spine**

- ok · hub up · 416 ms
- ok · seller publishes use-arc · 235 ms
- ok · buyer discovers · 165 ms
- ok · envelope approves · 154 ms
- ok · seller balance before · 179 ms
- ok · countersign, fund, deliver, release · 3.0 s
- ok · hub job record · 1 ms
- ok · chain agrees · 1.1 s
- ok · slip names its rail · 780 ms
- ok · hub stopped · 7 ms
- ok · verifier VALID with the hub stopped · 953 ms

**runner-restart**

- ok · hub up · 338 ms
- ok · runner serves use-arc · 161 ms
- ok · runner stops, offer goes offline · 4 ms
- FAIL · runner restarts: same offer, back online · 164 ms · offer online: expected true, got false

**arc-wrong-amount**

- ok · hub up · 364 ms
- ok · seller publishes use-arc · 185 ms
- ok · 402 challenge · 3 ms
- ok · buyer countersigns the listed price · 4 ms
- ok · hub refuses a moved price · 185 ms
- ok · chain refuses a moved price · 1.7 s
- ok · the signature holds at the signed price · 184 ms

**arc-deadline-refund**

- ok · hub up · 333 ms
- ok · seller publishes use-arc with a 45 s deadline · 160 ms
- ok · envelope approves · 146 ms
- ok · buyer pays, seller cannot deliver · 1.8 s
- ok · escrow holds the money · 363 ms
- ok · hub stopped · 8 ms
- ok · a refund before the deadline is refused · 367 ms
- ok · chain passes the deadline · 45.0 s
- ok · a stranger refunds · 1.3 s
- ok · the refund is final · 176 ms

**slip-onchain-arc**

- ok · the slip agrees with itself · 0 ms
- ok · Released carries the slip hash · 351 ms
- ok · the escrow stores the slip hash · 191 ms
- ok · the genuine slip verifies · 1.0 s
- ok · a tampered slip fails on chain · 791 ms

**whitechain**

- ok · relay up with the suite's gas wallet · 1.3 s
- ok · merchant server up · 621 ms
- ok · hub up on the Whitechain rail · 1.2 s
- ok · merchant publishes whitechain-dev · 684 ms
- ok · buyer holds no gas before paying · 552 ms
- ok · sale · envelope approves · 445 ms
- ok · sale · buyer pays in USDT, released · 18.1 s
- ok · sale · chain agrees, relayer paid every fee · 1.4 s
- ok · buyer holds no gas after paying · 589 ms
- ok · the merchant sees the order · 21 ms
- ok · merchant refunds in one click · 8.0 s
- ok · buyer holds no gas after the refund · 715 ms

**slip-onchain-whitechain**

- ok · the slip agrees with itself · 0 ms
- ok · Released carries the slip hash · 704 ms
- ok · the escrow stores the slip hash · 185 ms
- ok · the genuine slip verifies · 1.5 s
- ok · a tampered slip fails on chain · 1.4 s

**hedera**

- ok · hub up with the Hedera rail · 1.4 s
- ok · seller lists an offer paid on Hedera · 200 ms
- ok · 402 names the Hedera rail · 2 ms
- ok · agent pays with no human step · 5.4 s
- ok · mirror node confirms the transfer · 3.8 s
- ok · spend log entry on HCS · 317 ms
- ok · envelope refuses past its cap, and logs it · 6.6 s

**merchant**

- ok · relay up with the suite's gas wallet · 1.1 s
- ok · merchant server up · 300 ms
- ok · hub up on the Whitechain rail · 812 ms
- ok · merchant publishes whitechain-dev · 454 ms
- ok · sale · envelope approves · 527 ms
- ok · sale · buyer pays in USDT, released · 17.3 s
- ok · sale · chain agrees, relayer paid every fee · 893 ms
- ok · totals match the chain · 26 ms
- ok · partial refund of 0.005 USDT · 8.3 s
- ok · totals move by the refund and nothing else · 2 ms
- ok · the accountant's export · 2 ms
- ok · no token, no refund · 2 ms

**discovery**

- ok · local hub up · 551 ms
- ok · seller publishes use-arc · 246 ms
- ok · local · healthz · 1 ms
- ok · local · offer list · 2 ms
- ok · local · A2A agent card · 6 ms
- ok · local · skills index · 1 ms
- ok · local · OpenAPI · 1 ms
- ok · local · Bazaar list · 1 ms
- ok · local · unpaid call answers 402 · 3 ms
- ok · public · healthz · 453 ms
- ok · public · offer list · 288 ms
- ok · public · A2A agent card · 1.2 s
- ok · public · skills index · 453 ms
- ok · public · OpenAPI · 308 ms
- ok · public · Bazaar list · 297 ms
- ok · public · unpaid call answers 402 · 332 ms

Artifacts for this run (bodies, logs, slips) stay on the build machine under `e2e/artifacts/20261106-110132-1319/`.
