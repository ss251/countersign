<!-- the latest full run; its own file is 20261106-153202-cdae.md -->
# e2e run 20261106-153202-cdae

| | |
|---|---|
| commit | `88eef01` on `cs/e2e` |
| started | 2026-11-06 15:32:02 UTC (21:02 IST) |
| duration | 959.1 s |
| scope | full run, every flow |
| result | 20 pass · 5 fail · 0 skipped · 2 not run |

| # | Flow | Status | Time | Failed step |
|---|---|---|---|---|
| 1 | `arc-spine` | PASS | 13.8 s |  |
| 1b | `runner-restart` | PASS | 5.3 s |  |
| 2 | `arc-wrong-amount` | PASS | 6.6 s |  |
| 3 | `arc-deadline-refund` | PASS | 53.8 s |  |
| 4a | `slip-onchain-arc` | PASS | 3.9 s |  |
| 10 | `arc-gateway` | PASS | 6.0 s |  |
| 11 | `refusals` | PASS | 6.4 s |  |
| 13 | `ratings` | PASS | 63.0 s |  |
| 5 | `whitechain` | PASS | 33.9 s |  |
| 4b | `slip-onchain-whitechain` | PASS | 3.8 s |  |
| 6 | `hedera` | PASS | 17.6 s |  |
| 7 | `merchant` | PASS | 30.6 s |  |
| 8 | `discovery` | PASS | 4.1 s |  |
| 12 | `public-spine` | PASS | 15.1 s |  |
| 15 | `public-hedera` | PASS | 13.6 s |  |
| 16 | `public-gateway` | PASS | 4.0 s |  |
| 17 | `hedera-mcp` | PASS | 13.1 s |  |
| 18 | `erc8004-identity` | FAIL | 18.6 s | `every registered offer is the owner's and live on the hub` |
| 18b | `erc8004-arc` | FAIL | 5.2 s | `every feedback the reputation registry holds for them is checked, and earned feedback exists` |
| 19 | `mpp` | FAIL | 1.5 s | `the 402 names Tempo testnet, the price and the recipient, before anything pays` |
| 20 | `hedera-schedule` | NOT RUN (on demand: about 0.18 HBAR a run; run it with --flow hedera-schedule) |  |  |
| 21 | `hedera-held` | PASS | 14.2 s |  |
| 21b | `hedera-held-undelivered` | FAIL | 366.2 s | `the call fails, the hold expires unexecuted, and the agent releases it` |
| 14a | `production-console` | PASS | 4.6 s |  |
| 14b | `production-hub` | FAIL | 4.3 s | `every endpoint a screen calls answers 200, open to the console` |
| 14c | `production-approvals` | PASS | 2.8 s |  |
| 9 | `web` | NOT RUN (cut: screenshot rounds cover it) |  |  |

## Transactions

**arc-spine**

- fund: [`0xe4b3f52b…2f3ab4`](https://explorer.testnet.arc.io/tx/0xe4b3f52bd021e51928be78b216ac85a743238fd3fe59129a15ce1128a22f3ab4)
- release: [`0x57a292e0…b3fde9`](https://explorer.testnet.arc.io/tx/0x57a292e07a0a326decf477275db295adc64a9c710f72d2305bd08bee9db3fde9)

**arc-wrong-amount**

- fund at twice the signed price (reverted, as expected): [`0x7dcdca89…ee8226`](https://explorer.testnet.arc.io/tx/0x7dcdca89a19811f9249569fce98e8a9c2163c39fb57c7a88b8558b70b9ee8226)

**arc-deadline-refund**

- fund: [`0x5ed9ab61…b9780e`](https://explorer.testnet.arc.io/tx/0x5ed9ab61fd0c56f1a955755afa024d115330c8d73033c95be67e2da377b9780e)
- refund by a stranger: [`0x05f72f6a…2c714b`](https://explorer.testnet.arc.io/tx/0x05f72f6a5cc6a151b42f8537b80b420e51ff30078228017f41c9546c302c714b)

**slip-onchain-arc**

- release: [`0x57a292e0…b3fde9`](https://explorer.testnet.arc.io/tx/0x57a292e07a0a326decf477275db295adc64a9c710f72d2305bd08bee9db3fde9)

**ratings**

- refund by the hub's janitor: [`0x178b1fea…c7bd82`](https://explorer.testnet.arc.io/tx/0x178b1fea62226adabc0ad165ac8777f8aecf19477212cea3321178756fc7bd82)

**whitechain**

- sale fund: [`0xc3986437…bec5ea`](https://explorer.testnet.whitechain.io/tx/0xc39864372186570e2a6ed2c53f6c88ad5164c6579d4b21059bb71d7ce6bec5ea)
- sale release: [`0x53cd9490…6a0677`](https://explorer.testnet.whitechain.io/tx/0x53cd9490c00b54a4f6a32cd3940d1fa9a5222b471656524ea72d0a9e306a0677)
- one-click refund: [`0x0abb4bf6…785d25`](https://explorer.testnet.whitechain.io/tx/0x0abb4bf64dab44eb04834a2da6f1d0e4a65b507b27a3e7e8f370d792b6785d25)

**slip-onchain-whitechain**

- release: [`0x53cd9490…6a0677`](https://explorer.testnet.whitechain.io/tx/0x53cd9490c00b54a4f6a32cd3940d1fa9a5222b471656524ea72d0a9e306a0677)

**hedera**

- agent payment: [`0.0.918580…608239`](https://hashscan.io/testnet/transaction/0.0.9185802@1793979564.658608239)

**merchant**

- sale fund: [`0xc0263c96…22dd70`](https://explorer.testnet.whitechain.io/tx/0xc0263c968f963b9a0cd05e142c1ad9fce0717c2415c90375cd249c15d322dd70)
- sale release: [`0xd5f62404…ec3c7e`](https://explorer.testnet.whitechain.io/tx/0xd5f62404108d200267ba69d4593e3d644e494928a83c314747839a9b83ec3c7e)
- partial refund: [`0x228e7cbe…ff448a`](https://explorer.testnet.whitechain.io/tx/0x228e7cbeb15dff6f0d25dd80de3f22b93ee64d10afe805ea37a9ac2afeff448a)

**public-spine**

- fund (public hub): [`0x6ece6322…19ac87`](https://explorer.testnet.arc.io/tx/0x6ece6322db6b008290a3e7a870c16098a8830babe7c14af81db1056a8219ac87)
- release (public hub): [`0xc9df79f3…250268`](https://explorer.testnet.arc.io/tx/0xc9df79f3a9f34817201f8e537780112342ee82b6e445a333834335edb9250268)

**public-hedera**

- agent payment through the public hub: [`0.0.918580…944148`](https://hashscan.io/testnet/transaction/0.0.9185802@1793979630.140944148)

**hedera-mcp**

- agent payment for the MCP call: [`0.0.918580…934714`](https://hashscan.io/testnet/transaction/0.0.9185802@1793979645.733934714)

**hedera-held**

- the agent's held payment (schedule create): [`0.0.113370…046614`](https://hashscan.io/testnet/transaction/0.0.11337064@1793979688.938046614)

## Failures

**erc8004-identity** · step `every registered offer is the owner's and live on the hub` · owner cs-hd

> offer 0xa59402d5 online: expected true, got false

**erc8004-arc** · step `every feedback the reputation registry holds for them is checked, and earned feedback exists` · owner orch-cs

> no earned feedback for agents 897803 since block 71029600

**mpp** · step `the 402 names Tempo testnet, the price and the recipient, before anything pays` · owner cs-hd

> GET http://localhost:59599/rail/paid failed: Unable to connect. Is the computer able to access the url?

**hedera-held-undelivered** · step `the call fails, the hold expires unexecuted, and the agent releases it` · owner cs-hd

> the agent reports expired log (it reported agent, offer, hub answer, schedule, schedule create, hold log, executed, release, balance)

**production-hub** · step `every endpoint a screen calls answers 200, open to the console` · owner orch-cs

> 1 of 10 fail: no settlement carries a slip hash to read (slip, verify)

## Notes

- `arc-gateway`: Gateway transfer 7226430c-5712-419a-9025-ebaf17a39235; the seller is credited in Gateway's next batch
- `hedera`: facilitator: x402.org
- `hedera`: spend log: topic 0.0.11337070 sequence 88
- `hedera`: reconciled 1 agent payment(s) against 34 spend or schedule entries
- `public-spine`: bought use-arc 0xdd24c0f8 from seller 0x6BE98051B852824A3923E3B27f9781Ceb0C0ca4a
- `public-hedera`: paid use-usdc 0x41536222 to 0.0.11337065
- `public-gateway`: paid use-usdc 0x41536222 from seller 0xA55a31E3468E03E2Eb094535A8ae8e912e8CB093
- `public-gateway`: Gateway transfer ee882481-53e8-4428-921d-5b37d01bc739
- `hedera-mcp`: paid MCP offer 0xc0ceb0a0 (Hedera Agent Kit: an HBAR transfer, built for you to sign) to 0.0.11337065
- `erc8004-identity`: agent 158 in 0x8004A818BFB912233c491871b3d84c89A494BD9e on chain 296 is owned by 0xE4eBF122a912BeF5FeC9C56e003FD4Af2CBDB5fE
- `erc8004-arc`: agents: 897803 (0xA55a31E3)
- `erc8004-arc`: feedback on Arc for these agents: 0, earned 0
- `hedera-held`: held offer 0xc0ceb0a0 (Hedera Agent Kit: an HBAR transfer, built for you to sign): held pays 0.0.11338176, exact pays 0.0.11337065
- `hedera-held`: schedule 0.0.11341470
- `hedera-held-undelivered`: held offer 0xc0ceb0a0 (Hedera Agent Kit: an HBAR transfer, built for you to sign): held pays 0.0.11338176, exact pays 0.0.11337065
- `production-console`: default bundle: index-isJ-BVX3.js, rolldown-runtime-BWaJ3C7D.js, utils-Bpv4vmSW.js, chain-DGHNkaZc.js, hashTypedData-OJxD_jjD.js, hashMessage-NC5SDVnI.js, ccip-Cx9Un7-3.js, _esm-BdNswz-Z.js, src-NnqN028C.js, approver-DioVlLqE.js, model-sTAEdp3S.js
- `production-console`: fixture markers checked: 89
- `production-hub`: checked 10 endpoints for agent 0.0.11337064 and seller 0xE4eBF122a912BeF5FeC9C56e003FD4Af2CBDB5fE
- `production-hub`: the approval routes, /envelopes and /approvals, are checked by production-approvals: they depend on production's approver configuration
- `production-approvals`: the phone follows 0.0.11337064, which has published no envelope mirror here, so the phone shows its absent state

## Steps

**arc-spine**

- ok · hub up · 3.0 s
- ok · seller publishes use-arc · 998 ms
- ok · buyer discovers · 570 ms
- ok · envelope approves · 578 ms
- ok · seller balance before · 196 ms
- ok · countersign, fund, deliver, release · 5.0 s
- ok · hub job record · 1 ms
- ok · chain agrees · 1.1 s
- ok · slip names its rail · 918 ms
- ok · hub stopped · 8 ms
- ok · verifier VALID with the hub stopped · 1.4 s

**runner-restart**

- ok · hub up · 1.6 s
- ok · runner serves use-arc · 1.2 s
- ok · runner stops, offer goes offline · 5 ms
- ok · runner restarts: same offer, back online · 1.0 s

**arc-wrong-amount**

- ok · hub up · 1.8 s
- ok · seller publishes use-arc · 1.1 s
- ok · 402 challenge · 5 ms
- ok · buyer countersigns the listed price · 7 ms
- ok · hub refuses a moved price · 189 ms
- ok · chain refuses a moved price · 3.2 s
- ok · the signature holds at the signed price · 200 ms

**arc-deadline-refund**

- ok · hub up · 3.5 s
- ok · seller publishes use-arc with a 45 s deadline · 1.2 s
- ok · envelope approves · 679 ms
- ok · buyer pays, seller cannot deliver · 4.2 s
- ok · escrow holds the money · 388 ms
- ok · hub stopped · 32 ms
- ok · a refund before the deadline is refused · 372 ms
- ok · chain passes the deadline · 41.9 s
- ok · a stranger refunds · 1.3 s
- ok · the refund is final · 186 ms

**slip-onchain-arc**

- ok · the slip agrees with itself · 0 ms
- ok · Released carries the slip hash · 371 ms
- ok · the escrow stores the slip hash · 189 ms
- ok · the genuine slip verifies · 2.0 s
- ok · a tampered slip fails on chain · 1.3 s

**arc-gateway**

- ok · hub up with the escrow and Gateway rails · 1.6 s
- ok · seller publishes use-arc on both rails · 897 ms
- ok · 402 offers Circle Gateway · 5 ms
- ok · envelope approves · 454 ms
- ok · buyer's Gateway balance before · 309 ms
- ok · buyer pays through Gateway · 1.7 s
- ok · Gateway debits the buyer at once · 299 ms
- ok · slip names the gateway rail and verifies · 673 ms

**refusals**

- ok · hub up · 1.3 s
- ok · seller publishes use-arc · 532 ms
- ok · the hub's input gate refuses a bad input · 4 ms
- ok · an input the slip cannot hash is refused before any 402 · 13 ms
- ok · the buyer refuses a bad input before signing · 750 ms
- ok · over the budget · 552 ms
- ok · over the per-seller limit · 621 ms
- ok · seller not on the allowlist · 557 ms
- ok · envelope revoked · 678 ms
- ok · held above ask-above until the human approves · 687 ms
- ok · seller offline: refused, nothing charged · 704 ms

**ratings**

- ok · hub up · 539 ms
- ok · seller publishes use-arc with a 45 s deadline · 486 ms
- ok · a buyer's call is delivered · 4.7 s
- ok · the seller buys from itself · 3.4 s
- ok · a buyer's call fails delivery · 2.3 s
- ok · the seller's rating counts what the slips prove · 4 ms
- ok · hub stats agree · 1 ms
- ok · the hub's janitor refunds the failed call after its deadline · 51.6 s
- ok · the rating follows the refund · 8 ms

**whitechain**

- ok · relay up with the suite's gas wallet · 1.2 s
- ok · merchant server up · 198 ms
- ok · hub up on the Whitechain rail · 456 ms
- ok · merchant publishes whitechain-dev · 312 ms
- ok · buyer holds no gas before paying · 1.0 s
- ok · sale · envelope approves · 180 ms
- ok · sale · buyer pays in USDT, released · 18.5 s
- ok · sale · chain agrees, relayer paid every fee · 2.0 s
- ok · buyer holds no gas after paying · 639 ms
- ok · the merchant sees the order · 16 ms
- ok · merchant refunds in one click · 8.7 s
- ok · buyer holds no gas after the refund · 650 ms

**slip-onchain-whitechain**

- ok · the slip agrees with itself · 0 ms
- ok · Released carries the slip hash · 640 ms
- ok · the escrow stores the slip hash · 196 ms
- ok · the genuine slip verifies · 1.6 s
- ok · a tampered slip fails on chain · 1.4 s

**hedera**

- ok · hub up with the Hedera rail · 1.4 s
- ok · seller lists an offer paid on Hedera · 363 ms
- ok · 402 names the Hedera rail · 4 ms
- ok · agent pays with no human step · 6.7 s
- ok · mirror node confirms the transfer · 313 ms
- ok · spend log entry on HCS · 310 ms
- ok · envelope refuses past its cap, and logs it · 7.8 s
- ok · the spend log is complete for this run · 677 ms

**merchant**

- ok · relay up with the suite's gas wallet · 1.6 s
- ok · merchant server up · 554 ms
- ok · hub up on the Whitechain rail · 979 ms
- ok · merchant publishes whitechain-dev · 1.2 s
- ok · sale · envelope approves · 591 ms
- ok · sale · buyer pays in USDT, released · 18.9 s
- ok · sale · chain agrees, relayer paid every fee · 1.2 s
- ok · totals match the chain · 12 ms
- ok · partial refund of 0.005 USDT · 5.6 s
- ok · totals move by the refund and nothing else · 2 ms
- ok · the accountant's export · 2 ms
- ok · no token, no refund · 2 ms

**discovery**

- ok · local hub up · 472 ms
- ok · seller publishes use-arc · 310 ms
- ok · local · healthz · 1 ms
- ok · local · offer list · 1 ms
- ok · local · A2A agent card · 5 ms
- ok · local · skills index · 1 ms
- ok · local · OpenAPI · 1 ms
- ok · local · Bazaar list · 1 ms
- ok · local · unpaid call answers 402 · 3 ms
- ok · public · healthz · 438 ms
- ok · public · offer list · 321 ms
- ok · public · A2A agent card · 1.3 s
- ok · public · skills index · 306 ms
- ok · public · OpenAPI · 308 ms
- ok · public · Bazaar list · 296 ms
- ok · public · unpaid call answers 402 · 333 ms

**public-spine**

- ok · the public hub lists a live Arc offer · 294 ms
- ok · envelope approves · 194 ms
- ok · buyer pays through the public hub · 11.0 s
- ok · chain agrees · 870 ms
- ok · slip verifies with no hub · 2.8 s

**public-hedera**

- ok · the public hub lists a live Hedera offer · 298 ms
- ok · 402 names the Hedera rail on production · 315 ms
- ok · agent pays through the public hub, no human step · 8.1 s
- ok · mirror node confirms the transfer · 310 ms
- ok · spend log entry on HCS · 3.6 s
- ok · the public hub records the settlement and its slip verifies · 934 ms

**public-gateway**

- ok · the public hub lists a live Gateway offer · 307 ms
- ok · envelope approves · 188 ms
- ok · buyer's Gateway balance before · 440 ms
- ok · buyer pays through Gateway on the public hub · 2.3 s
- ok · Gateway debits the buyer at once · 262 ms
- ok · the public hub serves the same slip, and it verifies · 480 ms

**hedera-mcp**

- ok · the public hub lists the Agent Kit MCP offer · 304 ms
- ok · 402 names the Hedera rail · 299 ms
- ok · agent pays, the runner calls the tool · 7.5 s
- ok · mirror node confirms the payment · 309 ms
- ok · spend log entry on HCS · 3.6 s
- ok · the slip binds the MCP call · 1.0 s
- ok · the tool's record matches the slip · 1 ms
- ok · the tool returned an unsigned transfer for the buyer · 10 ms

**erc8004-identity**

- ok · the seller owns its agent id · 14.8 s
- ok · the registration file is an ERC-8004 v1 file naming a hub and offers · 3.1 s
- ok · the A2A endpoint is this hub's card, and it lists the offer · 296 ms
- FAIL · every registered offer is the owner's and live on the hub · 313 ms · offer 0xa59402d5 online: expected true, got false

**erc8004-arc**

- ok · the public hub names sellers with ERC-8004 identities · 3.4 s
- ok · agent 897803 is owned by its seller and registers this hub and its offers · 363 ms
- FAIL · every feedback the reputation registry holds for them is checked, and earned feedback exists · 1.1 s · no earned feedback for agents 897803 since block 71029600

**mpp**

- ok · demo server up on the mpp rail · 1.4 s
- FAIL · the 402 names Tempo testnet, the price and the recipient, before anything pays · 31 ms · GET http://localhost:59599/rail/paid failed: Unable to connect. Is the computer able to access the url?

**hedera-held**

- ok · production declares the held rail · 462 ms
- ok · the public hub lists the Agent Kit offer with the held rail first · 294 ms
- ok · the 402 offers the held payment beside the exact one · 295 ms
- ok · the agent pays held by default, and the delivered call executes the schedule · 11.6 s
- ok · the mirror shows the schedule executed, the agent's and not waiting for expiry · 311 ms
- ok · the scheduled transfer moved exactly the price from the agent to the seller's signing account · 29 ms
- ok · the HCS log holds the agent's schedule entry · 309 ms
- ok · the slip names the held rail and the schedule's create, and it verifies · 922 ms

**hedera-held-undelivered**

- ok · production declares the held rail · 292 ms
- ok · the public hub lists the Agent Kit offer with the held rail first · 312 ms
- ok · the 402 offers the held payment beside the exact one · 301 ms
- FAIL · the call fails, the hold expires unexecuted, and the agent releases it · 365.3 s · the agent reports expired log (it reported agent, offer, hub answer, schedule, schedule create, hold log, executed, release, balance)

**production-console**

- ok · the console serves its default bundle · 4.1 s
- ok · the default bundle is live, not fixtures · 528 ms

**production-hub**

- ok · the hub has a listed offer and a settlement to read · 888 ms
- ok · production declares every rail it claims · 312 ms
- FAIL · every endpoint a screen calls answers 200, open to the console · 3.1 s · 1 of 10 fail: no settlement carries a slip hash to read (slip, verify)

**production-approvals**

- ok · the agent the phone follows · 305 ms
- ok · the approval routes answer a client with no token · 899 ms
- ok · without the approver's token the routes refuse · 0 ms
- ok · with the approver's token the routes answer · 914 ms
- ok · every approval route answers, open to the console · 325 ms
- ok · the approval decision passes CORS preflight · 318 ms

Artifacts for this run (bodies, logs, slips) stay on the build machine under `e2e/artifacts/20261106-153202-cdae/`.
