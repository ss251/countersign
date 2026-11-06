<!-- the latest full run; its own file is 20261106-231425-4754.md -->
# e2e run 20261106-231425-4754

| | |
|---|---|
| commit | `662f9e1` on `cs/e2e` |
| escrow | v2 · `0x10A3c07cc6A519C0106e315D2C42010eCbEFF3CE` |
| started | 2026-11-06 23:14:25 UTC (04:44 IST) |
| duration | 141.9 s |
| scope | full run, every flow |
| result | 14 pass · 0 fail · 0 skipped · 14 not run |

| # | Flow | Status | Time | Failed step |
|---|---|---|---|---|
| 1 | `arc-spine` | NOT RUN (escrow v2 releases only from its arbiter 0xE37F64A73225f5eA06BABcb1cc5440F01446C267, and this suite's hub signs as 0xEE4d89C544D09968dA97842e6F7be4904fbF3934) |  |  |
| 1b | `runner-restart` | PASS | 2.4 s |  |
| 2 | `arc-wrong-amount` | PASS | 2.7 s |  |
| 3 | `arc-deadline-refund` | NOT RUN (on demand: on escrow v2 it waits the 600 s settle window; run it with --with arc-deadline-refund) |  |  |
| 4a | `slip-onchain-arc` | NOT RUN (needs arc-spine) |  |  |
| 10 | `arc-gateway` | NOT RUN (retired: the Gateway rail was removed from production by flag (project lead, 23:40 IST): it debits before the seller runs and cannot be reversed) |  |  |
| 11 | `refusals` | PASS | 3.4 s |  |
| 13 | `ratings` | NOT RUN (on demand: on escrow v2 it waits the 600 s settle window; run it with --with ratings) |  |  |
| 5 | `whitechain` | PASS | 28.9 s |  |
| 4b | `slip-onchain-whitechain` | PASS | 4.2 s |  |
| 6 | `hedera` | NOT RUN (retired: plain x402 Hedera was removed from production by flag (project lead, 23:40 IST): it debits before the seller runs and cannot be reversed) |  |  |
| 7 | `merchant` | PASS | 29.4 s |  |
| 8 | `discovery` | PASS | 4.2 s |  |
| 12 | `public-spine` | PASS | 11.7 s |  |
| 15 | `public-hedera` | NOT RUN (retired: plain x402 Hedera was removed from production by flag (project lead, 23:40 IST): it debits before the seller runs and cannot be reversed) |  |  |
| 16 | `public-gateway` | NOT RUN (retired: the Gateway rail was removed from production by flag (project lead, 23:40 IST): it debits before the seller runs and cannot be reversed) |  |  |
| 17 | `hedera-mcp` | NOT RUN (retired: plain x402 Hedera was removed from production by flag (project lead, 23:40 IST): it debits before the seller runs and cannot be reversed. Its Agent Kit offer is paid held in flow 21) |  |  |
| 18 | `erc8004-identity` | PASS | 6.7 s |  |
| 18b | `erc8004-arc` | PASS | 12.7 s |  |
| 19 | `mpp` | PASS | 13.4 s |  |
| 20 | `hedera-schedule` | NOT RUN (on demand: about 0.18 HBAR a run; run it with --flow hedera-schedule) |  |  |
| 21 | `hedera-held` | NOT RUN (on demand: about 0.16 HBAR a run; run it with --flow hedera-held) |  |  |
| 21b | `hedera-held-undelivered` | NOT RUN (on demand: about 0.16 HBAR and 7 minutes a run; run it with --flow hedera-held-undelivered) |  |  |
| 22 | `npm-published` | NOT RUN (on demand: it installs the published packages from npm; run it with --flow npm-published) |  |  |
| 14a | `production-console` | PASS | 6.8 s |  |
| 14b | `production-hub` | PASS | 10.9 s |  |
| 14c | `production-approvals` | PASS | 2.6 s |  |
| 9 | `web` | NOT RUN (cut: screenshot rounds cover it) |  |  |

## Transactions

**arc-wrong-amount**

- fund at twice the signed price (reverted, as expected): [`0xe34377f4…ae752d`](https://explorer.testnet.arc.io/tx/0xe34377f4981e7f0c3361c5da60bc433528a48e82f47f6c3f62abf313a5ae752d)

**whitechain**

- sale fund: [`0x3946bf2b…7cd42a`](https://explorer.testnet.whitechain.io/tx/0x3946bf2bc2dc166aec6b4b005e06d047f84a9a626fb4dbdcbacaf9cdc27cd42a)
- sale release: [`0x5e1e774f…1f0fc2`](https://explorer.testnet.whitechain.io/tx/0x5e1e774f50edae5e996de759d64ef6eeb44e2a4944ee54131b5f33cda51f0fc2)
- one-click refund: [`0xf2d42b15…92b7cd`](https://explorer.testnet.whitechain.io/tx/0xf2d42b1582ed9fa8da6c062ea0917a5e101afbb3aa2539ced31301b09a92b7cd)

**slip-onchain-whitechain**

- release: [`0x5e1e774f…1f0fc2`](https://explorer.testnet.whitechain.io/tx/0x5e1e774f50edae5e996de759d64ef6eeb44e2a4944ee54131b5f33cda51f0fc2)

**merchant**

- sale fund: [`0x01871015…f4ae96`](https://explorer.testnet.whitechain.io/tx/0x018710157a8033182188f1de60571b788e918b0c5f0128c562917f3c6af4ae96)
- sale release: [`0x909ff799…5ecf73`](https://explorer.testnet.whitechain.io/tx/0x909ff79914045dbeace89686ad373dc088c13b31700604bd3ae2a38d5a5ecf73)
- partial refund: [`0x08be8339…305211`](https://explorer.testnet.whitechain.io/tx/0x08be833935226843916c0dbd953fbbd1780a89a6da81203291d2a8f63f305211)

**public-spine**

- fund (public hub): [`0xaa73725f…86726d`](https://explorer.testnet.arc.io/tx/0xaa73725f6d2a448d5a85f92c48c84da5ab42bfaa3a53f3f09a6bf3d9a886726d)
- release (public hub): [`0x5b3a89ec…42bae0`](https://explorer.testnet.arc.io/tx/0x5b3a89ec287eac5c37b92868494a775d53b8b5d4bcaf1f758bda361df842bae0)

**erc8004-arc**

- earned feedback for agent 897802: [`0x3af33b85…0d1072`](https://explorer.testnet.arc.io/tx/0x3af33b85a60ab3bea32666b5ea627c56151018e70b7c4d00d8e9bc94600d1072)

**mpp**

- mpp payment: [`0x365747b6…8d4546`](https://explore.testnet.tempo.xyz/tx/0x365747b6a3788c45401a6295f9ed6e69a9c5c18d8ead3e9c3638d093c38d4546)
- mpp payment (signed credential): [`0x12dfc55d…af12ba`](https://explore.testnet.tempo.xyz/tx/0x12dfc55dfa074042bb2d5aad23123ff1b2214b303aeb8974836217f96eaf12ba)

## Notes

- `public-spine`: bought use-arc 0xdd24c0f8 from seller 0x6BE98051B852824A3923E3B27f9781Ceb0C0ca4a
- `erc8004-identity`: agent 158 in 0x8004A818BFB912233c491871b3d84c89A494BD9e on chain 296 is owned by 0xE4eBF122a912BeF5FeC9C56e003FD4Af2CBDB5fE
- `erc8004-arc`: agents: 897802 (0x6BE98051), 897803 (0xA55a31E3)
- `erc8004-arc`: feedback on Arc for these agents: 1, earned 1
- `production-console`: default bundle: index-B5GuO11d.js, rolldown-runtime-DLMaRju-.js, utils-De7E53Fk.js, chain-RQe9NUAy.js, hmac-DVvFcWUx.js, secp256k1-B8ku9kFS.js, serializeSignature-y6mntGi8.js, ccip-vyHjqwBh.js, _esm-BcVpWSWi.js, src-CeKFEoA6.js, hooks.module-BV8YN2_C.js, index.es-CXUqFyhV.js, index.es-DU8FEXoR.js, browser-ubDSPG6M.js, approver-BCsgmGhU.js, model-O_LlSw2g.js, accounts-AWnGOv8h.js
- `production-console`: fixture markers checked: 89
- `production-hub`: hedera: facilitator-paid only: x402 exact settles after delivery; a wallet-paid claim settles first (evidence: #321 on main c6f3a21)
- `production-hub`: checked 11 endpoints for agent 0xE0625e01b7c79d1E399B55F252e6Bdc820733f48 and seller 0xb7a540EA878Af43Ae0b7e5075d8A38e82c04D1a0
- `production-hub`: the approval routes, /envelopes and /approvals, are checked by production-approvals: they depend on production's approver configuration

## Steps

**runner-restart**

- ok · hub up · 427 ms
- ok · runner serves use-arc · 257 ms
- ok · runner stops, offer goes offline · 5 ms
- ok · runner restarts: same offer, back online · 236 ms

**arc-wrong-amount**

- ok · hub up · 396 ms
- ok · seller publishes use-arc · 248 ms
- ok · 402 challenge · 5 ms
- ok · buyer countersigns the listed price · 4 ms
- ok · hub refuses a moved price · 184 ms
- ok · chain refuses a moved price · 1.6 s
- ok · the signature holds at the signed price · 181 ms

**refusals**

- ok · hub up · 380 ms
- ok · seller publishes use-arc · 244 ms
- ok · the hub's input gate refuses a bad input · 2 ms
- ok · an input the slip cannot hash is refused before any 402 · 5 ms
- ok · the buyer refuses a bad input before signing · 417 ms
- ok · over the budget · 427 ms
- ok · over the per-seller limit · 387 ms
- ok · seller not on the allowlist · 409 ms
- ok · envelope revoked · 410 ms
- ok · held above ask-above until the human approves · 390 ms
- ok · seller offline: refused, nothing charged · 353 ms

**whitechain**

- ok · relay up with the suite's gas wallet · 1.7 s
- ok · merchant server up · 218 ms
- ok · hub up on the Whitechain rail · 357 ms
- ok · merchant publishes whitechain-dev · 273 ms
- ok · buyer holds no gas before paying · 558 ms
- ok · sale · envelope approves · 173 ms
- ok · sale · buyer pays in USDT, released · 18.0 s
- ok · sale · chain agrees, relayer paid every fee · 1.5 s
- ok · buyer holds no gas after paying · 1.2 s
- ok · the merchant sees the order · 15 ms
- ok · merchant refunds in one click · 4.4 s
- ok · buyer holds no gas after the refund · 561 ms

**slip-onchain-whitechain**

- ok · the slip agrees with itself · 0 ms
- ok · Released carries the slip hash · 567 ms
- ok · the escrow stores the slip hash · 196 ms
- ok · the genuine slip verifies · 1.6 s
- ok · a tampered slip fails on chain · 1.9 s

**merchant**

- ok · relay up with the suite's gas wallet · 1.7 s
- ok · merchant server up · 205 ms
- ok · hub up on the Whitechain rail · 367 ms
- ok · merchant publishes whitechain-dev · 272 ms
- ok · sale · envelope approves · 189 ms
- ok · sale · buyer pays in USDT, released · 17.3 s
- ok · sale · chain agrees, relayer paid every fee · 948 ms
- ok · totals match the chain · 12 ms
- ok · partial refund of 0.005 USDT · 8.4 s
- ok · totals move by the refund and nothing else · 2 ms
- ok · the accountant's export · 2 ms
- ok · no token, no refund · 2 ms

**discovery**

- ok · local hub up · 474 ms
- ok · seller publishes use-arc · 255 ms
- ok · local · healthz · 1 ms
- ok · local · offer list · 1 ms
- ok · local · A2A agent card · 3 ms
- ok · local · skills index · 0 ms
- ok · local · OpenAPI · 1 ms
- ok · local · Bazaar list · 1 ms
- ok · local · unpaid call answers 402 · 3 ms
- ok · public · healthz · 433 ms
- ok · public · offer list · 299 ms
- ok · public · A2A agent card · 1.5 s
- ok · public · skills index · 289 ms
- ok · public · OpenAPI · 313 ms
- ok · public · Bazaar list · 299 ms
- ok · public · unpaid call answers 402 · 312 ms

**public-spine**

- ok · the public hub lists a live Arc offer · 312 ms
- ok · envelope approves · 188 ms
- ok · buyer pays through the public hub · 8.0 s
- ok · chain agrees · 1.0 s
- ok · slip verifies with no hub · 2.2 s

**erc8004-identity**

- ok · the seller owns its agent id · 2.9 s
- ok · the registration file is an ERC-8004 v1 file naming a hub and offers · 519 ms
- ok · the A2A endpoint is this hub's card, and it lists the offer · 308 ms
- ok · every registered offer is the owner's and live on the hub · 293 ms
- ok · the declared wallet is the owner, on the chain the identity lives on · 2.7 s

**erc8004-arc**

- ok · the public hub names sellers with ERC-8004 identities · 9.3 s
- ok · agent 897802 is owned by its seller and registers this hub and its offers · 361 ms
- ok · agent 897803 is owned by its seller and registers this hub and its offers · 368 ms
- ok · every feedback the reputation registry holds for them is checked, and earned feedback exists · 2.4 s

**mpp**

- ok · demo server up on the mpp rail · 333 ms
- ok · the 402 names Tempo testnet, the price and the recipient, before anything pays · 4 ms
- ok · the named payer pays with the pinned mppx · 5.8 s
- ok · Moderato shows exactly the price moved from the payer to the recipient · 322 ms
- ok · a credential replayed is refused · 7.0 s

**production-console**

- ok · the console serves its default bundle · 6.2 s
- ok · the default bundle is live, not fixtures · 644 ms

**production-hub**

- ok · the hub has a listed offer and a settlement to read · 897 ms
- ok · production declares only the rails that return money, hedera-scheduled before hedera · 298 ms
- ok · every endpoint a screen calls answers 200, open to the console · 9.7 s

**production-approvals**

- ok · the agent the phone follows · 311 ms
- ok · the approval routes answer a client with no token · 877 ms
- ok · without the approver's token the routes refuse · 0 ms
- ok · with the approver's token the routes answer · 877 ms
- ok · every approval route answers, open to the console · 287 ms
- ok · the approval decision passes CORS preflight · 289 ms

Artifacts for this run (bodies, logs, slips) stay on the build machine under `e2e/artifacts/20261106-231425-4754/`.
