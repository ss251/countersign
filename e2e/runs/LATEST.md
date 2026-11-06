<!-- the latest full run; its own file is 20261106-193656-ac7d.md -->
# e2e run 20261106-193656-ac7d

| | |
|---|---|
| commit | `25e8104` on `main` |
| started | 2026-11-06 19:36:56 UTC (01:06 IST) |
| duration | 254.3 s |
| scope | full run, every flow |
| result | 18 pass · 0 fail · 0 skipped · 9 not run |

| # | Flow | Status | Time | Failed step |
|---|---|---|---|---|
| 1 | `arc-spine` | PASS | 11.5 s |  |
| 1b | `runner-restart` | PASS | 2.4 s |  |
| 2 | `arc-wrong-amount` | PASS | 2.7 s |  |
| 3 | `arc-deadline-refund` | PASS | 49.5 s |  |
| 4a | `slip-onchain-arc` | PASS | 2.4 s |  |
| 10 | `arc-gateway` | NOT RUN (retired: the Gateway rail was removed from production by flag (captain, 23:40 IST): it debits before the seller runs and cannot be reversed) |  |  |
| 11 | `refusals` | PASS | 3.8 s |  |
| 13 | `ratings` | PASS | 63.7 s |  |
| 5 | `whitechain` | PASS | 28.6 s |  |
| 4b | `slip-onchain-whitechain` | PASS | 3.7 s |  |
| 6 | `hedera` | NOT RUN (retired: plain x402 Hedera was removed from production by flag (captain, 23:40 IST): it debits before the seller runs and cannot be reversed) |  |  |
| 7 | `merchant` | PASS | 28.2 s |  |
| 8 | `discovery` | PASS | 4.0 s |  |
| 12 | `public-spine` | PASS | 7.3 s |  |
| 15 | `public-hedera` | NOT RUN (retired: plain x402 Hedera was removed from production by flag (captain, 23:40 IST): it debits before the seller runs and cannot be reversed) |  |  |
| 16 | `public-gateway` | NOT RUN (retired: the Gateway rail was removed from production by flag (captain, 23:40 IST): it debits before the seller runs and cannot be reversed) |  |  |
| 17 | `hedera-mcp` | NOT RUN (retired: plain x402 Hedera was removed from production by flag (captain, 23:40 IST): it debits before the seller runs and cannot be reversed. Its Agent Kit offer is paid held in flow 21) |  |  |
| 18 | `erc8004-identity` | PASS | 11.4 s |  |
| 18b | `erc8004-arc` | PASS | 9.1 s |  |
| 19 | `mpp` | PASS | 10.5 s |  |
| 20 | `hedera-schedule` | NOT RUN (on demand: about 0.18 HBAR a run; run it with --flow hedera-schedule) |  |  |
| 21 | `hedera-held` | NOT RUN (on demand: about 0.16 HBAR a run; run it with --flow hedera-held) |  |  |
| 21b | `hedera-held-undelivered` | NOT RUN (on demand: about 0.16 HBAR and 7 minutes a run; run it with --flow hedera-held-undelivered) |  |  |
| 14a | `production-console` | PASS | 6.6 s |  |
| 14b | `production-hub` | PASS | 4.5 s |  |
| 14c | `production-approvals` | PASS | 2.7 s |  |
| 9 | `web` | NOT RUN (cut: screenshot rounds cover it) |  |  |

## Transactions

**arc-spine**

- fund: [`0xdcd6b986…765833`](https://explorer.testnet.arc.io/tx/0xdcd6b9869cd6b0de2249db922b52c0d0e60f4eaf7034af12fa4cdc60a0765833)
- release: [`0x60fe669b…13e7fa`](https://explorer.testnet.arc.io/tx/0x60fe669b7437cf23a89ee9665f9c6ac0d5d6c6bf9d2a14113ff3f0f7bb13e7fa)

**arc-wrong-amount**

- fund at twice the signed price (reverted, as expected): [`0xfad8df95…3920a0`](https://explorer.testnet.arc.io/tx/0xfad8df959820437aa1fd5c114ee8aa12669b1fae14709067e0e30c295e3920a0)

**arc-deadline-refund**

- fund: [`0x1e694e61…40d7cc`](https://explorer.testnet.arc.io/tx/0x1e694e612b5837e1d4896d32867ac491db87747df7b0193066f7fd984540d7cc)
- refund by a stranger: [`0x7924e59b…715bfc`](https://explorer.testnet.arc.io/tx/0x7924e59bf182b0f3fb93206e6a1d939b488c4af175acb3ad6dbb72338f715bfc)

**slip-onchain-arc**

- release: [`0x60fe669b…13e7fa`](https://explorer.testnet.arc.io/tx/0x60fe669b7437cf23a89ee9665f9c6ac0d5d6c6bf9d2a14113ff3f0f7bb13e7fa)

**ratings**

- refund by the hub's janitor: [`0xb6dbccca…ca4aa7`](https://explorer.testnet.arc.io/tx/0xb6dbccca20a8e277bd071ce1ef8725d08b24219462c29b2262a85a3db1ca4aa7)

**whitechain**

- sale fund: [`0x1c54432d…47da63`](https://explorer.testnet.whitechain.io/tx/0x1c54432dc4450b19b46f842cbed0d22e2880fd8bcfacb1d23976106bb847da63)
- sale release: [`0xbdcecec7…ec8661`](https://explorer.testnet.whitechain.io/tx/0xbdcecec732619884ab06cb8facd9b6b1564a1f8f919bc22e6cb32604b6ec8661)
- one-click refund: [`0xcdce2bb6…e7ed84`](https://explorer.testnet.whitechain.io/tx/0xcdce2bb65681e36688f5a903865fbd6019eef9e6a00b27dae392278f79e7ed84)

**slip-onchain-whitechain**

- release: [`0xbdcecec7…ec8661`](https://explorer.testnet.whitechain.io/tx/0xbdcecec732619884ab06cb8facd9b6b1564a1f8f919bc22e6cb32604b6ec8661)

**merchant**

- sale fund: [`0xa5b8b886…212a81`](https://explorer.testnet.whitechain.io/tx/0xa5b8b886ee999772b49a5bb1b85c3f4ec8afe1d15cca02e04868deeb3d212a81)
- sale release: [`0x4f37018b…379f5b`](https://explorer.testnet.whitechain.io/tx/0x4f37018b0a02d1b2e39a8804338b2b9abbd8bcca2892bac9843efbda3d379f5b)
- partial refund: [`0xaa3ab48b…29a84e`](https://explorer.testnet.whitechain.io/tx/0xaa3ab48b99090da83b6170e39252eea8406fb301b1a6f237410909f9e929a84e)

**public-spine**

- fund (public hub): [`0x4afdcf99…500438`](https://explorer.testnet.arc.io/tx/0x4afdcf994672c5f96fad709893ab8a8446b575ef3f74e429f76f80b7b2500438)
- release (public hub): [`0xb717cf89…375d17`](https://explorer.testnet.arc.io/tx/0xb717cf8925e4232878704c8344ecbb1462750b5b2c5cb85088f33bc78c375d17)

**erc8004-arc**

- earned feedback for agent 897802: [`0x3af33b85…0d1072`](https://explorer.testnet.arc.io/tx/0x3af33b85a60ab3bea32666b5ea627c56151018e70b7c4d00d8e9bc94600d1072)

**mpp**

- mpp payment: [`0xf71ffb7c…d8e1d2`](https://explore.testnet.tempo.xyz/tx/0xf71ffb7cc3acd887179cfd980d460f21a82b3cdadc71f43fd27f6ea145d8e1d2)
- mpp payment (signed credential): [`0x9fc3f183…b6237e`](https://explore.testnet.tempo.xyz/tx/0x9fc3f183c29b0f70bd9b7ec77a6b6cb9efe8a55db340b5433746f8f4f1b6237e)

## Notes

- `public-spine`: bought use-arc 0xdd24c0f8 from seller 0x6BE98051B852824A3923E3B27f9781Ceb0C0ca4a
- `erc8004-identity`: agent 158 in 0x8004A818BFB912233c491871b3d84c89A494BD9e on chain 296 is owned by 0xE4eBF122a912BeF5FeC9C56e003FD4Af2CBDB5fE
- `erc8004-arc`: agents: 897802 (0x6BE98051), 897803 (0xA55a31E3)
- `erc8004-arc`: feedback on Arc for these agents: 1, earned 1
- `production-console`: default bundle: index-DLWgArfV.js, rolldown-runtime-DLMaRju-.js, utils-De7E53Fk.js, chain-RQe9NUAy.js, hmac-DVvFcWUx.js, secp256k1-B8ku9kFS.js, serializeSignature-y6mntGi8.js, ccip-vyHjqwBh.js, _esm-DeIESQQN.js, src-RTyVsmjM.js, hooks.module-JBIue0DG.js, approver-B8R4hi2q.js, model-CaoI6Rsn.js, index.es-CXUqFyhV.js, index.es-DU8FEXoR.js, browser-ubDSPG6M.js
- `production-console`: fixture markers checked: 89
- `production-hub`: checked 11 endpoints for agent 0xE0625e01b7c79d1E399B55F252e6Bdc820733f48 and seller 0xb7a540EA878Af43Ae0b7e5075d8A38e82c04D1a0
- `production-hub`: the approval routes, /envelopes and /approvals, are checked by production-approvals: they depend on production's approver configuration

## Steps

**arc-spine**

- ok · hub up · 409 ms
- ok · seller publishes use-arc · 333 ms
- ok · buyer discovers · 177 ms
- ok · envelope approves · 184 ms
- ok · seller balance before · 186 ms
- ok · countersign, fund, deliver, release · 7.4 s
- ok · hub job record · 1 ms
- ok · chain agrees · 1.1 s
- ok · slip names its rail · 720 ms
- ok · hub stopped · 7 ms
- ok · verifier VALID with the hub stopped · 1.0 s

**runner-restart**

- ok · hub up · 383 ms
- ok · runner serves use-arc · 253 ms
- ok · runner stops, offer goes offline · 4 ms
- ok · runner restarts: same offer, back online · 239 ms

**arc-wrong-amount**

- ok · hub up · 360 ms
- ok · seller publishes use-arc · 250 ms
- ok · 402 challenge · 4 ms
- ok · buyer countersigns the listed price · 4 ms
- ok · hub refuses a moved price · 182 ms
- ok · chain refuses a moved price · 1.7 s
- ok · the signature holds at the signed price · 185 ms

**arc-deadline-refund**

- ok · hub up · 399 ms
- ok · seller publishes use-arc with a 45 s deadline · 264 ms
- ok · envelope approves · 177 ms
- ok · buyer pays, seller cannot deliver · 6.6 s
- ok · escrow holds the money · 387 ms
- ok · hub stopped · 17 ms
- ok · a refund before the deadline is refused · 354 ms
- ok · chain passes the deadline · 39.9 s
- ok · a stranger refunds · 1.3 s
- ok · the refund is final · 183 ms

**slip-onchain-arc**

- ok · the slip agrees with itself · 0 ms
- ok · Released carries the slip hash · 363 ms
- ok · the escrow stores the slip hash · 186 ms
- ok · the genuine slip verifies · 1.0 s
- ok · a tampered slip fails on chain · 837 ms

**refusals**

- ok · hub up · 474 ms
- ok · seller publishes use-arc · 306 ms
- ok · the hub's input gate refuses a bad input · 2 ms
- ok · an input the slip cannot hash is refused before any 402 · 5 ms
- ok · the buyer refuses a bad input before signing · 470 ms
- ok · over the budget · 470 ms
- ok · over the per-seller limit · 411 ms
- ok · seller not on the allowlist · 392 ms
- ok · envelope revoked · 392 ms
- ok · held above ask-above until the human approves · 449 ms
- ok · seller offline: refused, nothing charged · 380 ms

**ratings**

- ok · hub up · 401 ms
- ok · seller publishes use-arc with a 45 s deadline · 272 ms
- ok · a buyer's call is delivered · 3.8 s
- ok · the seller buys from itself · 3.3 s
- ok · a buyer's call fails delivery · 6.5 s
- ok · the seller's rating counts what the slips prove · 4 ms
- ok · hub stats agree · 0 ms
- ok · the hub's janitor refunds the failed call after its deadline · 49.5 s
- ok · the rating follows the refund · 2 ms

**whitechain**

- ok · relay up with the suite's gas wallet · 1.8 s
- ok · merchant server up · 184 ms
- ok · hub up on the Whitechain rail · 437 ms
- ok · merchant publishes whitechain-dev · 301 ms
- ok · buyer holds no gas before paying · 1.1 s
- ok · sale · envelope approves · 183 ms
- ok · sale · buyer pays in USDT, released · 13.8 s
- ok · sale · chain agrees, relayer paid every fee · 1.5 s
- ok · buyer holds no gas after paying · 558 ms
- ok · the merchant sees the order · 8 ms
- ok · merchant refunds in one click · 8.2 s
- ok · buyer holds no gas after the refund · 601 ms

**slip-onchain-whitechain**

- ok · the slip agrees with itself · 0 ms
- ok · Released carries the slip hash · 593 ms
- ok · the escrow stores the slip hash · 193 ms
- ok · the genuine slip verifies · 1.6 s
- ok · a tampered slip fails on chain · 1.3 s

**merchant**

- ok · relay up with the suite's gas wallet · 1.7 s
- ok · merchant server up · 181 ms
- ok · hub up on the Whitechain rail · 400 ms
- ok · merchant publishes whitechain-dev · 310 ms
- ok · sale · envelope approves · 169 ms
- ok · sale · buyer pays in USDT, released · 16.0 s
- ok · sale · chain agrees, relayer paid every fee · 928 ms
- ok · totals match the chain · 18 ms
- ok · partial refund of 0.005 USDT · 8.4 s
- ok · totals move by the refund and nothing else · 1 ms
- ok · the accountant's export · 2 ms
- ok · no token, no refund · 1 ms

**discovery**

- ok · local hub up · 386 ms
- ok · seller publishes use-arc · 280 ms
- ok · local · healthz · 2 ms
- ok · local · offer list · 1 ms
- ok · local · A2A agent card · 3 ms
- ok · local · skills index · 1 ms
- ok · local · OpenAPI · 1 ms
- ok · local · Bazaar list · 1 ms
- ok · local · unpaid call answers 402 · 3 ms
- ok · public · healthz · 429 ms
- ok · public · offer list · 315 ms
- ok · public · A2A agent card · 1.2 s
- ok · public · skills index · 321 ms
- ok · public · OpenAPI · 439 ms
- ok · public · Bazaar list · 314 ms
- ok · public · unpaid call answers 402 · 302 ms

**public-spine**

- ok · the public hub lists a live Arc offer · 315 ms
- ok · envelope approves · 192 ms
- ok · buyer pays through the public hub · 4.2 s
- ok · chain agrees · 881 ms
- ok · slip verifies with no hub · 1.7 s

**erc8004-identity**

- ok · the seller owns its agent id · 770 ms
- ok · the registration file is an ERC-8004 v1 file naming a hub and offers · 476 ms
- ok · the A2A endpoint is this hub's card, and it lists the offer · 303 ms
- ok · every registered offer is the owner's and live on the hub · 294 ms
- ok · the declared wallet is the owner, on the chain the identity lives on · 9.6 s

**erc8004-arc**

- ok · the public hub names sellers with ERC-8004 identities · 5.8 s
- ok · agent 897802 is owned by its seller and registers this hub and its offers · 365 ms
- ok · agent 897803 is owned by its seller and registers this hub and its offers · 367 ms
- ok · every feedback the reputation registry holds for them is checked, and earned feedback exists · 2.3 s

**mpp**

- ok · demo server up on the mpp rail · 329 ms
- ok · the 402 names Tempo testnet, the price and the recipient, before anything pays · 4 ms
- ok · the named payer pays with the pinned mppx · 5.4 s
- ok · Moderato shows exactly the price moved from the payer to the recipient · 306 ms
- ok · a credential replayed is refused · 4.4 s

**production-console**

- ok · the console serves its default bundle · 5.9 s
- ok · the default bundle is live, not fixtures · 634 ms

**production-hub**

- ok · the hub has a listed offer and a settlement to read · 905 ms
- ok · production declares exactly the rails that return money · 300 ms
- ok · every endpoint a screen calls answers 200, open to the console · 3.3 s

**production-approvals**

- ok · the agent the phone follows · 323 ms
- ok · the approval routes answer a client with no token · 896 ms
- ok · without the approver's token the routes refuse · 0 ms
- ok · with the approver's token the routes answer · 890 ms
- ok · every approval route answers, open to the console · 293 ms
- ok · the approval decision passes CORS preflight · 300 ms

Artifacts for this run (bodies, logs, slips) stay on the build machine under `e2e/artifacts/20261106-193656-ac7d/`.
