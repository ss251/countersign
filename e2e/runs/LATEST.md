<!-- the latest full run; its own file is 20261106-150523-7560.md -->
# e2e run 20261106-150523-7560

| | |
|---|---|
| commit | `b88f91d` on `cs/e2e` |
| started | 2026-11-06 15:05:23 UTC (20:35 IST) |
| duration | 318.6 s |
| scope | full run, every flow |
| result | 22 pass · 1 fail · 0 skipped · 4 not run |

| # | Flow | Status | Time | Failed step |
|---|---|---|---|---|
| 1 | `arc-spine` | PASS | 11.7 s |  |
| 1b | `runner-restart` | PASS | 2.6 s |  |
| 2 | `arc-wrong-amount` | PASS | 2.7 s |  |
| 3 | `arc-deadline-refund` | PASS | 49.5 s |  |
| 4a | `slip-onchain-arc` | PASS | 2.5 s |  |
| 10 | `arc-gateway` | PASS | 5.1 s |  |
| 11 | `refusals` | PASS | 7.2 s |  |
| 13 | `ratings` | PASS | 62.9 s |  |
| 5 | `whitechain` | PASS | 26.1 s |  |
| 4b | `slip-onchain-whitechain` | PASS | 5.3 s |  |
| 6 | `hedera` | PASS | 33.7 s |  |
| 7 | `merchant` | PASS | 26.1 s |  |
| 8 | `discovery` | PASS | 4.6 s |  |
| 12 | `public-spine` | PASS | 7.4 s |  |
| 15 | `public-hedera` | PASS | 16.1 s |  |
| 16 | `public-gateway` | FAIL | 535 ms | `buyer's Gateway balance before` |
| 17 | `hedera-mcp` | PASS | 15.8 s |  |
| 18 | `erc8004-identity` | PASS | 5.6 s |  |
| 18b | `erc8004-arc` | PASS | 2.2 s |  |
| 19 | `mpp` | PASS | 10.1 s |  |
| 20 | `hedera-schedule` | NOT RUN (on demand: about 0.18 HBAR a run; run it with --flow hedera-schedule) |  |  |
| 21 | `hedera-held` | NOT RUN (on demand: about 0.16 HBAR a run; run it with --flow hedera-held) |  |  |
| 21b | `hedera-held-undelivered` | NOT RUN (on demand: about 0.16 HBAR and 7 minutes a run; run it with --flow hedera-held-undelivered) |  |  |
| 14a | `production-console` | PASS | 7.6 s |  |
| 14b | `production-hub` | PASS | 9.3 s |  |
| 14c | `production-approvals` | PASS | 2.6 s |  |
| 9 | `web` | NOT RUN (cut: screenshot rounds cover it) |  |  |

## Transactions

**arc-spine**

- fund: [`0xf65eba7d…4acc37`](https://explorer.testnet.arc.io/tx/0xf65eba7d6d78046cb4b6a6d00ef8cad8d6afe3f4fffb5173c37f98169d4acc37)
- release: [`0x4324f0aa…c7b4de`](https://explorer.testnet.arc.io/tx/0x4324f0aabc8a700a518f4ffc986a4324d0801ef6856647b0ae83eef320c7b4de)

**arc-wrong-amount**

- fund at twice the signed price (reverted, as expected): [`0x205ad632…2bf1f7`](https://explorer.testnet.arc.io/tx/0x205ad63292e332884f68e88ab53f14d48d0eed5b72f723a59d81288d6c2bf1f7)

**arc-deadline-refund**

- fund: [`0x53b827f0…f69a74`](https://explorer.testnet.arc.io/tx/0x53b827f0add9f649d87c4109a50233f5f8cba94930ccd38c2523e63225f69a74)
- refund by a stranger: [`0xffef1986…035e66`](https://explorer.testnet.arc.io/tx/0xffef19866929bd76b94f82b26a3976cf42b1d69870a57e3060fc9c1530035e66)

**slip-onchain-arc**

- release: [`0x4324f0aa…c7b4de`](https://explorer.testnet.arc.io/tx/0x4324f0aabc8a700a518f4ffc986a4324d0801ef6856647b0ae83eef320c7b4de)

**ratings**

- refund by the hub's janitor: [`0xaa2ccd66…6fa6ce`](https://explorer.testnet.arc.io/tx/0xaa2ccd669eb29d61b6c844885a3cc1358c7e65cbb77f629132d87b77096fa6ce)

**whitechain**

- sale fund: [`0xb250a018…1d51ea`](https://explorer.testnet.whitechain.io/tx/0xb250a01835c5d7db2d35fe7e24ad6c93fd1082e694cc158a1f3f92df2f1d51ea)
- sale release: [`0xc4b82cdc…a917a0`](https://explorer.testnet.whitechain.io/tx/0xc4b82cdcc3cba98d197165041e64db2742b7c6b007373275db4d84ea30a917a0)
- one-click refund: [`0x43f30fd5…b10ed3`](https://explorer.testnet.whitechain.io/tx/0x43f30fd544b4b80023839e4d3771d4aea5774afaefba213e5cba932980b10ed3)

**slip-onchain-whitechain**

- release: [`0xc4b82cdc…a917a0`](https://explorer.testnet.whitechain.io/tx/0xc4b82cdcc3cba98d197165041e64db2742b7c6b007373275db4d84ea30a917a0)

**hedera**

- agent payment: [`0.0.918580…691495`](https://hashscan.io/testnet/transaction/0.0.9185802@1793977704.028691495)

**merchant**

- sale fund: [`0x621b7e08…794672`](https://explorer.testnet.whitechain.io/tx/0x621b7e08ccf3a7bd735b9138d0fea2add4cea417088f295eac701e101a794672)
- sale release: [`0x3abafd8a…904908`](https://explorer.testnet.whitechain.io/tx/0x3abafd8abc1c9df1096f401a252389faaf5e71e911eefe61a7f23fb268904908)
- partial refund: [`0x69e3e644…a44b71`](https://explorer.testnet.whitechain.io/tx/0x69e3e644fc06e9fa699a460b84ddac3088bcaefc855d9328a0108ae871a44b71)

**public-spine**

- fund (public hub): [`0xb85576f9…c19135`](https://explorer.testnet.arc.io/tx/0xb85576f91c5b0621cdd66e9b8a3e48b365b8b0a287d93e97339cfbca4dc19135)
- release (public hub): [`0x5d6145ca…3945ad`](https://explorer.testnet.arc.io/tx/0x5d6145ca1ab788a44380063e10adc1bd1f16c8ce20df2a8e5272bd6e893945ad)

**public-hedera**

- agent payment through the public hub: [`0.0.918580…556677`](https://hashscan.io/testnet/transaction/0.0.9185802@1793977768.820556677)

**hedera-mcp**

- agent payment for the MCP call: [`0.0.918580…640633`](https://hashscan.io/testnet/transaction/0.0.9185802@1793977788.127640633)

**erc8004-arc**

- earned feedback for agent 897802: [`0x3af33b85…0d1072`](https://explorer.testnet.arc.io/tx/0x3af33b85a60ab3bea32666b5ea627c56151018e70b7c4d00d8e9bc94600d1072)

**mpp**

- mpp payment: [`0x8b8dc60d…8a880f`](https://explore.testnet.tempo.xyz/tx/0x8b8dc60d2d0f5d3a6395049856ab0499eaa236ba8e72af0ffad0649c688a880f)
- mpp payment (signed credential): [`0x974d8a6e…69dca1`](https://explore.testnet.tempo.xyz/tx/0x974d8a6e33b76102325264d8285e5a09b0f9d6ce12bcf1f98a549effec69dca1)

## Failures

**public-gateway** · step `buyer's Gateway balance before` · owner orch-cs

> The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()

## Notes

- `arc-gateway`: Gateway transfer 1c26327e-ca8a-4c93-a605-a682e1b9740b; the seller is credited in Gateway's next batch
- `hedera`: facilitator: x402.org
- `hedera`: spend log: topic 0.0.11337070 sequence 77
- `hedera`: reconciled 1 agent payment(s) against 29 spend or schedule entries
- `public-spine`: bought use-arc 0xdd24c0f8 from seller 0x6BE98051B852824A3923E3B27f9781Ceb0C0ca4a
- `public-hedera`: paid use-usdc 0x41536222 to 0.0.11337065
- `public-gateway`: paid use-usdc 0x41536222 from seller 0xA55a31E3468E03E2Eb094535A8ae8e912e8CB093
- `hedera-mcp`: paid MCP offer 0xa59402d5 (Hedera Agent Kit: an HBAR transfer, built for you to sign) to 0.0.11337065
- `erc8004-identity`: agent 158 in 0x8004A818BFB912233c491871b3d84c89A494BD9e on chain 296 is owned by 0xE4eBF122a912BeF5FeC9C56e003FD4Af2CBDB5fE
- `erc8004-arc`: agents: 897802 (0x6BE98051), 897803 (0xA55a31E3)
- `erc8004-arc`: feedback on Arc for these agents: 1, earned 1
- `production-console`: default bundle: index-D7nrkdoA.js, rolldown-runtime-BWaJ3C7D.js, utils-Bpv4vmSW.js, chain-DGHNkaZc.js, hashTypedData-OJxD_jjD.js, hashMessage-NC5SDVnI.js, ccip-Cx9Un7-3.js, _esm-BdNswz-Z.js, src-NnqN028C.js, approver-DioVlLqE.js, model-sTAEdp3S.js
- `production-console`: fixture markers checked: 89
- `production-hub`: checked 11 endpoints for agent 0.0.11337064 and seller 0xd5882dBC7D41fBcf8ae0B05E9eAc1cbe93d6C71c
- `production-hub`: the approval routes, /envelopes and /approvals, are checked by production-approvals: they depend on production's approver configuration
- `production-approvals`: the phone follows 0.0.11337064, which has published no envelope mirror here, so the phone shows its absent state

## Steps

**arc-spine**

- ok · hub up · 417 ms
- ok · seller publishes use-arc · 322 ms
- ok · buyer discovers · 197 ms
- ok · envelope approves · 170 ms
- ok · seller balance before · 190 ms
- ok · countersign, fund, deliver, release · 7.5 s
- ok · hub job record · 1 ms
- ok · chain agrees · 1.1 s
- ok · slip names its rail · 786 ms
- ok · hub stopped · 7 ms
- ok · verifier VALID with the hub stopped · 991 ms

**runner-restart**

- ok · hub up · 514 ms
- ok · runner serves use-arc · 339 ms
- ok · runner stops, offer goes offline · 6 ms
- ok · runner restarts: same offer, back online · 261 ms

**arc-wrong-amount**

- ok · hub up · 370 ms
- ok · seller publishes use-arc · 260 ms
- ok · 402 challenge · 3 ms
- ok · buyer countersigns the listed price · 4 ms
- ok · hub refuses a moved price · 186 ms
- ok · chain refuses a moved price · 1.7 s
- ok · the signature holds at the signed price · 181 ms

**arc-deadline-refund**

- ok · hub up · 391 ms
- ok · seller publishes use-arc with a 45 s deadline · 266 ms
- ok · envelope approves · 169 ms
- ok · buyer pays, seller cannot deliver · 2.3 s
- ok · escrow holds the money · 361 ms
- ok · hub stopped · 20 ms
- ok · a refund before the deadline is refused · 370 ms
- ok · chain passes the deadline · 44.1 s
- ok · a stranger refunds · 1.3 s
- ok · the refund is final · 177 ms

**slip-onchain-arc**

- ok · the slip agrees with itself · 0 ms
- ok · Released carries the slip hash · 360 ms
- ok · the escrow stores the slip hash · 182 ms
- ok · the genuine slip verifies · 1.0 s
- ok · a tampered slip fails on chain · 940 ms

**arc-gateway**

- ok · hub up with the escrow and Gateway rails · 1.5 s
- ok · seller publishes use-arc on both rails · 584 ms
- ok · 402 offers Circle Gateway · 12 ms
- ok · envelope approves · 366 ms
- ok · buyer's Gateway balance before · 304 ms
- ok · buyer pays through Gateway · 1.6 s
- ok · Gateway debits the buyer at once · 265 ms
- ok · slip names the gateway rail and verifies · 442 ms

**refusals**

- ok · hub up · 767 ms
- ok · seller publishes use-arc · 607 ms
- ok · the hub's input gate refuses a bad input · 6 ms
- ok · an input the slip cannot hash is refused before any 402 · 15 ms
- ok · the buyer refuses a bad input before signing · 765 ms
- ok · over the budget · 743 ms
- ok · over the per-seller limit · 882 ms
- ok · seller not on the allowlist · 757 ms
- ok · envelope revoked · 861 ms
- ok · held above ask-above until the human approves · 993 ms
- ok · seller offline: refused, nothing charged · 760 ms

**ratings**

- ok · hub up · 755 ms
- ok · seller publishes use-arc with a 45 s deadline · 640 ms
- ok · a buyer's call is delivered · 5.3 s
- ok · the seller buys from itself · 5.3 s
- ok · a buyer's call fails delivery · 3.5 s
- ok · the seller's rating counts what the slips prove · 8 ms
- ok · hub stats agree · 1 ms
- ok · the hub's janitor refunds the failed call after its deadline · 47.4 s
- ok · the rating follows the refund · 2 ms

**whitechain**

- ok · relay up with the suite's gas wallet · 1.2 s
- ok · merchant server up · 189 ms
- ok · hub up on the Whitechain rail · 429 ms
- ok · merchant publishes whitechain-dev · 321 ms
- ok · buyer holds no gas before paying · 981 ms
- ok · sale · envelope approves · 193 ms
- ok · sale · buyer pays in USDT, released · 14.8 s
- ok · sale · chain agrees, relayer paid every fee · 1.6 s
- ok · buyer holds no gas after paying · 665 ms
- ok · the merchant sees the order · 23 ms
- ok · merchant refunds in one click · 4.8 s
- ok · buyer holds no gas after the refund · 775 ms

**slip-onchain-whitechain**

- ok · the slip agrees with itself · 0 ms
- ok · Released carries the slip hash · 1.3 s
- ok · the escrow stores the slip hash · 187 ms
- ok · the genuine slip verifies · 2.4 s
- ok · a tampered slip fails on chain · 1.4 s

**hedera**

- ok · hub up with the Hedera rail · 1.4 s
- ok · seller lists an offer paid on Hedera · 475 ms
- ok · 402 names the Hedera rail · 4 ms
- ok · agent pays with no human step · 18.4 s
- ok · mirror node confirms the transfer · 4.1 s
- ok · spend log entry on HCS · 416 ms
- ok · envelope refuses past its cap, and logs it · 7.5 s
- ok · the spend log is complete for this run · 1.4 s

**merchant**

- ok · relay up with the suite's gas wallet · 1.2 s
- ok · merchant server up · 262 ms
- ok · hub up on the Whitechain rail · 588 ms
- ok · merchant publishes whitechain-dev · 330 ms
- ok · sale · envelope approves · 189 ms
- ok · sale · buyer pays in USDT, released · 17.9 s
- ok · sale · chain agrees, relayer paid every fee · 918 ms
- ok · totals match the chain · 29 ms
- ok · partial refund of 0.005 USDT · 4.6 s
- ok · totals move by the refund and nothing else · 3 ms
- ok · the accountant's export · 6 ms
- ok · no token, no refund · 5 ms

**discovery**

- ok · local hub up · 574 ms
- ok · seller publishes use-arc · 300 ms
- ok · local · healthz · 1 ms
- ok · local · offer list · 1 ms
- ok · local · A2A agent card · 4 ms
- ok · local · skills index · 1 ms
- ok · local · OpenAPI · 1 ms
- ok · local · Bazaar list · 1 ms
- ok · local · unpaid call answers 402 · 3 ms
- ok · public · healthz · 731 ms
- ok · public · offer list · 299 ms
- ok · public · A2A agent card · 1.3 s
- ok · public · skills index · 494 ms
- ok · public · OpenAPI · 306 ms
- ok · public · Bazaar list · 307 ms
- ok · public · unpaid call answers 402 · 289 ms

**public-spine**

- ok · the public hub lists a live Arc offer · 292 ms
- ok · envelope approves · 192 ms
- ok · buyer pays through the public hub · 3.3 s
- ok · chain agrees · 1.6 s
- ok · slip verifies with no hub · 2.0 s

**public-hedera**

- ok · the public hub lists a live Hedera offer · 299 ms
- ok · 402 names the Hedera rail on production · 299 ms
- ok · agent pays through the public hub, no human step · 9.8 s
- ok · mirror node confirms the transfer · 645 ms
- ok · spend log entry on HCS · 4.3 s
- ok · the public hub records the settlement and its slip verifies · 813 ms

**public-gateway**

- ok · the public hub lists a live Gateway offer · 314 ms
- ok · envelope approves · 191 ms
- FAIL · buyer's Gateway balance before · 30 ms · The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()

**hedera-mcp**

- ok · the public hub lists the Agent Kit MCP offer · 311 ms
- ok · 402 names the Hedera rail · 303 ms
- ok · agent pays, the runner calls the tool · 9.8 s
- ok · mirror node confirms the payment · 640 ms
- ok · spend log entry on HCS · 3.9 s
- ok · the slip binds the MCP call · 806 ms
- ok · the tool's record matches the slip · 1 ms
- ok · the tool returned an unsigned transfer for the buyer · 8 ms

**erc8004-identity**

- ok · the seller owns its agent id · 3.5 s
- ok · the registration file is an ERC-8004 v1 file naming a hub and offers · 503 ms
- ok · the A2A endpoint is this hub's card, and it lists the offer · 638 ms
- ok · every registered offer is the owner's and live on the hub · 290 ms
- ok · the declared wallet is the owner, on the chain the identity lives on · 671 ms

**erc8004-arc**

- ok · the public hub names sellers with ERC-8004 identities · 291 ms
- ok · agent 897802 is owned by its seller and registers this hub and its offers · 363 ms
- ok · agent 897803 is owned by its seller and registers this hub and its offers · 384 ms
- ok · every feedback the reputation registry holds for them is checked, and earned feedback exists · 861 ms

**mpp**

- ok · demo server up on the mpp rail · 349 ms
- ok · the 402 names Tempo testnet, the price and the recipient, before anything pays · 14 ms
- ok · the named payer pays with the pinned mppx · 4.8 s
- ok · Moderato shows exactly the price moved from the payer to the recipient · 321 ms
- ok · a credential replayed is refused · 4.6 s

**production-console**

- ok · the console serves its default bundle · 7.3 s
- ok · the default bundle is live, not fixtures · 227 ms

**production-hub**

- ok · the hub has a listed offer and a settlement to read · 582 ms
- ok · production declares every rail it claims · 374 ms
- ok · every endpoint a screen calls answers 200, open to the console · 8.3 s

**production-approvals**

- ok · the agent the phone follows · 297 ms
- ok · the approval routes answer a client with no token · 880 ms
- ok · without the approver's token the routes refuse · 0 ms
- ok · with the approver's token the routes answer · 872 ms
- ok · every approval route answers, open to the console · 294 ms
- ok · the approval decision passes CORS preflight · 296 ms

Artifacts for this run (bodies, logs, slips) stay on the build machine under `e2e/artifacts/20261106-150523-7560/`.
