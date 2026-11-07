<!-- the latest full run; its own file is 20261107-020935-f289.md -->
# e2e run 20261107-020935-f289

| | |
|---|---|
| commit | `1d03b75` on `cs/e2e` |
| escrow | v2 · `0x10A3c07cc6A519C0106e315D2C42010eCbEFF3CE` |
| started | 2026-11-07 02:09:35 UTC (07:39 IST) |
| duration | 141.6 s |
| scope | full run, every flow |
| result | 15 pass · 0 fail · 0 skipped · 13 not run |

| # | Flow | Status | Time | Failed step |
|---|---|---|---|---|
| 1 | `arc-spine` | NOT RUN (escrow v2 releases only from its arbiter 0xE37F64A73225f5eA06BABcb1cc5440F01446C267, and this suite's hub signs as 0xEE4d89C544D09968dA97842e6F7be4904fbF3934) |  |  |
| 1b | `runner-restart` | PASS | 2.4 s |  |
| 2 | `arc-wrong-amount` | PASS | 2.7 s |  |
| 3 | `arc-deadline-refund` | NOT RUN (on demand: on escrow v2 it waits the 600 s settle window; run it with --with arc-deadline-refund) |  |  |
| 4a | `slip-onchain-arc` | NOT RUN (needs arc-spine) |  |  |
| 10 | `arc-gateway` | NOT RUN (retired: the Gateway rail was removed from production by flag (project lead, 23:40 IST): it debits before the seller runs and cannot be reversed) |  |  |
| 11 | `refusals` | PASS | 3.2 s |  |
| 13 | `ratings` | NOT RUN (on demand: on escrow v2 it waits the 600 s settle window; run it with --with ratings) |  |  |
| 5 | `whitechain` | PASS | 31.5 s |  |
| 4b | `slip-onchain-whitechain` | PASS | 3.7 s |  |
| 6 | `hedera` | NOT RUN (on demand: covered hourly by flow 17; HBAR budget) |  |  |
| 7 | `merchant` | PASS | 21.2 s |  |
| 8 | `discovery` | PASS | 4.3 s |  |
| 12 | `public-spine` | PASS | 11.2 s |  |
| 15 | `public-hedera` | NOT RUN (on demand: covered hourly by flow 17; HBAR budget) |  |  |
| 16 | `public-gateway` | NOT RUN (retired: the Gateway rail was removed from production by flag (project lead, 23:40 IST): it debits before the seller runs and cannot be reversed) |  |  |
| 17 | `hedera-mcp` | PASS | 12.9 s |  |
| 18 | `erc8004-identity` | PASS | 2.1 s |  |
| 18b | `erc8004-arc` | PASS | 12.0 s |  |
| 19 | `mpp` | PASS | 10.9 s |  |
| 20 | `hedera-schedule` | NOT RUN (on demand: about 0.18 HBAR a run; run it with --flow hedera-schedule) |  |  |
| 21 | `hedera-held` | NOT RUN (on demand: about 0.16 HBAR a run; run it with --flow hedera-held) |  |  |
| 21b | `hedera-held-undelivered` | NOT RUN (on demand: about 0.16 HBAR and 7 minutes a run; run it with --flow hedera-held-undelivered) |  |  |
| 22 | `npm-published` | NOT RUN (on demand: it installs the published packages from npm; run it with --flow npm-published) |  |  |
| 14a | `production-console` | PASS | 6.5 s |  |
| 14b | `production-hub` | PASS | 12.9 s |  |
| 14c | `production-approvals` | PASS | 2.6 s |  |
| 9 | `web` | NOT RUN (cut: screenshot rounds cover it) |  |  |

## Transactions

**arc-wrong-amount**

- fund at twice the signed price (reverted, as expected): [`0x1f8ff7be…af026a`](https://explorer.testnet.arc.io/tx/0x1f8ff7beb01f8b4e5f8690099a4e19e2d80da83f9def8dd341fbfa4959af026a)

**whitechain**

- sale fund: [`0xddb4491f…ae5dd8`](https://explorer.testnet.whitechain.io/tx/0xddb4491fdd75276a2a8e7fe2c8d00aea05ad9494c200df419ab37918c4ae5dd8)
- sale release: [`0x2116cc8c…7e7c27`](https://explorer.testnet.whitechain.io/tx/0x2116cc8c118a29f290b8e5151d62d77f71d8837694a63ab2c4138399327e7c27)
- one-click refund: [`0x773429e4…35b2b4`](https://explorer.testnet.whitechain.io/tx/0x773429e47598dfd1f617d3d4e16309fe6f4a3280959a1261a9e56875ce35b2b4)

**slip-onchain-whitechain**

- release: [`0x2116cc8c…7e7c27`](https://explorer.testnet.whitechain.io/tx/0x2116cc8c118a29f290b8e5151d62d77f71d8837694a63ab2c4138399327e7c27)

**merchant**

- sale fund: [`0x05cf55ab…35b8fc`](https://explorer.testnet.whitechain.io/tx/0x05cf55ab1fa6291b76c790d330d10588d2fbd4492ff13aa67956e491fc35b8fc)
- sale release: [`0xb289fa02…e87632`](https://explorer.testnet.whitechain.io/tx/0xb289fa020bca6345b4fe84b2bed4c12b476b994dab262c6e7ce6887bb6e87632)
- partial refund: [`0x01282ae1…6c431a`](https://explorer.testnet.whitechain.io/tx/0x01282ae1fe27f7be1d1ff22eb4c1fd6c25bf9842951a69253ceec900ff6c431a)

**public-spine**

- fund (public hub): [`0x5c9ef787…22714a`](https://explorer.testnet.arc.io/tx/0x5c9ef787f11e3047071c6b9743e54291d6a587ada884604b643be2f8da22714a)
- release (public hub): [`0x42e1f178…65e297`](https://explorer.testnet.arc.io/tx/0x42e1f17855825e422c836654e131b28c15c7d39f0c33a34fe9f81aea8865e297)

**hedera-mcp**

- agent payment for the MCP call: [`0.0.918580…117221`](https://hashscan.io/testnet/transaction/0.0.9185802@1794017453.086117221)

**erc8004-arc**

- earned feedback for agent 897802: [`0x3af33b85…0d1072`](https://explorer.testnet.arc.io/tx/0x3af33b85a60ab3bea32666b5ea627c56151018e70b7c4d00d8e9bc94600d1072)

**mpp**

- mpp payment: [`0x797cf031…052341`](https://explore.testnet.tempo.xyz/tx/0x797cf0316e435885edec7634cf11bb010d806b58e90d833110d0add497052341)
- mpp payment (signed credential): [`0x01af6d3d…e5eeac`](https://explore.testnet.tempo.xyz/tx/0x01af6d3d5b2b92f93621c343034cf3d3492d6cab1590b809d9b65f05d1e5eeac)

## Notes

- `public-spine`: bought use-arc 0xdd24c0f8 from seller 0x6BE98051B852824A3923E3B27f9781Ceb0C0ca4a
- `hedera-mcp`: paid MCP offer 0xc0ceb0a0 (Hedera Agent Kit: an HBAR transfer, built for you to sign) to 0.0.11337065
- `hedera-mcp`: settled after delivery: consensus 1794017462.440425104 > deliveredAt 1794017461
- `erc8004-identity`: agent 158 in 0x8004A818BFB912233c491871b3d84c89A494BD9e on chain 296 is owned by 0xE4eBF122a912BeF5FeC9C56e003FD4Af2CBDB5fE
- `erc8004-arc`: agents: 897802 (0x6BE98051), 897803 (0xA55a31E3)
- `erc8004-arc`: feedback on Arc for these agents: 1, earned 1
- `production-console`: default bundle: index-BdF8UOXn.js, rolldown-runtime-DLMaRju-.js, utils-De7E53Fk.js, chain-RQe9NUAy.js, hmac-DVvFcWUx.js, secp256k1-B8ku9kFS.js, serializeSignature-y6mntGi8.js, ccip-vyHjqwBh.js, _esm-BcVpWSWi.js, src-CeKFEoA6.js, hooks.module-BV8YN2_C.js, index.es-CXUqFyhV.js, index.es-DU8FEXoR.js, browser-ubDSPG6M.js, approver-BCsgmGhU.js, model-O_LlSw2g.js, accounts-AWnGOv8h.js
- `production-console`: fixture markers checked: 89
- `production-hub`: hedera: facilitator-paid only: x402 exact settles after delivery; a wallet-paid claim settles first (evidence: #321 on main c6f3a21)
- `production-hub`: checked 11 endpoints for agent 0.0.11337064 and seller 0xb821Fc3a6b23B61eEED792ad43E7485257A0c7b7
- `production-hub`: the approval routes, /envelopes and /approvals, are checked by production-approvals: they depend on production's approver configuration
- `production-approvals`: the phone follows 0.0.11337064, which has published no envelope mirror here, so the phone shows its absent state

## Steps

**runner-restart**

- ok · hub up · 407 ms
- ok · runner serves use-arc · 245 ms
- ok · runner stops, offer goes offline · 5 ms
- ok · runner restarts: same offer, back online · 223 ms

**arc-wrong-amount**

- ok · hub up · 379 ms
- ok · seller publishes use-arc · 259 ms
- ok · 402 challenge · 4 ms
- ok · buyer countersigns the listed price · 4 ms
- ok · hub refuses a moved price · 187 ms
- ok · chain refuses a moved price · 1.7 s
- ok · the signature holds at the signed price · 184 ms

**refusals**

- ok · hub up · 394 ms
- ok · seller publishes use-arc · 237 ms
- ok · the hub's input gate refuses a bad input · 2 ms
- ok · an input the slip cannot hash is refused before any 402 · 4 ms
- ok · the buyer refuses a bad input before signing · 375 ms
- ok · over the budget · 366 ms
- ok · over the per-seller limit · 365 ms
- ok · seller not on the allowlist · 368 ms
- ok · envelope revoked · 360 ms
- ok · held above ask-above until the human approves · 364 ms
- ok · seller offline: refused, nothing charged · 349 ms

**whitechain**

- ok · relay up with the suite's gas wallet · 1.8 s
- ok · merchant server up · 181 ms
- ok · hub up on the Whitechain rail · 348 ms
- ok · merchant publishes whitechain-dev · 240 ms
- ok · buyer holds no gas before paying · 547 ms
- ok · sale · envelope approves · 180 ms
- ok · sale · buyer pays in USDT, released · 17.4 s
- ok · sale · chain agrees, relayer paid every fee · 1.5 s
- ok · buyer holds no gas after paying · 547 ms
- ok · the merchant sees the order · 8 ms
- ok · merchant refunds in one click · 8.0 s
- ok · buyer holds no gas after the refund · 760 ms

**slip-onchain-whitechain**

- ok · the slip agrees with itself · 0 ms
- ok · Released carries the slip hash · 564 ms
- ok · the escrow stores the slip hash · 188 ms
- ok · the genuine slip verifies · 1.5 s
- ok · a tampered slip fails on chain · 1.5 s

**merchant**

- ok · relay up with the suite's gas wallet · 1.7 s
- ok · merchant server up · 184 ms
- ok · hub up on the Whitechain rail · 445 ms
- ok · merchant publishes whitechain-dev · 266 ms
- ok · sale · envelope approves · 181 ms
- ok · sale · buyer pays in USDT, released · 13.3 s
- ok · sale · chain agrees, relayer paid every fee · 923 ms
- ok · totals match the chain · 11 ms
- ok · partial refund of 0.005 USDT · 4.1 s
- ok · totals move by the refund and nothing else · 1 ms
- ok · the accountant's export · 2 ms
- ok · no token, no refund · 1 ms

**discovery**

- ok · local hub up · 544 ms
- ok · seller publishes use-arc · 319 ms
- ok · local · healthz · 1 ms
- ok · local · offer list · 1 ms
- ok · local · A2A agent card · 5 ms
- ok · local · skills index · 1 ms
- ok · local · OpenAPI · 1 ms
- ok · local · Bazaar list · 1 ms
- ok · local · unpaid call answers 402 · 3 ms
- ok · public · healthz · 436 ms
- ok · public · offer list · 320 ms
- ok · public · A2A agent card · 1.5 s
- ok · public · skills index · 295 ms
- ok · public · OpenAPI · 306 ms
- ok · public · Bazaar list · 297 ms
- ok · public · unpaid call answers 402 · 299 ms

**public-spine**

- ok · the public hub lists a live Arc offer · 293 ms
- ok · envelope approves · 207 ms
- ok · buyer pays through the public hub · 7.7 s
- ok · chain agrees · 920 ms
- ok · slip verifies with no hub · 2.0 s

**hedera-mcp**

- ok · the public hub lists the Agent Kit MCP offer · 303 ms
- ok · 402 names the Hedera rail · 293 ms
- ok · agent pays, the runner calls the tool · 7.5 s
- ok · mirror node confirms the payment · 3.6 s
- ok · spend log entry on HCS · 315 ms
- ok · the slip binds the MCP call · 785 ms
- ok · the payment settled only after delivery (#321) · 29 ms
- ok · the tool's record matches the slip · 1 ms
- ok · the tool returned an unsigned transfer for the buyer · 8 ms

**erc8004-identity**

- ok · the seller owns its agent id · 779 ms
- ok · the registration file is an ERC-8004 v1 file naming a hub and offers · 373 ms
- ok · the A2A endpoint is this hub's card, and it lists the offer · 289 ms
- ok · every registered offer is the owner's and live on the hub · 292 ms
- ok · the declared wallet is the owner, on the chain the identity lives on · 323 ms

**erc8004-arc**

- ok · the public hub names sellers with ERC-8004 identities · 7.8 s
- ok · agent 897802 is owned by its seller and registers this hub and its offers · 369 ms
- ok · agent 897803 is owned by its seller and registers this hub and its offers · 363 ms
- ok · every feedback the reputation registry holds for them is checked, and earned feedback exists · 3.1 s

**mpp**

- ok · demo server up on the mpp rail · 334 ms
- ok · the 402 names Tempo testnet, the price and the recipient, before anything pays · 4 ms
- ok · the named payer pays with the pinned mppx · 5.2 s
- ok · Moderato shows exactly the price moved from the payer to the recipient · 315 ms
- ok · a credential replayed is refused · 5.1 s

**production-console**

- ok · the console serves its default bundle · 5.8 s
- ok · the default bundle is live, not fixtures · 677 ms

**production-hub**

- ok · the hub has a listed offer and a settlement to read · 905 ms
- ok · production declares only the rails that return money, hedera-scheduled before hedera · 312 ms
- ok · every endpoint a screen calls answers 200, open to the console · 11.7 s

**production-approvals**

- ok · the agent the phone follows · 286 ms
- ok · the approval routes answer a client with no token · 892 ms
- ok · without the approver's token the routes refuse · 0 ms
- ok · with the approver's token the routes answer · 871 ms
- ok · every approval route answers, open to the console · 296 ms
- ok · the approval decision passes CORS preflight · 290 ms

Artifacts for this run (bodies, logs, slips) stay on the build machine under `e2e/artifacts/20261107-020935-f289/`.
