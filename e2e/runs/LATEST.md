<!-- the latest full run; its own file is 20261106-221713-6717.md -->
# e2e run 20261106-221713-6717

| | |
|---|---|
| commit | `b93e5ac` on `cs/e2e` |
| escrow | v2 · `0x10A3c07cc6A519C0106e315D2C42010eCbEFF3CE` |
| started | 2026-11-06 22:17:13 UTC (03:47 IST) |
| duration | 130.3 s |
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
| 5 | `whitechain` | PASS | 27.5 s |  |
| 4b | `slip-onchain-whitechain` | PASS | 4.0 s |  |
| 6 | `hedera` | NOT RUN (retired: plain x402 Hedera was removed from production by flag (project lead, 23:40 IST): it debits before the seller runs and cannot be reversed) |  |  |
| 7 | `merchant` | PASS | 25.4 s |  |
| 8 | `discovery` | PASS | 3.8 s |  |
| 12 | `public-spine` | PASS | 14.8 s |  |
| 15 | `public-hedera` | NOT RUN (retired: plain x402 Hedera was removed from production by flag (project lead, 23:40 IST): it debits before the seller runs and cannot be reversed) |  |  |
| 16 | `public-gateway` | NOT RUN (retired: the Gateway rail was removed from production by flag (project lead, 23:40 IST): it debits before the seller runs and cannot be reversed) |  |  |
| 17 | `hedera-mcp` | NOT RUN (retired: plain x402 Hedera was removed from production by flag (project lead, 23:40 IST): it debits before the seller runs and cannot be reversed. Its Agent Kit offer is paid held in flow 21) |  |  |
| 18 | `erc8004-identity` | PASS | 12.5 s |  |
| 18b | `erc8004-arc` | PASS | 8.6 s |  |
| 19 | `mpp` | PASS | 9.7 s |  |
| 20 | `hedera-schedule` | NOT RUN (on demand: about 0.18 HBAR a run; run it with --flow hedera-schedule) |  |  |
| 21 | `hedera-held` | NOT RUN (on demand: about 0.16 HBAR a run; run it with --flow hedera-held) |  |  |
| 21b | `hedera-held-undelivered` | NOT RUN (on demand: about 0.16 HBAR and 7 minutes a run; run it with --flow hedera-held-undelivered) |  |  |
| 22 | `npm-published` | NOT RUN (on demand: it installs the published packages from npm; run it with --flow npm-published) |  |  |
| 14a | `production-console` | PASS | 6.4 s |  |
| 14b | `production-hub` | PASS | 4.5 s |  |
| 14c | `production-approvals` | PASS | 2.7 s |  |
| 9 | `web` | NOT RUN (cut: screenshot rounds cover it) |  |  |

## Transactions

**arc-wrong-amount**

- fund at twice the signed price (reverted, as expected): [`0x719ac3a4…d84808`](https://explorer.testnet.arc.io/tx/0x719ac3a46ffc30fc01c11076e09d37536c5115eb92879abcd0073aed52d84808)

**whitechain**

- sale fund: [`0x6affd67f…c009ad`](https://explorer.testnet.whitechain.io/tx/0x6affd67f83bb26750b69627e7e5783c48a961b3da4a7a9be1b3e872d33c009ad)
- sale release: [`0x36b800c7…9f31a0`](https://explorer.testnet.whitechain.io/tx/0x36b800c78077cf2fec849b7a181e126cda259c1ba21a5faf7f9569ca159f31a0)
- one-click refund: [`0xb2221673…17b7e7`](https://explorer.testnet.whitechain.io/tx/0xb2221673a89f869079df13f8a0b0801cf2ed730b73645c328c60d2269317b7e7)

**slip-onchain-whitechain**

- release: [`0x36b800c7…9f31a0`](https://explorer.testnet.whitechain.io/tx/0x36b800c78077cf2fec849b7a181e126cda259c1ba21a5faf7f9569ca159f31a0)

**merchant**

- sale fund: [`0xdefd22fb…7f0e83`](https://explorer.testnet.whitechain.io/tx/0xdefd22fb8f5c8ff6537a850a82ff847450a80cdd493722d56b706909977f0e83)
- sale release: [`0x25f88089…999151`](https://explorer.testnet.whitechain.io/tx/0x25f880891f38215f9676ce8183b29fb1d8918ba22edc54953c6122ebd3999151)
- partial refund: [`0x3c4ff406…0afea6`](https://explorer.testnet.whitechain.io/tx/0x3c4ff4064b536da675c7fb56f71eeba77a9edfd9b42edf9c546bdd7cae0afea6)

**public-spine**

- fund (public hub): [`0xfab2ba40…f591ae`](https://explorer.testnet.arc.io/tx/0xfab2ba403ff2778dbbfdc24a30f8dfa74209f7105dc1913ad8db9d01d0f591ae)
- release (public hub): [`0xadf79dcf…bf2d51`](https://explorer.testnet.arc.io/tx/0xadf79dcfea30a36a16cc45bad4d2a18c12c9cc96e6e79d12073eb74141bf2d51)

**erc8004-arc**

- earned feedback for agent 897802: [`0x3af33b85…0d1072`](https://explorer.testnet.arc.io/tx/0x3af33b85a60ab3bea32666b5ea627c56151018e70b7c4d00d8e9bc94600d1072)

**mpp**

- mpp payment: [`0x2b8e6765…f20a40`](https://explore.testnet.tempo.xyz/tx/0x2b8e676557ab001dabdcc81646b5da8b044d0305dd290597d538291bd7f20a40)
- mpp payment (signed credential): [`0xe95c74da…baa835`](https://explore.testnet.tempo.xyz/tx/0xe95c74daee65ec6fb2224dada9fd06972ce1a5e172068ede9325d7f061baa835)

## Notes

- `public-spine`: bought use-arc 0xdd24c0f8 from seller 0x6BE98051B852824A3923E3B27f9781Ceb0C0ca4a
- `erc8004-identity`: agent 158 in 0x8004A818BFB912233c491871b3d84c89A494BD9e on chain 296 is owned by 0xE4eBF122a912BeF5FeC9C56e003FD4Af2CBDB5fE
- `erc8004-arc`: agents: 897802 (0x6BE98051), 897803 (0xA55a31E3)
- `erc8004-arc`: feedback on Arc for these agents: 1, earned 1
- `production-console`: default bundle: index-DUdC6kjO.js, rolldown-runtime-DLMaRju-.js, utils-De7E53Fk.js, chain-RQe9NUAy.js, hmac-DVvFcWUx.js, secp256k1-B8ku9kFS.js, serializeSignature-y6mntGi8.js, ccip-vyHjqwBh.js, _esm-BcVpWSWi.js, src-CeKFEoA6.js, hooks.module-BV8YN2_C.js, index.es-CXUqFyhV.js, index.es-DU8FEXoR.js, browser-ubDSPG6M.js, approver-BCsgmGhU.js, model-O_LlSw2g.js, accounts-AWnGOv8h.js
- `production-console`: fixture markers checked: 89
- `production-hub`: checked 11 endpoints for agent 0xE0625e01b7c79d1E399B55F252e6Bdc820733f48 and seller 0xb7a540EA878Af43Ae0b7e5075d8A38e82c04D1a0
- `production-hub`: the approval routes, /envelopes and /approvals, are checked by production-approvals: they depend on production's approver configuration

## Steps

**runner-restart**

- ok · hub up · 442 ms
- ok · runner serves use-arc · 251 ms
- ok · runner stops, offer goes offline · 4 ms
- ok · runner restarts: same offer, back online · 222 ms

**arc-wrong-amount**

- ok · hub up · 383 ms
- ok · seller publishes use-arc · 258 ms
- ok · 402 challenge · 4 ms
- ok · buyer countersigns the listed price · 4 ms
- ok · hub refuses a moved price · 181 ms
- ok · chain refuses a moved price · 1.7 s
- ok · the signature holds at the signed price · 180 ms

**refusals**

- ok · hub up · 380 ms
- ok · seller publishes use-arc · 250 ms
- ok · the hub's input gate refuses a bad input · 2 ms
- ok · an input the slip cannot hash is refused before any 402 · 5 ms
- ok · the buyer refuses a bad input before signing · 438 ms
- ok · over the budget · 434 ms
- ok · over the per-seller limit · 404 ms
- ok · seller not on the allowlist · 364 ms
- ok · envelope revoked · 366 ms
- ok · held above ask-above until the human approves · 373 ms
- ok · seller offline: refused, nothing charged · 353 ms

**whitechain**

- ok · relay up with the suite's gas wallet · 1.7 s
- ok · merchant server up · 205 ms
- ok · hub up on the Whitechain rail · 347 ms
- ok · merchant publishes whitechain-dev · 240 ms
- ok · buyer holds no gas before paying · 563 ms
- ok · sale · envelope approves · 210 ms
- ok · sale · buyer pays in USDT, released · 13.5 s
- ok · sale · chain agrees, relayer paid every fee · 1.5 s
- ok · buyer holds no gas after paying · 574 ms
- ok · the merchant sees the order · 14 ms
- ok · merchant refunds in one click · 8.0 s
- ok · buyer holds no gas after the refund · 566 ms

**slip-onchain-whitechain**

- ok · the slip agrees with itself · 0 ms
- ok · Released carries the slip hash · 756 ms
- ok · the escrow stores the slip hash · 198 ms
- ok · the genuine slip verifies · 1.7 s
- ok · a tampered slip fails on chain · 1.3 s

**merchant**

- ok · relay up with the suite's gas wallet · 1.7 s
- ok · merchant server up · 213 ms
- ok · hub up on the Whitechain rail · 392 ms
- ok · merchant publishes whitechain-dev · 241 ms
- ok · sale · envelope approves · 176 ms
- ok · sale · buyer pays in USDT, released · 13.7 s
- ok · sale · chain agrees, relayer paid every fee · 963 ms
- ok · totals match the chain · 15 ms
- ok · partial refund of 0.005 USDT · 8.0 s
- ok · totals move by the refund and nothing else · 1 ms
- ok · the accountant's export · 2 ms
- ok · no token, no refund · 2 ms

**discovery**

- ok · local hub up · 458 ms
- ok · seller publishes use-arc · 230 ms
- ok · local · healthz · 0 ms
- ok · local · offer list · 1 ms
- ok · local · A2A agent card · 3 ms
- ok · local · skills index · 1 ms
- ok · local · OpenAPI · 1 ms
- ok · local · Bazaar list · 1 ms
- ok · local · unpaid call answers 402 · 3 ms
- ok · public · healthz · 420 ms
- ok · public · offer list · 298 ms
- ok · public · A2A agent card · 1.2 s
- ok · public · skills index · 301 ms
- ok · public · OpenAPI · 315 ms
- ok · public · Bazaar list · 300 ms
- ok · public · unpaid call answers 402 · 294 ms

**public-spine**

- ok · the public hub lists a live Arc offer · 299 ms
- ok · envelope approves · 190 ms
- ok · buyer pays through the public hub · 11.4 s
- ok · chain agrees · 855 ms
- ok · slip verifies with no hub · 2.1 s

**erc8004-identity**

- ok · the seller owns its agent id · 754 ms
- ok · the registration file is an ERC-8004 v1 file naming a hub and offers · 10.8 s
- ok · the A2A endpoint is this hub's card, and it lists the offer · 314 ms
- ok · every registered offer is the owner's and live on the hub · 318 ms
- ok · the declared wallet is the owner, on the chain the identity lives on · 349 ms

**erc8004-arc**

- ok · the public hub names sellers with ERC-8004 identities · 5.0 s
- ok · agent 897802 is owned by its seller and registers this hub and its offers · 360 ms
- ok · agent 897803 is owned by its seller and registers this hub and its offers · 356 ms
- ok · every feedback the reputation registry holds for them is checked, and earned feedback exists · 2.6 s

**mpp**

- ok · demo server up on the mpp rail · 347 ms
- ok · the 402 names Tempo testnet, the price and the recipient, before anything pays · 4 ms
- ok · the named payer pays with the pinned mppx · 4.6 s
- ok · Moderato shows exactly the price moved from the payer to the recipient · 327 ms
- ok · a credential replayed is refused · 4.4 s

**production-console**

- ok · the console serves its default bundle · 5.8 s
- ok · the default bundle is live, not fixtures · 633 ms

**production-hub**

- ok · the hub has a listed offer and a settlement to read · 930 ms
- ok · production declares exactly the rails that return money · 292 ms
- ok · every endpoint a screen calls answers 200, open to the console · 3.3 s

**production-approvals**

- ok · the agent the phone follows · 312 ms
- ok · the approval routes answer a client with no token · 889 ms
- ok · without the approver's token the routes refuse · 0 ms
- ok · with the approver's token the routes answer · 888 ms
- ok · every approval route answers, open to the console · 301 ms
- ok · the approval decision passes CORS preflight · 296 ms

Artifacts for this run (bodies, logs, slips) stay on the build machine under `e2e/artifacts/20261106-221713-6717/`.
