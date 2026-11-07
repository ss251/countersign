<!-- the latest full run; its own file is 20261107-001148-ba81.md -->
# e2e run 20261107-001148-ba81

| | |
|---|---|
| commit | `f197da5` on `cs/e2e` |
| escrow | v2 · `0x10A3c07cc6A519C0106e315D2C42010eCbEFF3CE` |
| started | 2026-11-07 00:11:48 UTC (05:41 IST) |
| duration | 149.7 s |
| scope | full run, every flow |
| result | 15 pass · 0 fail · 0 skipped · 13 not run |

| # | Flow | Status | Time | Failed step |
|---|---|---|---|---|
| 1 | `arc-spine` | NOT RUN (escrow v2 releases only from its arbiter 0xE37F64A73225f5eA06BABcb1cc5440F01446C267, and this suite's hub signs as 0xEE4d89C544D09968dA97842e6F7be4904fbF3934) |  |  |
| 1b | `runner-restart` | PASS | 2.4 s |  |
| 2 | `arc-wrong-amount` | PASS | 2.6 s |  |
| 3 | `arc-deadline-refund` | NOT RUN (on demand: on escrow v2 it waits the 600 s settle window; run it with --with arc-deadline-refund) |  |  |
| 4a | `slip-onchain-arc` | NOT RUN (needs arc-spine) |  |  |
| 10 | `arc-gateway` | NOT RUN (retired: the Gateway rail was removed from production by flag (project lead, 23:40 IST): it debits before the seller runs and cannot be reversed) |  |  |
| 11 | `refusals` | PASS | 3.1 s |  |
| 13 | `ratings` | NOT RUN (on demand: on escrow v2 it waits the 600 s settle window; run it with --with ratings) |  |  |
| 5 | `whitechain` | PASS | 25.0 s |  |
| 4b | `slip-onchain-whitechain` | PASS | 4.2 s |  |
| 6 | `hedera` | NOT RUN (on demand: covered hourly by flow 17; HBAR budget) |  |  |
| 7 | `merchant` | PASS | 25.9 s |  |
| 8 | `discovery` | PASS | 4.4 s |  |
| 12 | `public-spine` | PASS | 15.1 s |  |
| 15 | `public-hedera` | NOT RUN (on demand: covered hourly by flow 17; HBAR budget) |  |  |
| 16 | `public-gateway` | NOT RUN (retired: the Gateway rail was removed from production by flag (project lead, 23:40 IST): it debits before the seller runs and cannot be reversed) |  |  |
| 17 | `hedera-mcp` | PASS | 13.1 s |  |
| 18 | `erc8004-identity` | PASS | 2.1 s |  |
| 18b | `erc8004-arc` | PASS | 12.8 s |  |
| 19 | `mpp` | PASS | 11.8 s |  |
| 20 | `hedera-schedule` | NOT RUN (on demand: about 0.18 HBAR a run; run it with --flow hedera-schedule) |  |  |
| 21 | `hedera-held` | NOT RUN (on demand: about 0.16 HBAR a run; run it with --flow hedera-held) |  |  |
| 21b | `hedera-held-undelivered` | NOT RUN (on demand: about 0.16 HBAR and 7 minutes a run; run it with --flow hedera-held-undelivered) |  |  |
| 22 | `npm-published` | NOT RUN (on demand: it installs the published packages from npm; run it with --flow npm-published) |  |  |
| 14a | `production-console` | PASS | 6.6 s |  |
| 14b | `production-hub` | PASS | 16.2 s |  |
| 14c | `production-approvals` | PASS | 2.8 s |  |
| 9 | `web` | NOT RUN (cut: screenshot rounds cover it) |  |  |

## Transactions

**arc-wrong-amount**

- fund at twice the signed price (reverted, as expected): [`0xff7736e2…c693f7`](https://explorer.testnet.arc.io/tx/0xff7736e291e3480596e6713497ed2d20bd32a081e4c28258c90605d50fc693f7)

**whitechain**

- sale fund: [`0xe6f300f0…ecbd93`](https://explorer.testnet.whitechain.io/tx/0xe6f300f0afe263f5d63826edaa88b4e9f494bea6b9315f0fad1da85c41ecbd93)
- sale release: [`0x19354a90…e8adde`](https://explorer.testnet.whitechain.io/tx/0x19354a9064240825e7b15bc992b5e0502ca11b9e11580eecc9b97aad91e8adde)
- one-click refund: [`0xdd27bf9a…c4697e`](https://explorer.testnet.whitechain.io/tx/0xdd27bf9ab5ed58c1a1dd6b77f7802c5fd3b86cfc0625b1869572f30700c4697e)

**slip-onchain-whitechain**

- release: [`0x19354a90…e8adde`](https://explorer.testnet.whitechain.io/tx/0x19354a9064240825e7b15bc992b5e0502ca11b9e11580eecc9b97aad91e8adde)

**merchant**

- sale fund: [`0xa6e90253…20125a`](https://explorer.testnet.whitechain.io/tx/0xa6e90253a834429a427c94194b35c1424038236036c8712e0b6530c0c620125a)
- sale release: [`0xf5a70c81…6452d5`](https://explorer.testnet.whitechain.io/tx/0xf5a70c8193c99ac1cba84ecc49d63e71786f6077939fe9dbc3a2d4f0f76452d5)
- partial refund: [`0x70fafc56…d2e564`](https://explorer.testnet.whitechain.io/tx/0x70fafc56ce62e49edcfb094309ccae3873bc2035a09352d42a3a83f9d8d2e564)

**public-spine**

- fund (public hub): [`0x0a1efc83…f689a7`](https://explorer.testnet.arc.io/tx/0x0a1efc8326f1f35151189bea5327d8778f50375c684b235766ead6b68ef689a7)
- release (public hub): [`0x1aa88c4f…6fb8ef`](https://explorer.testnet.arc.io/tx/0x1aa88c4f2b2c05e2cfa8e7d8f3ce3614c42739fd46c7cfd7e4309615fa6fb8ef)

**hedera-mcp**

- agent payment for the MCP call: [`0.0.918580…856042`](https://hashscan.io/testnet/transaction/0.0.9185802@1794010388.580856042)

**erc8004-arc**

- earned feedback for agent 897802: [`0x3af33b85…0d1072`](https://explorer.testnet.arc.io/tx/0x3af33b85a60ab3bea32666b5ea627c56151018e70b7c4d00d8e9bc94600d1072)

**mpp**

- mpp payment: [`0x5592de42…a00ef3`](https://explore.testnet.tempo.xyz/tx/0x5592de42b1586eff3504ad5369db1272edd3aa44be693e588e69f78081a00ef3)
- mpp payment (signed credential): [`0x89a0f554…16356e`](https://explore.testnet.tempo.xyz/tx/0x89a0f5541685567b4e23eacc5a35b76e1ad6932fd96df5e7fa7ab04e4016356e)

## Notes

- `public-spine`: bought use-arc 0xdd24c0f8 from seller 0x6BE98051B852824A3923E3B27f9781Ceb0C0ca4a
- `hedera-mcp`: paid MCP offer 0xc0ceb0a0 (Hedera Agent Kit: an HBAR transfer, built for you to sign) to 0.0.11337065
- `hedera-mcp`: settled after delivery: consensus 1794010397.281222021 > deliveredAt 1794010396
- `erc8004-identity`: agent 158 in 0x8004A818BFB912233c491871b3d84c89A494BD9e on chain 296 is owned by 0xE4eBF122a912BeF5FeC9C56e003FD4Af2CBDB5fE
- `erc8004-arc`: agents: 897802 (0x6BE98051), 897803 (0xA55a31E3)
- `erc8004-arc`: feedback on Arc for these agents: 1, earned 1
- `production-console`: default bundle: index-BWjAWrBF.js, rolldown-runtime-DLMaRju-.js, utils-De7E53Fk.js, chain-RQe9NUAy.js, hmac-DVvFcWUx.js, secp256k1-B8ku9kFS.js, serializeSignature-y6mntGi8.js, ccip-vyHjqwBh.js, _esm-BcVpWSWi.js, src-CeKFEoA6.js, hooks.module-BV8YN2_C.js, index.es-CXUqFyhV.js, index.es-DU8FEXoR.js, browser-ubDSPG6M.js, approver-BCsgmGhU.js, model-O_LlSw2g.js, accounts-AWnGOv8h.js
- `production-console`: fixture markers checked: 89
- `production-hub`: hedera: facilitator-paid only: x402 exact settles after delivery; a wallet-paid claim settles first (evidence: #321 on main c6f3a21)
- `production-hub`: checked 11 endpoints for agent 0.0.11337064 and seller 0xb7a540EA878Af43Ae0b7e5075d8A38e82c04D1a0
- `production-hub`: the approval routes, /envelopes and /approvals, are checked by production-approvals: they depend on production's approver configuration
- `production-approvals`: the phone follows 0.0.11337064, which has published no envelope mirror here, so the phone shows its absent state

## Steps

**runner-restart**

- ok · hub up · 407 ms
- ok · runner serves use-arc · 237 ms
- ok · runner stops, offer goes offline · 4 ms
- ok · runner restarts: same offer, back online · 240 ms

**arc-wrong-amount**

- ok · hub up · 354 ms
- ok · seller publishes use-arc · 223 ms
- ok · 402 challenge · 4 ms
- ok · buyer countersigns the listed price · 4 ms
- ok · hub refuses a moved price · 181 ms
- ok · chain refuses a moved price · 1.6 s
- ok · the signature holds at the signed price · 219 ms

**refusals**

- ok · hub up · 360 ms
- ok · seller publishes use-arc · 224 ms
- ok · the hub's input gate refuses a bad input · 2 ms
- ok · an input the slip cannot hash is refused before any 402 · 4 ms
- ok · the buyer refuses a bad input before signing · 363 ms
- ok · over the budget · 362 ms
- ok · over the per-seller limit · 362 ms
- ok · seller not on the allowlist · 370 ms
- ok · envelope revoked · 362 ms
- ok · held above ask-above until the human approves · 357 ms
- ok · seller offline: refused, nothing charged · 341 ms

**whitechain**

- ok · relay up with the suite's gas wallet · 1.7 s
- ok · merchant server up · 181 ms
- ok · hub up on the Whitechain rail · 346 ms
- ok · merchant publishes whitechain-dev · 246 ms
- ok · buyer holds no gas before paying · 550 ms
- ok · sale · envelope approves · 210 ms
- ok · sale · buyer pays in USDT, released · 13.9 s
- ok · sale · chain agrees, relayer paid every fee · 1.5 s
- ok · buyer holds no gas after paying · 731 ms
- ok · the merchant sees the order · 27 ms
- ok · merchant refunds in one click · 4.8 s
- ok · buyer holds no gas after the refund · 741 ms

**slip-onchain-whitechain**

- ok · the slip agrees with itself · 0 ms
- ok · Released carries the slip hash · 740 ms
- ok · the escrow stores the slip hash · 191 ms
- ok · the genuine slip verifies · 1.8 s
- ok · a tampered slip fails on chain · 1.5 s

**merchant**

- ok · relay up with the suite's gas wallet · 1.8 s
- ok · merchant server up · 186 ms
- ok · hub up on the Whitechain rail · 372 ms
- ok · merchant publishes whitechain-dev · 240 ms
- ok · sale · envelope approves · 162 ms
- ok · sale · buyer pays in USDT, released · 17.6 s
- ok · sale · chain agrees, relayer paid every fee · 929 ms
- ok · totals match the chain · 37 ms
- ok · partial refund of 0.005 USDT · 4.5 s
- ok · totals move by the refund and nothing else · 2 ms
- ok · the accountant's export · 2 ms
- ok · no token, no refund · 2 ms

**discovery**

- ok · local hub up · 380 ms
- ok · seller publishes use-arc · 225 ms
- ok · local · healthz · 0 ms
- ok · local · offer list · 1 ms
- ok · local · A2A agent card · 4 ms
- ok · local · skills index · 1 ms
- ok · local · OpenAPI · 1 ms
- ok · local · Bazaar list · 1 ms
- ok · local · unpaid call answers 402 · 3 ms
- ok · public · healthz · 451 ms
- ok · public · offer list · 302 ms
- ok · public · A2A agent card · 1.8 s
- ok · public · skills index · 304 ms
- ok · public · OpenAPI · 316 ms
- ok · public · Bazaar list · 334 ms
- ok · public · unpaid call answers 402 · 316 ms

**public-spine**

- ok · the public hub lists a live Arc offer · 327 ms
- ok · envelope approves · 188 ms
- ok · buyer pays through the public hub · 11.5 s
- ok · chain agrees · 1.2 s
- ok · slip verifies with no hub · 1.9 s

**hedera-mcp**

- ok · the public hub lists the Agent Kit MCP offer · 305 ms
- ok · 402 names the Hedera rail · 325 ms
- ok · agent pays, the runner calls the tool · 7.7 s
- ok · mirror node confirms the payment · 314 ms
- ok · spend log entry on HCS · 3.6 s
- ok · the slip binds the MCP call · 838 ms
- ok · the payment settled only after delivery (#321) · 28 ms
- ok · the tool's record matches the slip · 1 ms
- ok · the tool returned an unsigned transfer for the buyer · 8 ms

**erc8004-identity**

- ok · the seller owns its agent id · 731 ms
- ok · the registration file is an ERC-8004 v1 file naming a hub and offers · 375 ms
- ok · the A2A endpoint is this hub's card, and it lists the offer · 301 ms
- ok · every registered offer is the owner's and live on the hub · 315 ms
- ok · the declared wallet is the owner, on the chain the identity lives on · 334 ms

**erc8004-arc**

- ok · the public hub names sellers with ERC-8004 identities · 8.6 s
- ok · agent 897802 is owned by its seller and registers this hub and its offers · 401 ms
- ok · agent 897803 is owned by its seller and registers this hub and its offers · 397 ms
- ok · every feedback the reputation registry holds for them is checked, and earned feedback exists · 3.0 s

**mpp**

- ok · demo server up on the mpp rail · 308 ms
- ok · the 402 names Tempo testnet, the price and the recipient, before anything pays · 4 ms
- ok · the named payer pays with the pinned mppx · 5.6 s
- ok · Moderato shows exactly the price moved from the payer to the recipient · 310 ms
- ok · a credential replayed is refused · 5.5 s

**production-console**

- ok · the console serves its default bundle · 6.0 s
- ok · the default bundle is live, not fixtures · 630 ms

**production-hub**

- ok · the hub has a listed offer and a settlement to read · 983 ms
- ok · production declares only the rails that return money, hedera-scheduled before hedera · 289 ms
- ok · every endpoint a screen calls answers 200, open to the console · 14.9 s

**production-approvals**

- ok · the agent the phone follows · 321 ms
- ok · the approval routes answer a client with no token · 914 ms
- ok · without the approver's token the routes refuse · 0 ms
- ok · with the approver's token the routes answer · 944 ms
- ok · every approval route answers, open to the console · 315 ms
- ok · the approval decision passes CORS preflight · 322 ms

Artifacts for this run (bodies, logs, slips) stay on the build machine under `e2e/artifacts/20261107-001148-ba81/`.
