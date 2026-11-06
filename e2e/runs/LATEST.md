<!-- the latest full run; its own file is 20261106-181701-16c7.md -->
# e2e run 20261106-181701-16c7

| | |
|---|---|
| commit | `2175b7e` on `cs/e2e` |
| started | 2026-11-06 18:17:01 UTC (23:47 IST) |
| duration | 269.9 s |
| scope | full run, every flow |
| result | 17 pass · 1 fail · 0 skipped · 9 not run |

| # | Flow | Status | Time | Failed step |
|---|---|---|---|---|
| 1 | `arc-spine` | PASS | 8.2 s |  |
| 1b | `runner-restart` | PASS | 3.0 s |  |
| 2 | `arc-wrong-amount` | PASS | 3.1 s |  |
| 3 | `arc-deadline-refund` | PASS | 50.4 s |  |
| 4a | `slip-onchain-arc` | PASS | 2.4 s |  |
| 10 | `arc-gateway` | NOT RUN (retired: the Gateway rail was removed from production by flag (captain, 23:40 IST): it debits before the seller runs and cannot be reversed) |  |  |
| 11 | `refusals` | PASS | 3.6 s |  |
| 13 | `ratings` | PASS | 64.9 s |  |
| 5 | `whitechain` | PASS | 32.3 s |  |
| 4b | `slip-onchain-whitechain` | PASS | 5.3 s |  |
| 6 | `hedera` | NOT RUN (retired: plain x402 Hedera was removed from production by flag (captain, 23:40 IST): it debits before the seller runs and cannot be reversed) |  |  |
| 7 | `merchant` | PASS | 28.6 s |  |
| 8 | `discovery` | PASS | 4.0 s |  |
| 12 | `public-spine` | PASS | 14.1 s |  |
| 15 | `public-hedera` | NOT RUN (retired: plain x402 Hedera was removed from production by flag (captain, 23:40 IST): it debits before the seller runs and cannot be reversed) |  |  |
| 16 | `public-gateway` | NOT RUN (retired: the Gateway rail was removed from production by flag (captain, 23:40 IST): it debits before the seller runs and cannot be reversed) |  |  |
| 17 | `hedera-mcp` | NOT RUN (retired: plain x402 Hedera was removed from production by flag (captain, 23:40 IST): it debits before the seller runs and cannot be reversed. Its Agent Kit offer is paid held in flow 21) |  |  |
| 18 | `erc8004-identity` | PASS | 22.4 s |  |
| 18b | `erc8004-arc` | FAIL | 2.0 s | `every feedback the reputation registry holds for them is checked, and earned feedback exists` |
| 19 | `mpp` | PASS | 10.8 s |  |
| 20 | `hedera-schedule` | NOT RUN (on demand: about 0.18 HBAR a run; run it with --flow hedera-schedule) |  |  |
| 21 | `hedera-held` | NOT RUN (on demand: about 0.16 HBAR a run; run it with --flow hedera-held) |  |  |
| 21b | `hedera-held-undelivered` | NOT RUN (on demand: about 0.16 HBAR and 7 minutes a run; run it with --flow hedera-held-undelivered) |  |  |
| 14a | `production-console` | PASS | 6.2 s |  |
| 14b | `production-hub` | PASS | 4.5 s |  |
| 14c | `production-approvals` | PASS | 2.7 s |  |
| 9 | `web` | NOT RUN (cut: screenshot rounds cover it) |  |  |

## Transactions

**arc-spine**

- fund: [`0x10270dfc…ef3477`](https://explorer.testnet.arc.io/tx/0x10270dfcd7a01931f8f82075043a4ac2b6bf6b8ec60d091f7bfb90fc9fef3477)
- release: [`0x358d5199…02209f`](https://explorer.testnet.arc.io/tx/0x358d5199f5e635243d0b367a847a8d098595e31e28e0d38a913e646c2302209f)

**arc-wrong-amount**

- fund at twice the signed price (reverted, as expected): [`0x31b3cdb7…c96ed0`](https://explorer.testnet.arc.io/tx/0x31b3cdb7a5977908bb7a5acb0fbc6c1c389e8306a95a948c921540ab06c96ed0)

**arc-deadline-refund**

- fund: [`0x976e6d50…f13c76`](https://explorer.testnet.arc.io/tx/0x976e6d50a126fa17113d555aebdf4ae7e23ccd15f93dc59c02734f3507f13c76)
- refund by a stranger: [`0x3748f757…8f1af1`](https://explorer.testnet.arc.io/tx/0x3748f757e0546b935d2eec53418c7143a1db73f5c7a001f66dd029ad3f8f1af1)

**slip-onchain-arc**

- release: [`0x358d5199…02209f`](https://explorer.testnet.arc.io/tx/0x358d5199f5e635243d0b367a847a8d098595e31e28e0d38a913e646c2302209f)

**ratings**

- refund by the hub's janitor: [`0x4bd4ecf0…a3849c`](https://explorer.testnet.arc.io/tx/0x4bd4ecf0f1ff5c160b968c0ecc972ce529309ef00d6e39cb16f099da3da3849c)

**whitechain**

- sale fund: [`0x93304d32…0e48dc`](https://explorer.testnet.whitechain.io/tx/0x93304d3297de57511397e1a94ef4819335980eee2e0fe9df28a9157c600e48dc)
- sale release: [`0xca8ec992…fda053`](https://explorer.testnet.whitechain.io/tx/0xca8ec9920b22d5c20fbcea8a72de50b3516055943dc19bc2c67746fcfdfda053)
- one-click refund: [`0x04c015b1…9b2164`](https://explorer.testnet.whitechain.io/tx/0x04c015b1fe59e65894ad97ca5f91806c6e96d5edfb40a5b56323fa2ff69b2164)

**slip-onchain-whitechain**

- release: [`0xca8ec992…fda053`](https://explorer.testnet.whitechain.io/tx/0xca8ec9920b22d5c20fbcea8a72de50b3516055943dc19bc2c67746fcfdfda053)

**merchant**

- sale fund: [`0x4eaf5903…78df7a`](https://explorer.testnet.whitechain.io/tx/0x4eaf590325aa413e6e3b42ea8dfb98732f07ead3468ab292498c148b8478df7a)
- sale release: [`0x84e25180…2db90d`](https://explorer.testnet.whitechain.io/tx/0x84e25180660c333a9ae94ac9c09a8c5020584e4884347ccd179dbbb7dd2db90d)
- partial refund: [`0x20aa1c84…16d9cc`](https://explorer.testnet.whitechain.io/tx/0x20aa1c84052135fe9e673c62ae344cd9a96bc9f9483875b11e901b509916d9cc)

**public-spine**

- fund (public hub): [`0xbbd9a467…bb7aa3`](https://explorer.testnet.arc.io/tx/0xbbd9a467a8e5839ff25dd87932359470a5feeae128ea41bb5932f55d09bb7aa3)
- release (public hub): [`0x3ce0d434…a67e1e`](https://explorer.testnet.arc.io/tx/0x3ce0d4341797435ded37b5ad6e9b437404e590033def483b3dd902dc65a67e1e)

**mpp**

- mpp payment: [`0x80d3e502…6e55f2`](https://explore.testnet.tempo.xyz/tx/0x80d3e502823ee569c23f1e4068b44f614d4a318138a3a2324f1b5f7f5a6e55f2)
- mpp payment (signed credential): [`0xb41d6309…308cb6`](https://explore.testnet.tempo.xyz/tx/0xb41d6309900a2007b7fb730f497b9d86fc77ae4a5fade8b813b881b190308cb6)

## Failures

**erc8004-arc** · step `every feedback the reputation registry holds for them is checked, and earned feedback exists` · owner orch-cs

> no earned feedback for agents 897803 since block 71029600

## Notes

- `public-spine`: bought use-arc 0xdd24c0f8 from seller 0x6BE98051B852824A3923E3B27f9781Ceb0C0ca4a
- `erc8004-identity`: agent 158 in 0x8004A818BFB912233c491871b3d84c89A494BD9e on chain 296 is owned by 0xE4eBF122a912BeF5FeC9C56e003FD4Af2CBDB5fE
- `erc8004-arc`: agents: 897803 (0xA55a31E3)
- `erc8004-arc`: feedback on Arc for these agents: 0, earned 0
- `production-console`: default bundle: index-JG2mNQ3H.js, rolldown-runtime-DLMaRju-.js, utils-De7E53Fk.js, chain-RQe9NUAy.js, hmac-DVvFcWUx.js, secp256k1-B8ku9kFS.js, serializeSignature-y6mntGi8.js, ccip-vyHjqwBh.js, _esm-DeIESQQN.js, src-RTyVsmjM.js, hooks.module-JBIue0DG.js, approver-B8R4hi2q.js, model-CaoI6Rsn.js, index.es-CXUqFyhV.js, index.es-DU8FEXoR.js, browser-ubDSPG6M.js
- `production-console`: fixture markers checked: 89
- `production-hub`: checked 11 endpoints for agent 0xE0625e01b7c79d1E399B55F252e6Bdc820733f48 and seller 0x6BE98051B852824A3923E3B27f9781Ceb0C0ca4a
- `production-hub`: the approval routes, /envelopes and /approvals, are checked by production-approvals: they depend on production's approver configuration

## Steps

**arc-spine**

- ok · hub up · 530 ms
- ok · seller publishes use-arc · 415 ms
- ok · buyer discovers · 189 ms
- ok · envelope approves · 183 ms
- ok · seller balance before · 212 ms
- ok · countersign, fund, deliver, release · 3.6 s
- ok · hub job record · 1 ms
- ok · chain agrees · 1.1 s
- ok · slip names its rail · 911 ms
- ok · hub stopped · 7 ms
- ok · verifier VALID with the hub stopped · 1.0 s

**runner-restart**

- ok · hub up · 584 ms
- ok · runner serves use-arc · 339 ms
- ok · runner stops, offer goes offline · 4 ms
- ok · runner restarts: same offer, back online · 561 ms

**arc-wrong-amount**

- ok · hub up · 740 ms
- ok · seller publishes use-arc · 338 ms
- ok · 402 challenge · 6 ms
- ok · buyer countersigns the listed price · 5 ms
- ok · hub refuses a moved price · 183 ms
- ok · chain refuses a moved price · 1.7 s
- ok · the signature holds at the signed price · 187 ms

**arc-deadline-refund**

- ok · hub up · 992 ms
- ok · seller publishes use-arc with a 45 s deadline · 406 ms
- ok · envelope approves · 276 ms
- ok · buyer pays, seller cannot deliver · 2.5 s
- ok · escrow holds the money · 365 ms
- ok · hub stopped · 6 ms
- ok · a refund before the deadline is refused · 366 ms
- ok · chain passes the deadline · 44.0 s
- ok · a stranger refunds · 1.3 s
- ok · the refund is final · 192 ms

**slip-onchain-arc**

- ok · the slip agrees with itself · 0 ms
- ok · Released carries the slip hash · 364 ms
- ok · the escrow stores the slip hash · 175 ms
- ok · the genuine slip verifies · 1.0 s
- ok · a tampered slip fails on chain · 783 ms

**refusals**

- ok · hub up · 510 ms
- ok · seller publishes use-arc · 325 ms
- ok · the hub's input gate refuses a bad input · 2 ms
- ok · an input the slip cannot hash is refused before any 402 · 6 ms
- ok · the buyer refuses a bad input before signing · 407 ms
- ok · over the budget · 402 ms
- ok · over the per-seller limit · 405 ms
- ok · seller not on the allowlist · 386 ms
- ok · envelope revoked · 393 ms
- ok · held above ask-above until the human approves · 395 ms
- ok · seller offline: refused, nothing charged · 364 ms

**ratings**

- ok · hub up · 420 ms
- ok · seller publishes use-arc with a 45 s deadline · 305 ms
- ok · a buyer's call is delivered · 3.8 s
- ok · the seller buys from itself · 3.4 s
- ok · a buyer's call fails delivery · 2.3 s
- ok · the seller's rating counts what the slips prove · 4 ms
- ok · hub stats agree · 0 ms
- ok · the hub's janitor refunds the failed call after its deadline · 54.6 s
- ok · the rating follows the refund · 1 ms

**whitechain**

- ok · relay up with the suite's gas wallet · 1.2 s
- ok · merchant server up · 184 ms
- ok · hub up on the Whitechain rail · 428 ms
- ok · merchant publishes whitechain-dev · 319 ms
- ok · buyer holds no gas before paying · 936 ms
- ok · sale · envelope approves · 200 ms
- ok · sale · buyer pays in USDT, released · 17.4 s
- ok · sale · chain agrees, relayer paid every fee · 1.5 s
- ok · buyer holds no gas after paying · 559 ms
- ok · the merchant sees the order · 8 ms
- ok · merchant refunds in one click · 8.2 s
- ok · buyer holds no gas after the refund · 1.3 s

**slip-onchain-whitechain**

- ok · the slip agrees with itself · 0 ms
- ok · Released carries the slip hash · 1.4 s
- ok · the escrow stores the slip hash · 193 ms
- ok · the genuine slip verifies · 2.1 s
- ok · a tampered slip fails on chain · 1.5 s

**merchant**

- ok · relay up with the suite's gas wallet · 1.2 s
- ok · merchant server up · 198 ms
- ok · hub up on the Whitechain rail · 469 ms
- ok · merchant publishes whitechain-dev · 328 ms
- ok · sale · envelope approves · 187 ms
- ok · sale · buyer pays in USDT, released · 17.1 s
- ok · sale · chain agrees, relayer paid every fee · 934 ms
- ok · totals match the chain · 31 ms
- ok · partial refund of 0.005 USDT · 8.1 s
- ok · totals move by the refund and nothing else · 2 ms
- ok · the accountant's export · 2 ms
- ok · no token, no refund · 2 ms

**discovery**

- ok · local hub up · 423 ms
- ok · seller publishes use-arc · 266 ms
- ok · local · healthz · 1 ms
- ok · local · offer list · 1 ms
- ok · local · A2A agent card · 5 ms
- ok · local · skills index · 1 ms
- ok · local · OpenAPI · 1 ms
- ok · local · Bazaar list · 1 ms
- ok · local · unpaid call answers 402 · 3 ms
- ok · public · healthz · 487 ms
- ok · public · offer list · 297 ms
- ok · public · A2A agent card · 1.2 s
- ok · public · skills index · 300 ms
- ok · public · OpenAPI · 319 ms
- ok · public · Bazaar list · 374 ms
- ok · public · unpaid call answers 402 · 293 ms

**public-spine**

- ok · the public hub lists a live Arc offer · 296 ms
- ok · envelope approves · 177 ms
- ok · buyer pays through the public hub · 11.1 s
- ok · chain agrees · 893 ms
- ok · slip verifies with no hub · 1.6 s

**erc8004-identity**

- ok · the seller owns its agent id · 11.2 s
- ok · the registration file is an ERC-8004 v1 file naming a hub and offers · 8.8 s
- ok · the A2A endpoint is this hub's card, and it lists the offer · 300 ms
- ok · every registered offer is the owner's and live on the hub · 320 ms
- ok · the declared wallet is the owner, on the chain the identity lives on · 1.8 s

**erc8004-arc**

- ok · the public hub names sellers with ERC-8004 identities · 343 ms
- ok · agent 897803 is owned by its seller and registers this hub and its offers · 363 ms
- FAIL · every feedback the reputation registry holds for them is checked, and earned feedback exists · 955 ms · no earned feedback for agents 897803 since block 71029600

**mpp**

- ok · demo server up on the mpp rail · 398 ms
- ok · the 402 names Tempo testnet, the price and the recipient, before anything pays · 8 ms
- ok · the named payer pays with the pinned mppx · 4.9 s
- ok · Moderato shows exactly the price moved from the payer to the recipient · 331 ms
- ok · a credential replayed is refused · 5.1 s

**production-console**

- ok · the console serves its default bundle · 5.6 s
- ok · the default bundle is live, not fixtures · 592 ms

**production-hub**

- ok · the hub has a listed offer and a settlement to read · 914 ms
- ok · production declares exactly the rails that return money · 299 ms
- ok · every endpoint a screen calls answers 200, open to the console · 3.3 s

**production-approvals**

- ok · the agent the phone follows · 302 ms
- ok · the approval routes answer a client with no token · 897 ms
- ok · without the approver's token the routes refuse · 0 ms
- ok · with the approver's token the routes answer · 910 ms
- ok · every approval route answers, open to the console · 301 ms
- ok · the approval decision passes CORS preflight · 289 ms

Artifacts for this run (bodies, logs, slips) stay on the build machine under `e2e/artifacts/20261106-181701-16c7/`.
