<!-- the latest full run; its own file is 20261106-110921-7619.md -->
# e2e run 20261106-110921-7619

| | |
|---|---|
| commit | `93641c3` on `cs/e2e` |
| started | 2026-11-06 11:09:21 UTC (16:39 IST) |
| duration | 167.1 s |
| scope | full run, every flow |
| result | 12 pass · 1 fail · 0 skipped · 1 not run |

| # | Flow | Status | Time | Failed step |
|---|---|---|---|---|
| 1 | `arc-spine` | PASS | 14.7 s |  |
| 1b | `runner-restart` | FAIL | 2.4 s | `runner restarts: same offer, back online` |
| 2 | `arc-wrong-amount` | PASS | 2.5 s |  |
| 3 | `arc-deadline-refund` | PASS | 48.5 s |  |
| 4a | `slip-onchain-arc` | PASS | 2.2 s |  |
| 10 | `arc-gateway` | PASS | 2.6 s |  |
| 11 | `refusals` | PASS | 2.8 s |  |
| 5 | `whitechain` | PASS | 30.3 s |  |
| 4b | `slip-onchain-whitechain` | PASS | 3.7 s |  |
| 6 | `hedera` | PASS | 13.8 s |  |
| 7 | `merchant` | PASS | 29.2 s |  |
| 8 | `discovery` | PASS | 3.9 s |  |
| 12 | `public-spine` | PASS | 9.8 s |  |
| 9 | `web` | NOT RUN (browser rule) |  |  |

## Transactions

**arc-spine**

- fund: [`0xf25dead5…924e1d`](https://explorer.testnet.arc.io/tx/0xf25dead5e2b9fb9f0cbaf103df8ab91a2f4c4b6385f0d7dbe0baca4a98924e1d)
- release: [`0x28950b98…a29c53`](https://explorer.testnet.arc.io/tx/0x28950b98c3de7294393be354ca0bb433087ff7d0a89f42ce9efcdfc6b2a29c53)

**arc-wrong-amount**

- fund at twice the signed price (reverted, as expected): [`0x1d44de92…7716dc`](https://explorer.testnet.arc.io/tx/0x1d44de92d4d1291412871e763afd242a4e95bd68f0506f61a2071f68907716dc)

**arc-deadline-refund**

- fund: [`0x656481c3…453380`](https://explorer.testnet.arc.io/tx/0x656481c3604e48a98e483976b780a21c3ce1f33feb8f679421c85480b4453380)
- refund by a stranger: [`0x991c6c1f…e6a186`](https://explorer.testnet.arc.io/tx/0x991c6c1f67fd6cfa0b5fd14706d363edfe40cc249e180a39172cd48b74e6a186)

**slip-onchain-arc**

- release: [`0x28950b98…a29c53`](https://explorer.testnet.arc.io/tx/0x28950b98c3de7294393be354ca0bb433087ff7d0a89f42ce9efcdfc6b2a29c53)

**whitechain**

- sale fund: [`0xd52726ad…b87a98`](https://explorer.testnet.whitechain.io/tx/0xd52726ad59be66d5cd91447f778df59441de13d450228e6f2d105405eab87a98)
- sale release: [`0xbe2f7096…016788`](https://explorer.testnet.whitechain.io/tx/0xbe2f709694c9578569e1ed8dc4a3f8badcc30a9ae914b5ae405c4b496a016788)
- one-click refund: [`0x11bf7dcb…d38b07`](https://explorer.testnet.whitechain.io/tx/0x11bf7dcb28530391090adc43e2e4357806ad2a36456ded6f3878de00b6d38b07)

**slip-onchain-whitechain**

- release: [`0xbe2f7096…016788`](https://explorer.testnet.whitechain.io/tx/0xbe2f709694c9578569e1ed8dc4a3f8badcc30a9ae914b5ae405c4b496a016788)

**hedera**

- agent payment: [`0.0.918580…095157`](https://hashscan.io/testnet/transaction/0.0.9185802@1793963469.091095157)

**merchant**

- sale fund: [`0x34f58ce9…b17af2`](https://explorer.testnet.whitechain.io/tx/0x34f58ce947bcb743e2287a68c3b5ba145ca84d3271564d05ad4d96dc3fb17af2)
- sale release: [`0xd454b51e…dec585`](https://explorer.testnet.whitechain.io/tx/0xd454b51ec494d11ef4816b91a21ac54df4ab6ecb21017a4cc9520a971edec585)
- partial refund: [`0x60810cec…6fc7f8`](https://explorer.testnet.whitechain.io/tx/0x60810cec54dae357ab0b17e52208489fce36c30eaec47fb76394d828f36fc7f8)

**public-spine**

- fund (public hub): [`0xea6f2589…1e9272`](https://explorer.testnet.arc.io/tx/0xea6f25894aac4b34917e8029ef3c77643069fe24fd6e3e9daeb49b3d7d1e9272)
- release (public hub): [`0x8cfe3f4b…3cdf14`](https://explorer.testnet.arc.io/tx/0x8cfe3f4b8b61f7b651af351bc7bdead8072062e2d5eb3e5bcbed104f9f3cdf14)

## Failures

**runner-restart** · step `runner restarts: same offer, back online` · owner orch-cs

> offer online: expected true, got false

## Notes

- `arc-gateway`: Gateway transfer e5fb050d-64a2-440f-8ba4-8d24015a875b; the seller is credited in Gateway's next batch
- `hedera`: facilitator: x402.org
- `hedera`: spend log: topic 0.0.11337070 sequence 14
- `public-spine`: bought use-arc 0xdd24c0f8 from seller 0x6BE98051B852824A3923E3B27f9781Ceb0C0ca4a

## Steps

**arc-spine**

- ok · hub up · 401 ms
- ok · seller publishes use-arc · 185 ms
- ok · buyer discovers · 142 ms
- ok · envelope approves · 145 ms
- ok · seller balance before · 179 ms
- ok · countersign, fund, deliver, release · 11.2 s
- ok · hub job record · 1 ms
- ok · chain agrees · 1.1 s
- ok · slip names its rail · 282 ms
- ok · hub stopped · 14 ms
- ok · verifier VALID with the hub stopped · 1.0 s

**runner-restart**

- ok · hub up · 533 ms
- ok · runner serves use-arc · 198 ms
- ok · runner stops, offer goes offline · 6 ms
- FAIL · runner restarts: same offer, back online · 141 ms · offer online: expected true, got false

**arc-wrong-amount**

- ok · hub up · 332 ms
- ok · seller publishes use-arc · 158 ms
- ok · 402 challenge · 3 ms
- ok · buyer countersigns the listed price · 4 ms
- ok · hub refuses a moved price · 188 ms
- ok · chain refuses a moved price · 1.6 s
- ok · the signature holds at the signed price · 182 ms

**arc-deadline-refund**

- ok · hub up · 364 ms
- ok · seller publishes use-arc with a 45 s deadline · 158 ms
- ok · envelope approves · 147 ms
- ok · buyer pays, seller cannot deliver · 5.8 s
- ok · escrow holds the money · 369 ms
- ok · hub stopped · 21 ms
- ok · a refund before the deadline is refused · 370 ms
- ok · chain passes the deadline · 39.8 s
- ok · a stranger refunds · 1.3 s
- ok · the refund is final · 183 ms

**slip-onchain-arc**

- ok · the slip agrees with itself · 0 ms
- ok · Released carries the slip hash · 362 ms
- ok · the escrow stores the slip hash · 175 ms
- ok · the genuine slip verifies · 966 ms
- ok · a tampered slip fails on chain · 717 ms

**arc-gateway**

- ok · hub up with the escrow and Gateway rails · 797 ms
- ok · seller publishes use-arc on both rails · 202 ms
- ok · 402 offers Circle Gateway · 3 ms
- ok · envelope approves · 147 ms
- ok · buyer's Gateway balance before · 267 ms
- ok · buyer pays through Gateway · 787 ms
- ok · Gateway debits the buyer at once · 272 ms
- ok · slip names the gateway rail and verifies · 108 ms

**refusals**

- ok · hub up · 377 ms
- ok · seller publishes use-arc · 160 ms
- ok · the hub's input gate refuses a bad input · 1 ms
- ok · the buyer refuses a bad input before signing · 394 ms
- ok · over the budget · 329 ms
- ok · over the per-seller limit · 335 ms
- ok · seller not on the allowlist · 315 ms
- ok · envelope revoked · 318 ms
- ok · held above ask-above until the human approves · 311 ms
- ok · seller offline: refused, nothing charged · 295 ms

**whitechain**

- ok · relay up with the suite's gas wallet · 1.2 s
- ok · merchant server up · 149 ms
- ok · hub up on the Whitechain rail · 333 ms
- ok · merchant publishes whitechain-dev · 176 ms
- ok · buyer holds no gas before paying · 923 ms
- ok · sale · envelope approves · 160 ms
- ok · sale · buyer pays in USDT, released · 16.4 s
- ok · sale · chain agrees, relayer paid every fee · 1.5 s
- ok · buyer holds no gas after paying · 699 ms
- ok · the merchant sees the order · 15 ms
- ok · merchant refunds in one click · 8.2 s
- ok · buyer holds no gas after the refund · 553 ms

**slip-onchain-whitechain**

- ok · the slip agrees with itself · 0 ms
- ok · Released carries the slip hash · 554 ms
- ok · the escrow stores the slip hash · 188 ms
- ok · the genuine slip verifies · 1.6 s
- ok · a tampered slip fails on chain · 1.3 s

**hedera**

- ok · hub up with the Hedera rail · 2.0 s
- ok · seller lists an offer paid on Hedera · 490 ms
- ok · 402 names the Hedera rail · 9 ms
- ok · agent pays with no human step · 6.1 s
- ok · mirror node confirms the transfer · 319 ms
- ok · spend log entry on HCS · 328 ms
- ok · envelope refuses past its cap, and logs it · 4.5 s

**merchant**

- ok · relay up with the suite's gas wallet · 1.3 s
- ok · merchant server up · 282 ms
- ok · hub up on the Whitechain rail · 758 ms
- ok · merchant publishes whitechain-dev · 354 ms
- ok · sale · envelope approves · 259 ms
- ok · sale · buyer pays in USDT, released · 16.7 s
- ok · sale · chain agrees, relayer paid every fee · 925 ms
- ok · totals match the chain · 21 ms
- ok · partial refund of 0.005 USDT · 8.6 s
- ok · totals move by the refund and nothing else · 1 ms
- ok · the accountant's export · 2 ms
- ok · no token, no refund · 2 ms

**discovery**

- ok · local hub up · 348 ms
- ok · seller publishes use-arc · 180 ms
- ok · local · healthz · 1 ms
- ok · local · offer list · 1 ms
- ok · local · A2A agent card · 3 ms
- ok · local · skills index · 1 ms
- ok · local · OpenAPI · 1 ms
- ok · local · Bazaar list · 1 ms
- ok · local · unpaid call answers 402 · 2 ms
- ok · public · healthz · 442 ms
- ok · public · offer list · 450 ms
- ok · public · A2A agent card · 1.2 s
- ok · public · skills index · 312 ms
- ok · public · OpenAPI · 290 ms
- ok · public · Bazaar list · 297 ms
- ok · public · unpaid call answers 402 · 294 ms

**public-spine**

- ok · the public hub lists a live Arc offer · 288 ms
- ok · envelope approves · 164 ms
- ok · buyer pays through the public hub · 6.8 s
- ok · chain agrees · 838 ms
- ok · slip verifies with no hub · 1.8 s

Artifacts for this run (bodies, logs, slips) stay on the build machine under `e2e/artifacts/20261106-110921-7619/`.
