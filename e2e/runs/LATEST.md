<!-- the latest full run; its own file is 20261106-161557-6bc1.md -->
# e2e run 20261106-161557-6bc1

| | |
|---|---|
| commit | `0e8ac81` on `cs/e2e` |
| started | 2026-11-06 16:15:57 UTC (21:45 IST) |
| duration | 301.8 s |
| scope | full run, every flow |
| result | 22 pass · 1 fail · 0 skipped · 4 not run |

| # | Flow | Status | Time | Failed step |
|---|---|---|---|---|
| 1 | `arc-spine` | PASS | 12.1 s |  |
| 1b | `runner-restart` | PASS | 2.5 s |  |
| 2 | `arc-wrong-amount` | PASS | 2.7 s |  |
| 3 | `arc-deadline-refund` | PASS | 49.6 s |  |
| 4a | `slip-onchain-arc` | PASS | 2.5 s |  |
| 10 | `arc-gateway` | PASS | 3.2 s |  |
| 11 | `refusals` | PASS | 3.2 s |  |
| 13 | `ratings` | PASS | 62.2 s |  |
| 5 | `whitechain` | PASS | 39.5 s |  |
| 4b | `slip-onchain-whitechain` | PASS | 3.6 s |  |
| 6 | `hedera` | PASS | 23.6 s |  |
| 7 | `merchant` | PASS | 25.8 s |  |
| 8 | `discovery` | PASS | 4.1 s |  |
| 12 | `public-spine` | PASS | 7.2 s |  |
| 15 | `public-hedera` | PASS | 9.1 s |  |
| 16 | `public-gateway` | PASS | 5.3 s |  |
| 17 | `hedera-mcp` | PASS | 8.3 s |  |
| 18 | `erc8004-identity` | PASS | 11.7 s |  |
| 18b | `erc8004-arc` | FAIL | 2.1 s | `every feedback the reputation registry holds for them is checked, and earned feedback exists` |
| 19 | `mpp` | PASS | 10.2 s |  |
| 20 | `hedera-schedule` | NOT RUN (on demand: about 0.18 HBAR a run; run it with --flow hedera-schedule) |  |  |
| 21 | `hedera-held` | NOT RUN (on demand: about 0.16 HBAR a run; run it with --flow hedera-held) |  |  |
| 21b | `hedera-held-undelivered` | NOT RUN (on demand: about 0.16 HBAR and 7 minutes a run; run it with --flow hedera-held-undelivered) |  |  |
| 14a | `production-console` | PASS | 4.5 s |  |
| 14b | `production-hub` | PASS | 4.6 s |  |
| 14c | `production-approvals` | PASS | 2.7 s |  |
| 9 | `web` | NOT RUN (cut: screenshot rounds cover it) |  |  |

## Transactions

**arc-spine**

- fund: [`0xb4152c08…8cc877`](https://explorer.testnet.arc.io/tx/0xb4152c083267f94fc3c226090233fed74a32bc3987345a741288534cc88cc877)
- release: [`0x22105ac1…b49684`](https://explorer.testnet.arc.io/tx/0x22105ac10de0b83cdbcac929636a5e6327dbded49537205766632ecb2bb49684)

**arc-wrong-amount**

- fund at twice the signed price (reverted, as expected): [`0x5d9f5275…ac41db`](https://explorer.testnet.arc.io/tx/0x5d9f5275abf87a2d31fdcbcf403d525403f9738f16b241ab93c1603fe4ac41db)

**arc-deadline-refund**

- fund: [`0xe9e60474…174823`](https://explorer.testnet.arc.io/tx/0xe9e604744e849ae3b797d67a952a13c09422de147a1e45aeca22e05b0f174823)
- refund by a stranger: [`0xf048f99c…1be890`](https://explorer.testnet.arc.io/tx/0xf048f99ca7d645f141185a406bfee61a2efe151aede75029a3877ac0241be890)

**slip-onchain-arc**

- release: [`0x22105ac1…b49684`](https://explorer.testnet.arc.io/tx/0x22105ac10de0b83cdbcac929636a5e6327dbded49537205766632ecb2bb49684)

**ratings**

- refund by the hub's janitor: [`0xec2608c1…7a7ba7`](https://explorer.testnet.arc.io/tx/0xec2608c161da4ee919f1cc8f93cb98e5c0ee03fad71edc1b83899f527b7a7ba7)

**whitechain**

- sale fund: [`0x78f3f750…d9920f`](https://explorer.testnet.whitechain.io/tx/0x78f3f750e692a33f37385079d996bebf18855caefcb2d3b2a4a10bd7bed9920f)
- sale release: [`0x8339d5fc…fbcd0e`](https://explorer.testnet.whitechain.io/tx/0x8339d5fc422d179362729a7a50b7a6928de5ca28bebcc81bb489c38564fbcd0e)
- one-click refund: [`0x6598ab1f…7ecb9c`](https://explorer.testnet.whitechain.io/tx/0x6598ab1fdc7172f2c1a42a266b85588be0ce858d46035152b2d150cca57ecb9c)

**slip-onchain-whitechain**

- release: [`0x8339d5fc…fbcd0e`](https://explorer.testnet.whitechain.io/tx/0x8339d5fc422d179362729a7a50b7a6928de5ca28bebcc81bb489c38564fbcd0e)

**hedera**

- agent payment: [`0.0.918580…956071`](https://hashscan.io/testnet/transaction/0.0.9185802@1793981938.353956071)

**merchant**

- sale fund: [`0x19eb65e6…bf8d89`](https://explorer.testnet.whitechain.io/tx/0x19eb65e6c68c20a75dbcab41b40ec831fd9a1540c074cba9969869bb9ebf8d89)
- sale release: [`0x3c656c2a…655477`](https://explorer.testnet.whitechain.io/tx/0x3c656c2ac734ec35e893aafb9bb145ca4f6345c9e10896ac7c78a72c54655477)
- partial refund: [`0x0ceb74d7…70d342`](https://explorer.testnet.whitechain.io/tx/0x0ceb74d786c2b3cb4f288a9bc9a2ba29dd1c92af322d0c2637ebddae9770d342)

**public-spine**

- fund (public hub): [`0xe6e27adb…5c2f28`](https://explorer.testnet.arc.io/tx/0xe6e27adb4785f5f39dafb8e7ad89e3bd76ae54260f30f585df08204e245c2f28)
- release (public hub): [`0xdc3b6395…1c8d7f`](https://explorer.testnet.arc.io/tx/0xdc3b63953dd3ca9f355e4d9ca16496e222f57e62dbb41ecdd10cffab221c8d7f)

**public-hedera**

- agent payment through the public hub: [`0.0.918580…890107`](https://hashscan.io/testnet/transaction/0.0.9185802@1793981996.819890107)

**hedera-mcp**

- agent payment for the MCP call: [`0.0.918580…685390`](https://hashscan.io/testnet/transaction/0.0.9185802@1793982009.875685390)

**mpp**

- mpp payment: [`0x53a8c829…89d8f3`](https://explore.testnet.tempo.xyz/tx/0x53a8c829b20d546f065d73fcc9b64e9c47e237b2b24e7f07fdeed8c67a89d8f3)
- mpp payment (signed credential): [`0x9931dd91…26d654`](https://explore.testnet.tempo.xyz/tx/0x9931dd91010691ea3cb4ebe87b21e61cc1898ab49bcb698e93accd840626d654)

## Failures

**erc8004-arc** · step `every feedback the reputation registry holds for them is checked, and earned feedback exists` · owner orch-cs

> no earned feedback for agents 897803 since block 71029600

## Notes

- `arc-gateway`: Gateway transfer a6dd5805-7ba6-457b-a311-15f89f868340; the seller is credited in Gateway's next batch
- `hedera`: facilitator: x402.org
- `hedera`: spend log: topic 0.0.11337070 sequence 95
- `hedera`: reconciled 1 agent payment(s) against 27 spend or schedule entries
- `public-spine`: bought use-arc 0xdd24c0f8 from seller 0x6BE98051B852824A3923E3B27f9781Ceb0C0ca4a
- `public-hedera`: paid use-usdc 0x41536222 to 0.0.11337065
- `public-gateway`: paid use-usdc 0x41536222 from seller 0xA55a31E3468E03E2Eb094535A8ae8e912e8CB093
- `public-gateway`: Gateway transfer 2a664f8f-5a80-46cb-a660-70cf79c6b017
- `hedera-mcp`: paid MCP offer 0xc0ceb0a0 (Hedera Agent Kit: an HBAR transfer, built for you to sign) to 0.0.11337065
- `erc8004-identity`: agent 158 in 0x8004A818BFB912233c491871b3d84c89A494BD9e on chain 296 is owned by 0xE4eBF122a912BeF5FeC9C56e003FD4Af2CBDB5fE
- `erc8004-arc`: agents: 897803 (0xA55a31E3)
- `erc8004-arc`: feedback on Arc for these agents: 0, earned 0
- `production-console`: default bundle: index-DrL1CyTX.js, rolldown-runtime-BWaJ3C7D.js, utils-Bpv4vmSW.js, chain-DGHNkaZc.js, hashTypedData-OJxD_jjD.js, hashMessage-NC5SDVnI.js, ccip-Cx9Un7-3.js, _esm-BdNswz-Z.js, src-NnqN028C.js, http-BQJpC50I.js, approver-DioVlLqE.js, model-sTAEdp3S.js
- `production-console`: fixture markers checked: 89
- `production-hub`: checked 11 endpoints for agent 0.0.11337064 and seller 0xE4eBF122a912BeF5FeC9C56e003FD4Af2CBDB5fE
- `production-hub`: the approval routes, /envelopes and /approvals, are checked by production-approvals: they depend on production's approver configuration
- `production-approvals`: the phone follows 0.0.11337064, which has published no envelope mirror here, so the phone shows its absent state

## Steps

**arc-spine**

- ok · hub up · 405 ms
- ok · seller publishes use-arc · 336 ms
- ok · buyer discovers · 173 ms
- ok · envelope approves · 165 ms
- ok · seller balance before · 189 ms
- ok · countersign, fund, deliver, release · 7.7 s
- ok · hub job record · 1 ms
- ok · chain agrees · 1.1 s
- ok · slip names its rail · 749 ms
- ok · hub stopped · 10 ms
- ok · verifier VALID with the hub stopped · 1.2 s

**runner-restart**

- ok · hub up · 392 ms
- ok · runner serves use-arc · 292 ms
- ok · runner stops, offer goes offline · 4 ms
- ok · runner restarts: same offer, back online · 268 ms

**arc-wrong-amount**

- ok · hub up · 427 ms
- ok · seller publishes use-arc · 263 ms
- ok · 402 challenge · 3 ms
- ok · buyer countersigns the listed price · 4 ms
- ok · hub refuses a moved price · 184 ms
- ok · chain refuses a moved price · 1.7 s
- ok · the signature holds at the signed price · 181 ms

**arc-deadline-refund**

- ok · hub up · 436 ms
- ok · seller publishes use-arc with a 45 s deadline · 280 ms
- ok · envelope approves · 184 ms
- ok · buyer pays, seller cannot deliver · 2.4 s
- ok · escrow holds the money · 370 ms
- ok · hub stopped · 15 ms
- ok · a refund before the deadline is refused · 377 ms
- ok · chain passes the deadline · 44.1 s
- ok · a stranger refunds · 1.3 s
- ok · the refund is final · 189 ms

**slip-onchain-arc**

- ok · the slip agrees with itself · 0 ms
- ok · Released carries the slip hash · 384 ms
- ok · the escrow stores the slip hash · 181 ms
- ok · the genuine slip verifies · 1.1 s
- ok · a tampered slip fails on chain · 811 ms

**arc-gateway**

- ok · hub up with the escrow and Gateway rails · 829 ms
- ok · seller publishes use-arc on both rails · 305 ms
- ok · 402 offers Circle Gateway · 4 ms
- ok · envelope approves · 184 ms
- ok · buyer's Gateway balance before · 278 ms
- ok · buyer pays through Gateway · 1.1 s
- ok · Gateway debits the buyer at once · 280 ms
- ok · slip names the gateway rail and verifies · 194 ms

**refusals**

- ok · hub up · 383 ms
- ok · seller publishes use-arc · 282 ms
- ok · the hub's input gate refuses a bad input · 1 ms
- ok · an input the slip cannot hash is refused before any 402 · 5 ms
- ok · the buyer refuses a bad input before signing · 371 ms
- ok · over the budget · 363 ms
- ok · over the per-seller limit · 363 ms
- ok · seller not on the allowlist · 366 ms
- ok · envelope revoked · 354 ms
- ok · held above ask-above until the human approves · 377 ms
- ok · seller offline: refused, nothing charged · 368 ms

**ratings**

- ok · hub up · 376 ms
- ok · seller publishes use-arc with a 45 s deadline · 265 ms
- ok · a buyer's call is delivered · 3.8 s
- ok · the seller buys from itself · 3.5 s
- ok · a buyer's call fails delivery · 2.7 s
- ok · the seller's rating counts what the slips prove · 3 ms
- ok · hub stats agree · 0 ms
- ok · the hub's janitor refunds the failed call after its deadline · 51.6 s
- ok · the rating follows the refund · 2 ms

**whitechain**

- ok · relay up with the suite's gas wallet · 1.2 s
- ok · merchant server up · 186 ms
- ok · hub up on the Whitechain rail · 419 ms
- ok · merchant publishes whitechain-dev · 314 ms
- ok · buyer holds no gas before paying · 1.0 s
- ok · sale · envelope approves · 174 ms
- ok · sale · buyer pays in USDT, released · 24.8 s
- ok · sale · chain agrees, relayer paid every fee · 1.5 s
- ok · buyer holds no gas after paying · 612 ms
- ok · the merchant sees the order · 8 ms
- ok · merchant refunds in one click · 8.6 s
- ok · buyer holds no gas after the refund · 583 ms

**slip-onchain-whitechain**

- ok · the slip agrees with itself · 0 ms
- ok · Released carries the slip hash · 591 ms
- ok · the escrow stores the slip hash · 202 ms
- ok · the genuine slip verifies · 1.5 s
- ok · a tampered slip fails on chain · 1.3 s

**hedera**

- ok · hub up with the Hedera rail · 1.6 s
- ok · seller lists an offer paid on Hedera · 328 ms
- ok · 402 names the Hedera rail · 3 ms
- ok · agent pays with no human step · 8.5 s
- ok · mirror node confirms the transfer · 434 ms
- ok · spend log entry on HCS · 4.3 s
- ok · envelope refuses past its cap, and logs it · 7.2 s
- ok · the spend log is complete for this run · 1.2 s

**merchant**

- ok · relay up with the suite's gas wallet · 1.2 s
- ok · merchant server up · 209 ms
- ok · hub up on the Whitechain rail · 369 ms
- ok · merchant publishes whitechain-dev · 308 ms
- ok · sale · envelope approves · 181 ms
- ok · sale · buyer pays in USDT, released · 17.6 s
- ok · sale · chain agrees, relayer paid every fee · 996 ms
- ok · totals match the chain · 16 ms
- ok · partial refund of 0.005 USDT · 4.9 s
- ok · totals move by the refund and nothing else · 1 ms
- ok · the accountant's export · 2 ms
- ok · no token, no refund · 2 ms

**discovery**

- ok · local hub up · 490 ms
- ok · seller publishes use-arc · 308 ms
- ok · local · healthz · 1 ms
- ok · local · offer list · 1 ms
- ok · local · A2A agent card · 5 ms
- ok · local · skills index · 1 ms
- ok · local · OpenAPI · 1 ms
- ok · local · Bazaar list · 1 ms
- ok · local · unpaid call answers 402 · 3 ms
- ok · public · healthz · 443 ms
- ok · public · offer list · 350 ms
- ok · public · A2A agent card · 1.2 s
- ok · public · skills index · 301 ms
- ok · public · OpenAPI · 310 ms
- ok · public · Bazaar list · 300 ms
- ok · public · unpaid call answers 402 · 371 ms

**public-spine**

- ok · the public hub lists a live Arc offer · 305 ms
- ok · envelope approves · 204 ms
- ok · buyer pays through the public hub · 3.9 s
- ok · chain agrees · 982 ms
- ok · slip verifies with no hub · 1.9 s

**public-hedera**

- ok · the public hub lists a live Hedera offer · 308 ms
- ok · 402 names the Hedera rail on production · 321 ms
- ok · agent pays through the public hub, no human step · 7.1 s
- ok · mirror node confirms the transfer · 311 ms
- ok · spend log entry on HCS · 313 ms
- ok · the public hub records the settlement and its slip verifies · 779 ms

**public-gateway**

- ok · the public hub lists a live Gateway offer · 513 ms
- ok · envelope approves · 190 ms
- ok · buyer's Gateway balance before · 1.2 s
- ok · buyer pays through Gateway on the public hub · 2.6 s
- ok · Gateway debits the buyer at once · 267 ms
- ok · the public hub serves the same slip, and it verifies · 501 ms

**hedera-mcp**

- ok · the public hub lists the Agent Kit MCP offer · 311 ms
- ok · 402 names the Hedera rail · 311 ms
- ok · agent pays, the runner calls the tool · 6.3 s
- ok · mirror node confirms the payment · 317 ms
- ok · spend log entry on HCS · 308 ms
- ok · the slip binds the MCP call · 790 ms
- ok · the tool's record matches the slip · 1 ms
- ok · the tool returned an unsigned transfer for the buyer · 9 ms

**erc8004-identity**

- ok · the seller owns its agent id · 10.2 s
- ok · the registration file is an ERC-8004 v1 file naming a hub and offers · 401 ms
- ok · the A2A endpoint is this hub's card, and it lists the offer · 313 ms
- ok · every registered offer is the owner's and live on the hub · 307 ms
- ok · the declared wallet is the owner, on the chain the identity lives on · 478 ms

**erc8004-arc**

- ok · the public hub names sellers with ERC-8004 identities · 299 ms
- ok · agent 897803 is owned by its seller and registers this hub and its offers · 362 ms
- FAIL · every feedback the reputation registry holds for them is checked, and earned feedback exists · 1.1 s · no earned feedback for agents 897803 since block 71029600

**mpp**

- ok · demo server up on the mpp rail · 329 ms
- ok · the 402 names Tempo testnet, the price and the recipient, before anything pays · 4 ms
- ok · the named payer pays with the pinned mppx · 5.1 s
- ok · Moderato shows exactly the price moved from the payer to the recipient · 348 ms
- ok · a credential replayed is refused · 4.4 s

**production-console**

- ok · the console serves its default bundle · 4.3 s
- ok · the default bundle is live, not fixtures · 196 ms

**production-hub**

- ok · the hub has a listed offer and a settlement to read · 916 ms
- ok · production declares every rail it claims · 316 ms
- ok · every endpoint a screen calls answers 200, open to the console · 3.4 s

**production-approvals**

- ok · the agent the phone follows · 303 ms
- ok · the approval routes answer a client with no token · 913 ms
- ok · without the approver's token the routes refuse · 0 ms
- ok · with the approver's token the routes answer · 933 ms
- ok · every approval route answers, open to the console · 296 ms
- ok · the approval decision passes CORS preflight · 305 ms

Artifacts for this run (bodies, logs, slips) stay on the build machine under `e2e/artifacts/20261106-161557-6bc1/`.
