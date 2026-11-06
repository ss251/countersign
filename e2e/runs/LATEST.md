<!-- the latest full run; its own file is 20261106-135354-8798.md -->
# e2e run 20261106-135354-8798

| | |
|---|---|
| commit | `867f64a` on `cs/e2e` |
| started | 2026-11-06 13:53:54 UTC (19:23 IST) |
| duration | 296.4 s |
| scope | full run, every flow |
| result | 21 pass · 1 fail · 0 skipped · 2 not run |

| # | Flow | Status | Time | Failed step |
|---|---|---|---|---|
| 1 | `arc-spine` | PASS | 7.2 s |  |
| 1b | `runner-restart` | PASS | 2.4 s |  |
| 2 | `arc-wrong-amount` | PASS | 2.6 s |  |
| 3 | `arc-deadline-refund` | PASS | 48.0 s |  |
| 4a | `slip-onchain-arc` | PASS | 2.7 s |  |
| 10 | `arc-gateway` | PASS | 3.1 s |  |
| 11 | `refusals` | PASS | 2.7 s |  |
| 13 | `ratings` | PASS | 64.9 s |  |
| 5 | `whitechain` | PASS | 32.3 s |  |
| 4b | `slip-onchain-whitechain` | PASS | 3.7 s |  |
| 6 | `hedera` | PASS | 23.9 s |  |
| 7 | `merchant` | PASS | 29.3 s |  |
| 8 | `discovery` | PASS | 4.2 s |  |
| 12 | `public-spine` | PASS | 7.5 s |  |
| 15 | `public-hedera` | PASS | 18.1 s |  |
| 16 | `public-gateway` | PASS | 3.9 s |  |
| 17 | `hedera-mcp` | PASS | 14.5 s |  |
| 18 | `erc8004-identity` | PASS | 4.3 s |  |
| 18b | `erc8004-arc` | PASS | 2.4 s |  |
| 19 | `mpp` | PASS | 10.0 s |  |
| 20 | `hedera-schedule` | NOT RUN (on demand: about 0.18 HBAR a run; run it with --flow hedera-schedule) |  |  |
| 14a | `production-console` | PASS | 1.3 s |  |
| 14b | `production-hub` | FAIL | 5.9 s | `every endpoint a screen calls answers 200, open to the console` |
| 9 | `web` | NOT RUN (cut: screenshot rounds cover it) |  |  |

## Transactions

**arc-spine**

- fund: [`0xb3b291f3…9c0b38`](https://explorer.testnet.arc.io/tx/0xb3b291f3bd93c6bdf1c277ab183d286c0502c916f9160f76724c1b8eaa9c0b38)
- release: [`0x7a3048de…6462cf`](https://explorer.testnet.arc.io/tx/0x7a3048de886ce7a91bea2688aefc00346f218944016ec99eaa6c28813d6462cf)

**arc-wrong-amount**

- fund at twice the signed price (reverted, as expected): [`0x438244be…efa244`](https://explorer.testnet.arc.io/tx/0x438244bedeaaf9fb1e45eabff89f9a9f22b25f5e43ed3856a5654b6cbcefa244)

**arc-deadline-refund**

- fund: [`0x8f2d2dc8…c7407c`](https://explorer.testnet.arc.io/tx/0x8f2d2dc825916e60e44320b451e3cbc959c65611d7e45f157f334c6db1c7407c)
- refund by a stranger: [`0xfe64feed…75bbcb`](https://explorer.testnet.arc.io/tx/0xfe64feede40b57d05b5c5df97efe5e84908a473ad1c88a404f8ef23d5275bbcb)

**slip-onchain-arc**

- release: [`0x7a3048de…6462cf`](https://explorer.testnet.arc.io/tx/0x7a3048de886ce7a91bea2688aefc00346f218944016ec99eaa6c28813d6462cf)

**ratings**

- refund by the hub's janitor: [`0x6ae48a7d…cdb3fc`](https://explorer.testnet.arc.io/tx/0x6ae48a7d37959c05662c763b9b917add919e0279e1089eb700e423ec69cdb3fc)

**whitechain**

- sale fund: [`0x4440c421…e27505`](https://explorer.testnet.whitechain.io/tx/0x4440c421a4010bc1fb9b040d0437c5adfa0ec0d1a8e63a89fa8d9e72cde27505)
- sale release: [`0x92fde044…520bff`](https://explorer.testnet.whitechain.io/tx/0x92fde0441efbc5ad07e1610154ec41ab0f55c1c8902c220f3a30ead1fe520bff)
- one-click refund: [`0x52a02028…071c8d`](https://explorer.testnet.whitechain.io/tx/0x52a0202807b9edf36c13157b27a3ea56c40d0a9d58047dae293ffd7bb9071c8d)

**slip-onchain-whitechain**

- release: [`0x92fde044…520bff`](https://explorer.testnet.whitechain.io/tx/0x92fde0441efbc5ad07e1610154ec41ab0f55c1c8902c220f3a30ead1fe520bff)

**hedera**

- agent payment: [`0.0.918580…241197`](https://hashscan.io/testnet/transaction/0.0.9185802@1793973401.292241197)

**merchant**

- sale fund: [`0xc23a9308…43c1d5`](https://explorer.testnet.whitechain.io/tx/0xc23a9308dc213f0ae031d09db2de49a41368c5d5c4479f4f7b1cb9758643c1d5)
- sale release: [`0xc5e1890e…ec4ff4`](https://explorer.testnet.whitechain.io/tx/0xc5e1890e5896e4db7da6ec728914e72991b2ae380fb43da4aa646c5909ec4ff4)
- partial refund: [`0xa2415b6c…d8b797`](https://explorer.testnet.whitechain.io/tx/0xa2415b6cc82a1428058969232fa5155b205252dab48345cfe692b9594ed8b797)

**public-spine**

- fund (public hub): [`0xccebcfd3…ef2673`](https://explorer.testnet.arc.io/tx/0xccebcfd3be85b9b7259fa3da44246e862be2d587caac684ed97b14ad1bef2673)
- release (public hub): [`0x3b9286d1…1a3ce2`](https://explorer.testnet.arc.io/tx/0x3b9286d1003bc20074a6473abb44c258fe3c25a7389ac37ab663c9f4a31a3ce2)

**public-hedera**

- agent payment through the public hub: [`0.0.918580…494595`](https://hashscan.io/testnet/transaction/0.0.9185802@1793973468.224494595)

**hedera-mcp**

- agent payment for the MCP call: [`0.0.918580…646494`](https://hashscan.io/testnet/transaction/0.0.9185802@1793973488.846646494)

**erc8004-arc**

- earned feedback for agent 897802: [`0x3af33b85…0d1072`](https://explorer.testnet.arc.io/tx/0x3af33b85a60ab3bea32666b5ea627c56151018e70b7c4d00d8e9bc94600d1072)

**mpp**

- mpp payment: [`0x4ee39c7f…7eefc5`](https://explore.testnet.tempo.xyz/tx/0x4ee39c7f68f73cb73121ba0aac4cdbcd1cfc9d1d48b0945fdc2a9eff237eefc5)
- mpp payment (signed credential): [`0xda842c16…c66419`](https://explore.testnet.tempo.xyz/tx/0xda842c164ad94cdc673517e5084296fa8ba0d3eecc7b0f1432307414cdc66419)

## Failures

**production-hub** · step `every endpoint a screen calls answers 200, open to the console` · owner orch-cs

> 3 of 14 fail: 503 /envelopes/0.0.11337064 (buyer, assistant); 503 /approvals (buyer); 503 /approvals (buyer)

## Notes

- `arc-gateway`: Gateway transfer 07b599af-9691-43d0-b412-2ff3948e0e17; the seller is credited in Gateway's next batch
- `hedera`: facilitator: x402.org
- `hedera`: spend log: topic 0.0.11337070 sequence 50
- `hedera`: reconciled 1 agent payment(s) against 19 spend or schedule entries
- `public-spine`: bought use-arc 0xdd24c0f8 from seller 0x6BE98051B852824A3923E3B27f9781Ceb0C0ca4a
- `public-hedera`: paid use-usdc 0x41536222 to 0.0.11337065
- `public-gateway`: paid use-usdc 0x41536222 from seller 0xA55a31E3468E03E2Eb094535A8ae8e912e8CB093
- `public-gateway`: Gateway transfer e846a69f-7854-478c-808d-7e9bc85eea93
- `hedera-mcp`: paid MCP offer 0xa59402d5 (Hedera Agent Kit: an HBAR transfer, built for you to sign) to 0.0.11337065
- `erc8004-identity`: agent 158 in 0x8004A818BFB912233c491871b3d84c89A494BD9e on chain 296 is owned by 0xE4eBF122a912BeF5FeC9C56e003FD4Af2CBDB5fE
- `erc8004-arc`: agents: 897802 (0x6BE98051), 897803 (0xA55a31E3)
- `erc8004-arc`: feedback on Arc for these agents: 1, earned 1
- `production-console`: default bundle: index-BArOluRa.js
- `production-console`: fixture markers checked: 89
- `production-hub`: checked 14 endpoints for agent 0.0.11337064 and seller 0xce1e838Cb01B908049C2Eb90b3Da4d71cC887915

## Steps

**arc-spine**

- ok · hub up · 406 ms
- ok · seller publishes use-arc · 273 ms
- ok · buyer discovers · 158 ms
- ok · envelope approves · 147 ms
- ok · seller balance before · 188 ms
- ok · countersign, fund, deliver, release · 3.0 s
- ok · hub job record · 1 ms
- ok · chain agrees · 1.2 s
- ok · slip names its rail · 749 ms
- ok · hub stopped · 23 ms
- ok · verifier VALID with the hub stopped · 956 ms

**runner-restart**

- ok · hub up · 405 ms
- ok · runner serves use-arc · 250 ms
- ok · runner stops, offer goes offline · 5 ms
- ok · runner restarts: same offer, back online · 217 ms

**arc-wrong-amount**

- ok · hub up · 361 ms
- ok · seller publishes use-arc · 228 ms
- ok · 402 challenge · 4 ms
- ok · buyer countersigns the listed price · 4 ms
- ok · hub refuses a moved price · 204 ms
- ok · chain refuses a moved price · 1.7 s
- ok · the signature holds at the signed price · 180 ms

**arc-deadline-refund**

- ok · hub up · 378 ms
- ok · seller publishes use-arc with a 45 s deadline · 237 ms
- ok · envelope approves · 205 ms
- ok · buyer pays, seller cannot deliver · 2.1 s
- ok · escrow holds the money · 372 ms
- ok · hub stopped · 7 ms
- ok · a refund before the deadline is refused · 360 ms
- ok · chain passes the deadline · 42.9 s
- ok · a stranger refunds · 1.3 s
- ok · the refund is final · 186 ms

**slip-onchain-arc**

- ok · the slip agrees with itself · 0 ms
- ok · Released carries the slip hash · 389 ms
- ok · the escrow stores the slip hash · 190 ms
- ok · the genuine slip verifies · 965 ms
- ok · a tampered slip fails on chain · 1.2 s

**arc-gateway**

- ok · hub up with the escrow and Gateway rails · 1.1 s
- ok · seller publishes use-arc on both rails · 270 ms
- ok · 402 offers Circle Gateway · 5 ms
- ok · envelope approves · 162 ms
- ok · buyer's Gateway balance before · 289 ms
- ok · buyer pays through Gateway · 901 ms
- ok · Gateway debits the buyer at once · 255 ms
- ok · slip names the gateway rail and verifies · 94 ms

**refusals**

- ok · hub up · 345 ms
- ok · seller publishes use-arc · 189 ms
- ok · the hub's input gate refuses a bad input · 1 ms
- ok · an input the slip cannot hash is refused before any 402 · 5 ms
- ok · the buyer refuses a bad input before signing · 312 ms
- ok · over the budget · 321 ms
- ok · over the per-seller limit · 318 ms
- ok · seller not on the allowlist · 313 ms
- ok · envelope revoked · 309 ms
- ok · held above ask-above until the human approves · 315 ms
- ok · seller offline: refused, nothing charged · 305 ms

**ratings**

- ok · hub up · 342 ms
- ok · seller publishes use-arc with a 45 s deadline · 197 ms
- ok · a buyer's call is delivered · 3.8 s
- ok · the seller buys from itself · 3.4 s
- ok · a buyer's call fails delivery · 1.6 s
- ok · the seller's rating counts what the slips prove · 4 ms
- ok · hub stats agree · 1 ms
- ok · the hub's janitor refunds the failed call after its deadline · 55.4 s
- ok · the rating follows the refund · 2 ms

**whitechain**

- ok · relay up with the suite's gas wallet · 1.2 s
- ok · merchant server up · 169 ms
- ok · hub up on the Whitechain rail · 605 ms
- ok · merchant publishes whitechain-dev · 496 ms
- ok · buyer holds no gas before paying · 1.0 s
- ok · sale · envelope approves · 177 ms
- ok · sale · buyer pays in USDT, released · 17.6 s
- ok · sale · chain agrees, relayer paid every fee · 1.5 s
- ok · buyer holds no gas after paying · 618 ms
- ok · the merchant sees the order · 21 ms
- ok · merchant refunds in one click · 8.3 s
- ok · buyer holds no gas after the refund · 618 ms

**slip-onchain-whitechain**

- ok · the slip agrees with itself · 0 ms
- ok · Released carries the slip hash · 630 ms
- ok · the escrow stores the slip hash · 198 ms
- ok · the genuine slip verifies · 1.6 s
- ok · a tampered slip fails on chain · 1.3 s

**hedera**

- ok · hub up with the Hedera rail · 1.6 s
- ok · seller lists an offer paid on Hedera · 284 ms
- ok · 402 names the Hedera rail · 3 ms
- ok · agent pays with no human step · 8.8 s
- ok · mirror node confirms the transfer · 641 ms
- ok · spend log entry on HCS · 4.1 s
- ok · envelope refuses past its cap, and logs it · 7.4 s
- ok · the spend log is complete for this run · 947 ms

**merchant**

- ok · relay up with the suite's gas wallet · 1.1 s
- ok · merchant server up · 151 ms
- ok · hub up on the Whitechain rail · 386 ms
- ok · merchant publishes whitechain-dev · 247 ms
- ok · sale · envelope approves · 167 ms
- ok · sale · buyer pays in USDT, released · 17.8 s
- ok · sale · chain agrees, relayer paid every fee · 964 ms
- ok · totals match the chain · 23 ms
- ok · partial refund of 0.005 USDT · 8.3 s
- ok · totals move by the refund and nothing else · 3 ms
- ok · the accountant's export · 4 ms
- ok · no token, no refund · 5 ms

**discovery**

- ok · local hub up · 423 ms
- ok · seller publishes use-arc · 222 ms
- ok · local · healthz · 1 ms
- ok · local · offer list · 1 ms
- ok · local · A2A agent card · 4 ms
- ok · local · skills index · 1 ms
- ok · local · OpenAPI · 1 ms
- ok · local · Bazaar list · 1 ms
- ok · local · unpaid call answers 402 · 3 ms
- ok · public · healthz · 430 ms
- ok · public · offer list · 323 ms
- ok · public · A2A agent card · 1.5 s
- ok · public · skills index · 354 ms
- ok · public · OpenAPI · 314 ms
- ok · public · Bazaar list · 314 ms
- ok · public · unpaid call answers 402 · 308 ms

**public-spine**

- ok · the public hub lists a live Arc offer · 293 ms
- ok · envelope approves · 165 ms
- ok · buyer pays through the public hub · 4.4 s
- ok · chain agrees · 1.0 s
- ok · slip verifies with no hub · 1.7 s

**public-hedera**

- ok · the public hub lists a live Hedera offer · 304 ms
- ok · 402 names the Hedera rail on production · 305 ms
- ok · agent pays through the public hub, no human step · 8.1 s
- ok · mirror node confirms the transfer · 3.8 s
- ok · spend log entry on HCS · 4.9 s
- ok · the public hub records the settlement and its slip verifies · 746 ms

**public-gateway**

- ok · the public hub lists a live Gateway offer · 315 ms
- ok · envelope approves · 143 ms
- ok · buyer's Gateway balance before · 261 ms
- ok · buyer pays through Gateway on the public hub · 2.6 s
- ok · Gateway debits the buyer at once · 257 ms
- ok · the public hub serves the same slip, and it verifies · 399 ms

**hedera-mcp**

- ok · the public hub lists the Agent Kit MCP offer · 313 ms
- ok · 402 names the Hedera rail · 315 ms
- ok · agent pays, the runner calls the tool · 8.5 s
- ok · mirror node confirms the payment · 642 ms
- ok · spend log entry on HCS · 3.8 s
- ok · the slip binds the MCP call · 824 ms
- ok · the tool's record matches the slip · 1 ms
- ok · the tool returned an unsigned transfer for the buyer · 10 ms

**erc8004-identity**

- ok · the seller owns its agent id · 2.2 s
- ok · the registration file is an ERC-8004 v1 file naming a hub and offers · 1.0 s
- ok · the A2A endpoint is this hub's card, and it lists the offer · 356 ms
- ok · every registered offer is the owner's and live on the hub · 308 ms
- ok · the declared wallet is the owner, on the chain the identity lives on · 449 ms

**erc8004-arc**

- ok · the public hub names sellers with ERC-8004 identities · 332 ms
- ok · agent 897802 is owned by its seller and registers this hub and its offers · 671 ms
- ok · agent 897803 is owned by its seller and registers this hub and its offers · 389 ms
- ok · every feedback the reputation registry holds for them is checked, and earned feedback exists · 678 ms

**mpp**

- ok · demo server up on the mpp rail · 393 ms
- ok · the 402 names Tempo testnet, the price and the recipient, before anything pays · 15 ms
- ok · the named payer pays with the pinned mppx · 4.6 s
- ok · Moderato shows exactly the price moved from the payer to the recipient · 292 ms
- ok · a credential replayed is refused · 4.7 s

**production-console**

- ok · the console serves its default bundle · 1.1 s
- ok · the default bundle is live, not fixtures · 173 ms

**production-hub**

- ok · the hub has a listed offer and a settlement to read · 621 ms
- ok · production declares every rail it claims · 304 ms
- FAIL · every endpoint a screen calls answers 200, open to the console · 4.9 s · 3 of 14 fail: 503 /envelopes/0.0.11337064 (buyer, assistant); 503 /approvals (buyer); 503 /approvals (buyer)

Artifacts for this run (bodies, logs, slips) stay on the build machine under `e2e/artifacts/20261106-135354-8798/`.
