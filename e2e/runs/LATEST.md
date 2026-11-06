<!-- the latest full run; its own file is 20261106-233159-6a7d.md -->
# e2e run 20261106-233159-6a7d

| | |
|---|---|
| commit | `4543f99` on `cs/e2e` |
| escrow | v2 · `0x10A3c07cc6A519C0106e315D2C42010eCbEFF3CE` |
| started | 2026-11-06 23:31:59 UTC (05:01 IST) |
| duration | 158.8 s |
| scope | full run, every flow |
| result | 16 pass · 0 fail · 0 skipped · 12 not run |

| # | Flow | Status | Time | Failed step |
|---|---|---|---|---|
| 1 | `arc-spine` | NOT RUN (escrow v2 releases only from its arbiter 0xE37F64A73225f5eA06BABcb1cc5440F01446C267, and this suite's hub signs as 0xEE4d89C544D09968dA97842e6F7be4904fbF3934) |  |  |
| 1b | `runner-restart` | PASS | 2.6 s |  |
| 2 | `arc-wrong-amount` | PASS | 4.2 s |  |
| 3 | `arc-deadline-refund` | NOT RUN (on demand: on escrow v2 it waits the 600 s settle window; run it with --with arc-deadline-refund) |  |  |
| 4a | `slip-onchain-arc` | NOT RUN (needs arc-spine) |  |  |
| 10 | `arc-gateway` | NOT RUN (retired: the Gateway rail was removed from production by flag (project lead, 23:40 IST): it debits before the seller runs and cannot be reversed) |  |  |
| 11 | `refusals` | PASS | 3.7 s |  |
| 13 | `ratings` | NOT RUN (on demand: on escrow v2 it waits the 600 s settle window; run it with --with ratings) |  |  |
| 5 | `whitechain` | PASS | 32.3 s |  |
| 4b | `slip-onchain-whitechain` | PASS | 4.0 s |  |
| 6 | `hedera` | PASS | 20.1 s |  |
| 7 | `merchant` | PASS | 29.9 s |  |
| 8 | `discovery` | PASS | 4.0 s |  |
| 12 | `public-spine` | PASS | 11.7 s |  |
| 15 | `public-hedera` | NOT RUN (on demand: covered hourly by flow 17; HBAR budget) |  |  |
| 16 | `public-gateway` | NOT RUN (retired: the Gateway rail was removed from production by flag (project lead, 23:40 IST): it debits before the seller runs and cannot be reversed) |  |  |
| 17 | `hedera-mcp` | PASS | 12.4 s |  |
| 18 | `erc8004-identity` | PASS | 2.0 s |  |
| 18b | `erc8004-arc` | PASS | 4.0 s |  |
| 19 | `mpp` | PASS | 12.2 s |  |
| 20 | `hedera-schedule` | NOT RUN (on demand: about 0.18 HBAR a run; run it with --flow hedera-schedule) |  |  |
| 21 | `hedera-held` | NOT RUN (on demand: about 0.16 HBAR a run; run it with --flow hedera-held) |  |  |
| 21b | `hedera-held-undelivered` | NOT RUN (on demand: about 0.16 HBAR and 7 minutes a run; run it with --flow hedera-held-undelivered) |  |  |
| 22 | `npm-published` | NOT RUN (on demand: it installs the published packages from npm; run it with --flow npm-published) |  |  |
| 14a | `production-console` | PASS | 6.4 s |  |
| 14b | `production-hub` | PASS | 4.5 s |  |
| 14c | `production-approvals` | PASS | 2.8 s |  |
| 9 | `web` | NOT RUN (cut: screenshot rounds cover it) |  |  |

## Transactions

**arc-wrong-amount**

- fund at twice the signed price (reverted, as expected): [`0xcb67cb9f…fc3b62`](https://explorer.testnet.arc.io/tx/0xcb67cb9f948a8314f249ccbbf9004771e17dc87a0972ed6e88a857d8fdfc3b62)

**whitechain**

- sale fund: [`0x4baa5e26…2b97d2`](https://explorer.testnet.whitechain.io/tx/0x4baa5e26d08796f7e1fe11f20a5b09ce22a91c6b9f168b10ae6606134f2b97d2)
- sale release: [`0xf1aa0086…cef9da`](https://explorer.testnet.whitechain.io/tx/0xf1aa0086bfc9f805a7ffa9e838b72c9e28c11c11023d4dbc2c21d56227cef9da)
- one-click refund: [`0x43a21c7f…cfcf97`](https://explorer.testnet.whitechain.io/tx/0x43a21c7fa0a63377ab6d75d87c20e07ccd9d34b38a603f6441aa389fa6cfcf97)

**slip-onchain-whitechain**

- release: [`0xf1aa0086…cef9da`](https://explorer.testnet.whitechain.io/tx/0xf1aa0086bfc9f805a7ffa9e838b72c9e28c11c11023d4dbc2c21d56227cef9da)

**hedera**

- agent payment: [`0.0.918580…104725`](https://hashscan.io/testnet/transaction/0.0.9185802@1794007968.089104725)

**merchant**

- sale fund: [`0x6d94b6d8…329889`](https://explorer.testnet.whitechain.io/tx/0x6d94b6d8804986cf732e92c2babbedb725fb8ab714b337f961afda2592329889)
- sale release: [`0xd32d5225…bb8c64`](https://explorer.testnet.whitechain.io/tx/0xd32d52254c60f4fb69c70fb270a81cfc0fda53ccf90aad6f39f3e7e8cfbb8c64)
- partial refund: [`0x56441fcf…1acbe0`](https://explorer.testnet.whitechain.io/tx/0x56441fcf8029c568db07e6501ccca83d923705e2d62372970142e3cc641acbe0)

**public-spine**

- fund (public hub): [`0xb9fe1a88…be6e03`](https://explorer.testnet.arc.io/tx/0xb9fe1a88fa19f2fc9ff492782ba9c5711702be7f600af891c269d81093be6e03)
- release (public hub): [`0x0f0d8692…36e0f1`](https://explorer.testnet.arc.io/tx/0x0f0d869269a30ff8e977d0ba72241c6ec80d529902a374301c17fa990236e0f1)

**hedera-mcp**

- agent payment for the MCP call: [`0.0.918580…462168`](https://hashscan.io/testnet/transaction/0.0.9185802@1794008030.099462168)

**erc8004-arc**

- earned feedback for agent 897802: [`0x3af33b85…0d1072`](https://explorer.testnet.arc.io/tx/0x3af33b85a60ab3bea32666b5ea627c56151018e70b7c4d00d8e9bc94600d1072)

**mpp**

- mpp payment: [`0xc85afb56…499091`](https://explore.testnet.tempo.xyz/tx/0xc85afb56db24ed189a255268d7190b12d8d67bc21a1022bbf438bdde28499091)
- mpp payment (signed credential): [`0xaf19d3d2…424bb6`](https://explore.testnet.tempo.xyz/tx/0xaf19d3d2f2781ee85fd48f6ab6af782559424e502baaadc27480bcc92b424bb6)

## Notes

- `hedera`: facilitator: x402.org
- `hedera`: spend log: topic 0.0.11337070 sequence 115
- `hedera`: reconciled 1 agent payment(s) against 8 spend or schedule entries
- `public-spine`: bought use-arc 0xdd24c0f8 from seller 0x6BE98051B852824A3923E3B27f9781Ceb0C0ca4a
- `hedera-mcp`: paid MCP offer 0xc0ceb0a0 (Hedera Agent Kit: an HBAR transfer, built for you to sign) to 0.0.11337065
- `hedera-mcp`: settled after delivery: consensus 1794008038.397682104 > deliveredAt 1794008037
- `erc8004-identity`: agent 158 in 0x8004A818BFB912233c491871b3d84c89A494BD9e on chain 296 is owned by 0xE4eBF122a912BeF5FeC9C56e003FD4Af2CBDB5fE
- `erc8004-arc`: agents: 897802 (0x6BE98051), 897803 (0xA55a31E3)
- `erc8004-arc`: feedback on Arc for these agents: 1, earned 1
- `production-console`: default bundle: index-GvA2EeX5.js, rolldown-runtime-DLMaRju-.js, utils-De7E53Fk.js, chain-RQe9NUAy.js, hmac-DVvFcWUx.js, secp256k1-B8ku9kFS.js, serializeSignature-y6mntGi8.js, ccip-vyHjqwBh.js, _esm-BcVpWSWi.js, src-CeKFEoA6.js, hooks.module-BV8YN2_C.js, index.es-CXUqFyhV.js, index.es-DU8FEXoR.js, browser-ubDSPG6M.js, approver-BCsgmGhU.js, model-O_LlSw2g.js, accounts-AWnGOv8h.js
- `production-console`: fixture markers checked: 89
- `production-hub`: hedera: facilitator-paid only: x402 exact settles after delivery; a wallet-paid claim settles first (evidence: #321 on main c6f3a21)
- `production-hub`: checked 11 endpoints for agent 0.0.11337064 and seller 0xb7a540EA878Af43Ae0b7e5075d8A38e82c04D1a0
- `production-hub`: the approval routes, /envelopes and /approvals, are checked by production-approvals: they depend on production's approver configuration
- `production-approvals`: the phone follows 0.0.11337064, which has published no envelope mirror here, so the phone shows its absent state

## Steps

**runner-restart**

- ok · hub up · 545 ms
- ok · runner serves use-arc · 326 ms
- ok · runner stops, offer goes offline · 7 ms
- ok · runner restarts: same offer, back online · 240 ms

**arc-wrong-amount**

- ok · hub up · 422 ms
- ok · seller publishes use-arc · 262 ms
- ok · 402 challenge · 4 ms
- ok · buyer countersigns the listed price · 4 ms
- ok · hub refuses a moved price · 178 ms
- ok · chain refuses a moved price · 3.1 s
- ok · the signature holds at the signed price · 176 ms

**refusals**

- ok · hub up · 432 ms
- ok · seller publishes use-arc · 262 ms
- ok · the hub's input gate refuses a bad input · 2 ms
- ok · an input the slip cannot hash is refused before any 402 · 5 ms
- ok · the buyer refuses a bad input before signing · 419 ms
- ok · over the budget · 424 ms
- ok · over the per-seller limit · 418 ms
- ok · seller not on the allowlist · 413 ms
- ok · envelope revoked · 441 ms
- ok · held above ask-above until the human approves · 423 ms
- ok · seller offline: refused, nothing charged · 420 ms

**whitechain**

- ok · relay up with the suite's gas wallet · 1.8 s
- ok · merchant server up · 207 ms
- ok · hub up on the Whitechain rail · 412 ms
- ok · merchant publishes whitechain-dev · 274 ms
- ok · buyer holds no gas before paying · 547 ms
- ok · sale · envelope approves · 190 ms
- ok · sale · buyer pays in USDT, released · 17.9 s
- ok · sale · chain agrees, relayer paid every fee · 1.4 s
- ok · buyer holds no gas after paying · 756 ms
- ok · the merchant sees the order · 22 ms
- ok · merchant refunds in one click · 8.3 s
- ok · buyer holds no gas after the refund · 541 ms

**slip-onchain-whitechain**

- ok · the slip agrees with itself · 0 ms
- ok · Released carries the slip hash · 602 ms
- ok · the escrow stores the slip hash · 185 ms
- ok · the genuine slip verifies · 1.7 s
- ok · a tampered slip fails on chain · 1.5 s

**hedera**

- ok · hub up with the Hedera rail · 1.6 s
- ok · seller lists an offer paid on Hedera · 274 ms
- ok · 402 names the Hedera rail · 4 ms
- ok · agent pays with no human step · 6.3 s
- ok · mirror node confirms the transfer · 3.6 s
- ok · spend log entry on HCS · 329 ms
- ok · envelope refuses past its cap, and logs it · 7.2 s
- ok · the spend log is complete for this run · 684 ms

**merchant**

- ok · relay up with the suite's gas wallet · 1.8 s
- ok · merchant server up · 213 ms
- ok · hub up on the Whitechain rail · 498 ms
- ok · merchant publishes whitechain-dev · 278 ms
- ok · sale · envelope approves · 230 ms
- ok · sale · buyer pays in USDT, released · 17.8 s
- ok · sale · chain agrees, relayer paid every fee · 896 ms
- ok · totals match the chain · 25 ms
- ok · partial refund of 0.005 USDT · 8.1 s
- ok · totals move by the refund and nothing else · 1 ms
- ok · the accountant's export · 2 ms
- ok · no token, no refund · 2 ms

**discovery**

- ok · local hub up · 529 ms
- ok · seller publishes use-arc · 269 ms
- ok · local · healthz · 1 ms
- ok · local · offer list · 1 ms
- ok · local · A2A agent card · 6 ms
- ok · local · skills index · 1 ms
- ok · local · OpenAPI · 3 ms
- ok · local · Bazaar list · 4 ms
- ok · local · unpaid call answers 402 · 14 ms
- ok · public · healthz · 432 ms
- ok · public · offer list · 314 ms
- ok · public · A2A agent card · 1.2 s
- ok · public · skills index · 298 ms
- ok · public · OpenAPI · 308 ms
- ok · public · Bazaar list · 299 ms
- ok · public · unpaid call answers 402 · 300 ms

**public-spine**

- ok · the public hub lists a live Arc offer · 297 ms
- ok · envelope approves · 185 ms
- ok · buyer pays through the public hub · 8.3 s
- ok · chain agrees · 1.1 s
- ok · slip verifies with no hub · 1.7 s

**hedera-mcp**

- ok · the public hub lists the Agent Kit MCP offer · 294 ms
- ok · 402 names the Hedera rail · 299 ms
- ok · agent pays, the runner calls the tool · 7.0 s
- ok · mirror node confirms the payment · 351 ms
- ok · spend log entry on HCS · 3.6 s
- ok · the slip binds the MCP call · 781 ms
- ok · the payment settled only after delivery (#321) · 30 ms
- ok · the tool's record matches the slip · 1 ms
- ok · the tool returned an unsigned transfer for the buyer · 8 ms

**erc8004-identity**

- ok · the seller owns its agent id · 731 ms
- ok · the registration file is an ERC-8004 v1 file naming a hub and offers · 376 ms
- ok · the A2A endpoint is this hub's card, and it lists the offer · 302 ms
- ok · every registered offer is the owner's and live on the hub · 295 ms
- ok · the declared wallet is the owner, on the chain the identity lives on · 337 ms

**erc8004-arc**

- ok · the public hub names sellers with ERC-8004 identities · 295 ms
- ok · agent 897802 is owned by its seller and registers this hub and its offers · 347 ms
- ok · agent 897803 is owned by its seller and registers this hub and its offers · 349 ms
- ok · every feedback the reputation registry holds for them is checked, and earned feedback exists · 2.7 s

**mpp**

- ok · demo server up on the mpp rail · 700 ms
- ok · the 402 names Tempo testnet, the price and the recipient, before anything pays · 4 ms
- ok · the named payer pays with the pinned mppx · 5.1 s
- ok · Moderato shows exactly the price moved from the payer to the recipient · 1.4 s
- ok · a credential replayed is refused · 5.0 s

**production-console**

- ok · the console serves its default bundle · 5.8 s
- ok · the default bundle is live, not fixtures · 643 ms

**production-hub**

- ok · the hub has a listed offer and a settlement to read · 889 ms
- ok · production declares only the rails that return money, hedera-scheduled before hedera · 289 ms
- ok · every endpoint a screen calls answers 200, open to the console · 3.3 s

**production-approvals**

- ok · the agent the phone follows · 287 ms
- ok · the approval routes answer a client with no token · 1.1 s
- ok · without the approver's token the routes refuse · 0 ms
- ok · with the approver's token the routes answer · 874 ms
- ok · every approval route answers, open to the console · 289 ms
- ok · the approval decision passes CORS preflight · 291 ms

Artifacts for this run (bodies, logs, slips) stay on the build machine under `e2e/artifacts/20261106-233159-6a7d/`.
