<!-- the latest full run; its own file is 20261107-030658-303f.md -->
# e2e run 20261107-030658-303f

| | |
|---|---|
| commit | `2eb0f8a` on `cs/e2e` |
| escrow | v2 · `0x10A3c07cc6A519C0106e315D2C42010eCbEFF3CE` |
| started | 2026-11-07 03:06:58 UTC (08:36 IST) |
| duration | 159.8 s |
| scope | full run, every flow |
| result | 14 pass · 1 fail · 0 skipped · 13 not run |

| # | Flow | Status | Time | Failed step |
|---|---|---|---|---|
| 1 | `arc-spine` | NOT RUN (escrow v2 releases only from its arbiter 0xE37F64A73225f5eA06BABcb1cc5440F01446C267, and this suite's hub signs as 0xEE4d89C544D09968dA97842e6F7be4904fbF3934) |  |  |
| 1b | `runner-restart` | PASS | 2.4 s |  |
| 2 | `arc-wrong-amount` | PASS | 4.2 s |  |
| 3 | `arc-deadline-refund` | NOT RUN (on demand: on escrow v2 it waits the 600 s settle window; run it with --with arc-deadline-refund) |  |  |
| 4a | `slip-onchain-arc` | NOT RUN (needs arc-spine) |  |  |
| 10 | `arc-gateway` | NOT RUN (retired: the Gateway rail was removed from production by flag (project lead, 23:40 IST): it debits before the seller runs and cannot be reversed) |  |  |
| 11 | `refusals` | PASS | 3.2 s |  |
| 13 | `ratings` | NOT RUN (on demand: on escrow v2 it waits the 600 s settle window; run it with --with ratings) |  |  |
| 5 | `whitechain` | PASS | 27.9 s |  |
| 4b | `slip-onchain-whitechain` | PASS | 3.7 s |  |
| 6 | `hedera` | NOT RUN (on demand: covered hourly by flow 17; HBAR budget) |  |  |
| 7 | `merchant` | PASS | 30.6 s |  |
| 8 | `discovery` | FAIL | 3.9 s | `public · unpaid call answers 402` |
| 12 | `public-spine` | PASS | 14.5 s |  |
| 15 | `public-hedera` | NOT RUN (on demand: covered hourly by flow 17; HBAR budget) |  |  |
| 16 | `public-gateway` | NOT RUN (retired: the Gateway rail was removed from production by flag (project lead, 23:40 IST): it debits before the seller runs and cannot be reversed) |  |  |
| 17 | `hedera-mcp` | PASS | 12.4 s |  |
| 18 | `erc8004-identity` | PASS | 2.0 s |  |
| 18b | `erc8004-arc` | PASS | 19.1 s |  |
| 19 | `mpp` | PASS | 10.8 s |  |
| 20 | `hedera-schedule` | NOT RUN (on demand: about 0.18 HBAR a run; run it with --flow hedera-schedule) |  |  |
| 21 | `hedera-held` | NOT RUN (on demand: about 0.16 HBAR a run; run it with --flow hedera-held) |  |  |
| 21b | `hedera-held-undelivered` | NOT RUN (on demand: about 0.16 HBAR and 7 minutes a run; run it with --flow hedera-held-undelivered) |  |  |
| 22 | `npm-published` | NOT RUN (on demand: it installs the published packages from npm; run it with --flow npm-published) |  |  |
| 14a | `production-console` | PASS | 9.1 s |  |
| 14b | `production-hub` | PASS | 11.8 s |  |
| 14c | `production-approvals` | PASS | 2.6 s |  |
| 9 | `web` | NOT RUN (cut: screenshot rounds cover it) |  |  |

## Transactions

**arc-wrong-amount**

- fund at twice the signed price (reverted, as expected): [`0xde249408…21dfce`](https://explorer.testnet.arc.io/tx/0xde249408f48e4749f91693588db03ce59f191aa8c90b60dfd90b9a2cd121dfce)

**whitechain**

- sale fund: [`0x34b58b3b…b47969`](https://explorer.testnet.whitechain.io/tx/0x34b58b3b36782e8cc11129154d7dec2692f0acc570e20f7e726648840cb47969)
- sale release: [`0x32b33b11…699248`](https://explorer.testnet.whitechain.io/tx/0x32b33b114f6e19f71ab616ecbbd149fe34e1a5b58958b65124b2c5c673699248)
- one-click refund: [`0x9490e516…51525f`](https://explorer.testnet.whitechain.io/tx/0x9490e516f79929c7ca2ff3731aadae811a910087103fbb2af9ca43010e51525f)

**slip-onchain-whitechain**

- release: [`0x32b33b11…699248`](https://explorer.testnet.whitechain.io/tx/0x32b33b114f6e19f71ab616ecbbd149fe34e1a5b58958b65124b2c5c673699248)

**merchant**

- sale fund: [`0x214997f4…5f4740`](https://explorer.testnet.whitechain.io/tx/0x214997f47b479f7658e668d4954c346e4fe254c4b3f542bc7f47ebd46e5f4740)
- sale release: [`0x9a9c29bd…a3e1d6`](https://explorer.testnet.whitechain.io/tx/0x9a9c29bdca70aa39fced4977249fced6dcbb84204ba2aff789e25060c5a3e1d6)
- partial refund: [`0xbffb7326…3e69f7`](https://explorer.testnet.whitechain.io/tx/0xbffb7326a02a864e2dd0c4b35a4b2ba58b36c0ee8dc55d11453adf1a453e69f7)

**public-spine**

- fund (public hub): [`0xfc6ce19f…e8d6b2`](https://explorer.testnet.arc.io/tx/0xfc6ce19f96a8c52a942b02c66d48477d3a2dc88b495f9a017b41b0bed6e8d6b2)
- release (public hub): [`0xe2e1a534…0b8b4d`](https://explorer.testnet.arc.io/tx/0xe2e1a5346ed045b41e057189165d34cdcf90e1a6d25b272715c0c8df840b8b4d)

**hedera-mcp**

- agent payment for the MCP call: [`0.0.918580…270156`](https://hashscan.io/testnet/transaction/0.0.9185802@1794020908.413270156)

**erc8004-arc**

- earned feedback for agent 897802: [`0x3af33b85…0d1072`](https://explorer.testnet.arc.io/tx/0x3af33b85a60ab3bea32666b5ea627c56151018e70b7c4d00d8e9bc94600d1072)

**mpp**

- mpp payment: [`0xa4da6088…5bd22f`](https://explore.testnet.tempo.xyz/tx/0xa4da60880845af3d5b03a16e4f953a04d71d1f8acf0ecc27a0f24b07445bd22f)
- mpp payment (signed credential): [`0x8426a3eb…3eb19d`](https://explore.testnet.tempo.xyz/tx/0x8426a3ebba74b21b236a0659c808579adc8a98cb074b2cfe2ab6def4c73eb19d)

## Failures

**discovery** · step `public · unpaid call answers 402` · owner orch-cs

> unpaid call status: expected 402, got 422

## Notes

- `public-spine`: bought use-arc 0xdd24c0f8 from seller 0x6BE98051B852824A3923E3B27f9781Ceb0C0ca4a
- `hedera-mcp`: paid MCP offer 0xc0ceb0a0 (Hedera Agent Kit: an HBAR transfer, built for you to sign) to 0.0.11337065
- `hedera-mcp`: settled after delivery: consensus 1794020914.866544104 > deliveredAt 1794020914
- `erc8004-identity`: agent 158 in 0x8004A818BFB912233c491871b3d84c89A494BD9e on chain 296 is owned by 0xE4eBF122a912BeF5FeC9C56e003FD4Af2CBDB5fE
- `erc8004-arc`: agents: 897802 (0x6BE98051), 897803 (0xA55a31E3)
- `erc8004-arc`: feedback on Arc for these agents: 1, earned 1
- `production-console`: default bundle: index-Bft-1tdy.js, rolldown-runtime-DLMaRju-.js, buffer-B85wqXBr.js, utils-62W0Csdc.js, sha3-Dlq0T7vU.js, chain-BwgxZr_A.js, hmac-OwI8upBC.js, sha256-TIGeBBNb.js, secp256k1-7dUK1U83.js, serializeSignature-57-rETp1.js, preload-helper-CCMZs0eX.js, ccip-Dus8cnXg.js, _esm-DgTlVRoj.js, src-CfiyUlP0.js, index.es-C8ON-r_q.js, index.es-BG1JiRNs.js, hooks.module-CN0Y_3Ec.js, browser-ubDSPG6M.js, quick-format-unescaped-CDECh6Ci.js, index.es-DkKcQLXu.js, constants-Ar-mqkbW.js, approver-CLYbdM_x.js, model-O_LlSw2g.js, accounts-DDOy_AsG.js
- `production-console`: fixture markers checked: 89
- `production-hub`: hedera: facilitator-paid only: x402 exact settles after delivery; a wallet-paid claim settles first (evidence: #321 on main c6f3a21)
- `production-hub`: checked 11 endpoints for agent 0.0.11337064 and seller 0x6BE98051B852824A3923E3B27f9781Ceb0C0ca4a
- `production-hub`: the approval routes, /envelopes and /approvals, are checked by production-approvals: they depend on production's approver configuration
- `production-approvals`: the phone follows 0.0.11337064, which has published no envelope mirror here, so the phone shows its absent state

## Steps

**runner-restart**

- ok · hub up · 400 ms
- ok · runner serves use-arc · 257 ms
- ok · runner stops, offer goes offline · 6 ms
- ok · runner restarts: same offer, back online · 252 ms

**arc-wrong-amount**

- ok · hub up · 354 ms
- ok · seller publishes use-arc · 237 ms
- ok · 402 challenge · 4 ms
- ok · buyer countersigns the listed price · 4 ms
- ok · hub refuses a moved price · 187 ms
- ok · chain refuses a moved price · 3.2 s
- ok · the signature holds at the signed price · 184 ms

**refusals**

- ok · hub up · 367 ms
- ok · seller publishes use-arc · 231 ms
- ok · the hub's input gate refuses a bad input · 2 ms
- ok · an input the slip cannot hash is refused before any 402 · 4 ms
- ok · the buyer refuses a bad input before signing · 374 ms
- ok · over the budget · 365 ms
- ok · over the per-seller limit · 361 ms
- ok · seller not on the allowlist · 358 ms
- ok · envelope revoked · 365 ms
- ok · held above ask-above until the human approves · 366 ms
- ok · seller offline: refused, nothing charged · 355 ms

**whitechain**

- ok · relay up with the suite's gas wallet · 1.7 s
- ok · merchant server up · 189 ms
- ok · hub up on the Whitechain rail · 350 ms
- ok · merchant publishes whitechain-dev · 251 ms
- ok · buyer holds no gas before paying · 559 ms
- ok · sale · envelope approves · 187 ms
- ok · sale · buyer pays in USDT, released · 13.7 s
- ok · sale · chain agrees, relayer paid every fee · 1.4 s
- ok · buyer holds no gas after paying · 721 ms
- ok · the merchant sees the order · 11 ms
- ok · merchant refunds in one click · 8.0 s
- ok · buyer holds no gas after the refund · 730 ms

**slip-onchain-whitechain**

- ok · the slip agrees with itself · 0 ms
- ok · Released carries the slip hash · 551 ms
- ok · the escrow stores the slip hash · 207 ms
- ok · the genuine slip verifies · 1.6 s
- ok · a tampered slip fails on chain · 1.3 s

**merchant**

- ok · relay up with the suite's gas wallet · 1.8 s
- ok · merchant server up · 209 ms
- ok · hub up on the Whitechain rail · 400 ms
- ok · merchant publishes whitechain-dev · 244 ms
- ok · sale · envelope approves · 163 ms
- ok · sale · buyer pays in USDT, released · 18.9 s
- ok · sale · chain agrees, relayer paid every fee · 905 ms
- ok · totals match the chain · 11 ms
- ok · partial refund of 0.005 USDT · 8.0 s
- ok · totals move by the refund and nothing else · 2 ms
- ok · the accountant's export · 3 ms
- ok · no token, no refund · 2 ms

**discovery**

- ok · local hub up · 429 ms
- ok · seller publishes use-arc · 239 ms
- ok · local · healthz · 0 ms
- ok · local · offer list · 1 ms
- ok · local · A2A agent card · 4 ms
- ok · local · skills index · 1 ms
- ok · local · OpenAPI · 1 ms
- ok · local · Bazaar list · 1 ms
- ok · local · unpaid call answers 402 · 3 ms
- ok · public · healthz · 429 ms
- ok · public · offer list · 308 ms
- ok · public · A2A agent card · 1.2 s
- ok · public · skills index · 297 ms
- ok · public · OpenAPI · 309 ms
- ok · public · Bazaar list · 310 ms
- FAIL · public · unpaid call answers 402 · 287 ms · unpaid call status: expected 402, got 422

**public-spine**

- ok · the public hub lists a live Arc offer · 297 ms
- ok · envelope approves · 211 ms
- ok · buyer pays through the public hub · 11.3 s
- ok · chain agrees · 863 ms
- ok · slip verifies with no hub · 1.8 s

**hedera-mcp**

- ok · the public hub lists the Agent Kit MCP offer · 291 ms
- ok · 402 names the Hedera rail · 292 ms
- ok · agent pays, the runner calls the tool · 7.0 s
- ok · mirror node confirms the payment · 3.6 s
- ok · spend log entry on HCS · 325 ms
- ok · the slip binds the MCP call · 788 ms
- ok · the payment settled only after delivery (#321) · 31 ms
- ok · the tool's record matches the slip · 1 ms
- ok · the tool returned an unsigned transfer for the buyer · 8 ms

**erc8004-identity**

- ok · the seller owns its agent id · 745 ms
- ok · the registration file is an ERC-8004 v1 file naming a hub and offers · 382 ms
- ok · the A2A endpoint is this hub's card, and it lists the offer · 303 ms
- ok · every registered offer is the owner's and live on the hub · 291 ms
- ok · the declared wallet is the owner, on the chain the identity lives on · 323 ms

**erc8004-arc**

- ok · the public hub names sellers with ERC-8004 identities · 14.1 s
- ok · agent 897802 is owned by its seller and registers this hub and its offers · 373 ms
- ok · agent 897803 is owned by its seller and registers this hub and its offers · 370 ms
- ok · every feedback the reputation registry holds for them is checked, and earned feedback exists · 4.0 s

**mpp**

- ok · demo server up on the mpp rail · 333 ms
- ok · the 402 names Tempo testnet, the price and the recipient, before anything pays · 4 ms
- ok · the named payer pays with the pinned mppx · 4.9 s
- ok · Moderato shows exactly the price moved from the payer to the recipient · 306 ms
- ok · a credential replayed is refused · 5.2 s

**production-console**

- ok · the console serves its default bundle · 8.4 s
- ok · the default bundle is live, not fixtures · 679 ms

**production-hub**

- ok · the hub has a listed offer and a settlement to read · 896 ms
- ok · production declares only the rails that return money, hedera-scheduled before hedera · 296 ms
- ok · every endpoint a screen calls answers 200, open to the console · 10.6 s

**production-approvals**

- ok · the agent the phone follows · 294 ms
- ok · the approval routes answer a client with no token · 887 ms
- ok · without the approver's token the routes refuse · 0 ms
- ok · with the approver's token the routes answer · 899 ms
- ok · every approval route answers, open to the console · 285 ms
- ok · the approval decision passes CORS preflight · 283 ms

Artifacts for this run (bodies, logs, slips) stay on the build machine under `e2e/artifacts/20261107-030658-303f/`.
