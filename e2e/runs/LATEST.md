<!-- the latest full run; its own file is 20261106-172911-a2ff.md -->
# e2e run 20261106-172911-a2ff

| | |
|---|---|
| commit | `7cc8318` on `cs/e2e` |
| started | 2026-11-06 17:29:11 UTC (22:59 IST) |
| duration | 441.2 s |
| scope | full run, every flow |
| result | 17 pass · 1 fail · 0 skipped · 9 not run |

| # | Flow | Status | Time | Failed step |
|---|---|---|---|---|
| 1 | `arc-spine` | PASS | 7.8 s |  |
| 1b | `runner-restart` | PASS | 2.7 s |  |
| 2 | `arc-wrong-amount` | PASS | 4.4 s |  |
| 3 | `arc-deadline-refund` | PASS | 48.5 s |  |
| 4a | `slip-onchain-arc` | PASS | 2.4 s |  |
| 10 | `arc-gateway` | NOT RUN (retired: the Gateway rail was removed from production by flag (captain, 23:40 IST): it debits before the seller runs and cannot be reversed) |  |  |
| 11 | `refusals` | PASS | 3.4 s |  |
| 13 | `ratings` | PASS | 64.6 s |  |
| 5 | `whitechain` | PASS | 32.0 s |  |
| 4b | `slip-onchain-whitechain` | PASS | 3.9 s |  |
| 6 | `hedera` | NOT RUN (retired: plain x402 Hedera was removed from production by flag (captain, 23:40 IST): it debits before the seller runs and cannot be reversed) |  |  |
| 7 | `merchant` | PASS | 27.5 s |  |
| 8 | `discovery` | PASS | 4.8 s |  |
| 12 | `public-spine` | PASS | 10.6 s |  |
| 15 | `public-hedera` | NOT RUN (retired: plain x402 Hedera was removed from production by flag (captain, 23:40 IST): it debits before the seller runs and cannot be reversed) |  |  |
| 16 | `public-gateway` | NOT RUN (retired: the Gateway rail was removed from production by flag (captain, 23:40 IST): it debits before the seller runs and cannot be reversed) |  |  |
| 17 | `hedera-mcp` | NOT RUN (retired: plain x402 Hedera was removed from production by flag (captain, 23:40 IST): it debits before the seller runs and cannot be reversed. Its Agent Kit offer is paid held in flow 21) |  |  |
| 18 | `erc8004-identity` | FAIL | 196.1 s | `the registration file is an ERC-8004 v1 file naming a hub and offers` |
| 18b | `erc8004-arc` | PASS | 7.2 s |  |
| 19 | `mpp` | PASS | 12.4 s |  |
| 20 | `hedera-schedule` | NOT RUN (on demand: about 0.18 HBAR a run; run it with --flow hedera-schedule) |  |  |
| 21 | `hedera-held` | NOT RUN (on demand: about 0.16 HBAR a run; run it with --flow hedera-held) |  |  |
| 21b | `hedera-held-undelivered` | NOT RUN (on demand: about 0.16 HBAR and 7 minutes a run; run it with --flow hedera-held-undelivered) |  |  |
| 14a | `production-console` | PASS | 4.5 s |  |
| 14b | `production-hub` | PASS | 4.6 s |  |
| 14c | `production-approvals` | PASS | 2.6 s |  |
| 9 | `web` | NOT RUN (cut: screenshot rounds cover it) |  |  |

## Transactions

**arc-spine**

- fund: [`0x9c8f5178…a8d842`](https://explorer.testnet.arc.io/tx/0x9c8f5178dad70031aee1b5479332719eb5f81556719cadad9f636a8e5da8d842)
- release: [`0x8c477371…be7378`](https://explorer.testnet.arc.io/tx/0x8c47737186df39873936d537cdc78498fcd9a2d76272cdd81ad0088fb2be7378)

**arc-wrong-amount**

- fund at twice the signed price (reverted, as expected): [`0xe1c68fb2…f84393`](https://explorer.testnet.arc.io/tx/0xe1c68fb2c23328a605414944eb6f77529aeee3b0aaab7cb24d2b8c7b06f84393)

**arc-deadline-refund**

- fund: [`0xf1e0c50b…dcc822`](https://explorer.testnet.arc.io/tx/0xf1e0c50be98267367892c0d36116e40f9750c6906e59963cb6d67dc508dcc822)
- refund by a stranger: [`0x9e55e183…e2ba1f`](https://explorer.testnet.arc.io/tx/0x9e55e1839481af206efde6a71556a998470ce0ed76cede803cde34269fe2ba1f)

**slip-onchain-arc**

- release: [`0x8c477371…be7378`](https://explorer.testnet.arc.io/tx/0x8c47737186df39873936d537cdc78498fcd9a2d76272cdd81ad0088fb2be7378)

**ratings**

- refund by the hub's janitor: [`0xc37bc970…27477f`](https://explorer.testnet.arc.io/tx/0xc37bc970f936d3c394e7055da511120df953c38c2a7a4b9e13f48282ba27477f)

**whitechain**

- sale fund: [`0x7a263fe4…479b1b`](https://explorer.testnet.whitechain.io/tx/0x7a263fe4e77d654307ef04750c6f60d86758a4b48b2e9097a099aac576479b1b)
- sale release: [`0xd94a63fd…e8923b`](https://explorer.testnet.whitechain.io/tx/0xd94a63fd2c196e1de78808ec71b5b551aa6388cac2069042d6017e816fe8923b)
- one-click refund: [`0x45ab05a2…14eaff`](https://explorer.testnet.whitechain.io/tx/0x45ab05a25c3b789f10b55744929e9a61df225758cad3f82a116e61352114eaff)

**slip-onchain-whitechain**

- release: [`0xd94a63fd…e8923b`](https://explorer.testnet.whitechain.io/tx/0xd94a63fd2c196e1de78808ec71b5b551aa6388cac2069042d6017e816fe8923b)

**merchant**

- sale fund: [`0xd027fe5f…166766`](https://explorer.testnet.whitechain.io/tx/0xd027fe5fb9e6e1f2c64366ebfdac0abd15e23d574358e9d2c04742f803166766)
- sale release: [`0x8c2b533a…8ad656`](https://explorer.testnet.whitechain.io/tx/0x8c2b533af06b8cf55965c8f443312979085fe962bfada8f53a4e572a1f8ad656)
- partial refund: [`0xb41f5494…44b733`](https://explorer.testnet.whitechain.io/tx/0xb41f5494cd351bf01c31311dd84b2d044005fff60d1ca3a207bf8b6b7444b733)

**public-spine**

- fund (public hub): [`0x455a3849…8c71a6`](https://explorer.testnet.arc.io/tx/0x455a3849d9875e610f43efac5fd1ca97b778d980a681d2fc86b63d50d08c71a6)
- release (public hub): [`0xcf628697…8ec71d`](https://explorer.testnet.arc.io/tx/0xcf6286972b91fc6b66d00b0328f56d996f7c3687e7d83bef942475393d8ec71d)

**erc8004-arc**

- earned feedback for agent 897802: [`0x3af33b85…0d1072`](https://explorer.testnet.arc.io/tx/0x3af33b85a60ab3bea32666b5ea627c56151018e70b7c4d00d8e9bc94600d1072)

**mpp**

- mpp payment: [`0x530d7aae…abde8a`](https://explore.testnet.tempo.xyz/tx/0x530d7aaec32e5143006b4326bcb13bd149cde97adf0cec9c67bd949b8fabde8a)
- mpp payment (signed credential): [`0xb240639d…0740f3`](https://explore.testnet.tempo.xyz/tx/0xb240639d9b8cc7e2fcf12782fd57b8dc5528f11c279a642a4cb3e37ca20740f3)

## Failures

**erc8004-identity** · step `the registration file is an ERC-8004 v1 file naming a hub and offers` · owner cs-hd

> HTTP request failed.

## Notes

- `public-spine`: bought use-arc 0xdd24c0f8 from seller 0x6BE98051B852824A3923E3B27f9781Ceb0C0ca4a
- `erc8004-identity`: agent 158 in 0x8004A818BFB912233c491871b3d84c89A494BD9e on chain 296 is owned by 0xE4eBF122a912BeF5FeC9C56e003FD4Af2CBDB5fE
- `erc8004-arc`: agents: 897802 (0x6BE98051), 897803 (0xA55a31E3)
- `erc8004-arc`: feedback on Arc for these agents: 1, earned 1
- `production-console`: default bundle: index-DD6Ob4tp.js, rolldown-runtime-BWaJ3C7D.js, utils-Bpv4vmSW.js, chain-DGHNkaZc.js, hashTypedData-OJxD_jjD.js, hashMessage-NC5SDVnI.js, ccip-Cx9Un7-3.js, _esm-BdNswz-Z.js, src-NnqN028C.js, http-BQJpC50I.js, approver-DioVlLqE.js, model-CaoI6Rsn.js
- `production-console`: fixture markers checked: 89
- `production-hub`: checked 11 endpoints for agent 0xE0625e01b7c79d1E399B55F252e6Bdc820733f48 and seller 0xE4eBF122a912BeF5FeC9C56e003FD4Af2CBDB5fE
- `production-hub`: the approval routes, /envelopes and /approvals, are checked by production-approvals: they depend on production's approver configuration

## Steps

**arc-spine**

- ok · hub up · 449 ms
- ok · seller publishes use-arc · 358 ms
- ok · buyer discovers · 177 ms
- ok · envelope approves · 173 ms
- ok · seller balance before · 184 ms
- ok · countersign, fund, deliver, release · 3.5 s
- ok · hub job record · 1 ms
- ok · chain agrees · 1.1 s
- ok · slip names its rail · 739 ms
- ok · hub stopped · 16 ms
- ok · verifier VALID with the hub stopped · 1.0 s

**runner-restart**

- ok · hub up · 397 ms
- ok · runner serves use-arc · 315 ms
- ok · runner stops, offer goes offline · 8 ms
- ok · runner restarts: same offer, back online · 416 ms

**arc-wrong-amount**

- ok · hub up · 479 ms
- ok · seller publishes use-arc · 365 ms
- ok · 402 challenge · 6 ms
- ok · buyer countersigns the listed price · 9 ms
- ok · hub refuses a moved price · 185 ms
- ok · chain refuses a moved price · 3.2 s
- ok · the signature holds at the signed price · 189 ms

**arc-deadline-refund**

- ok · hub up · 397 ms
- ok · seller publishes use-arc with a 45 s deadline · 293 ms
- ok · envelope approves · 247 ms
- ok · buyer pays, seller cannot deliver · 2.4 s
- ok · escrow holds the money · 370 ms
- ok · hub stopped · 9 ms
- ok · a refund before the deadline is refused · 374 ms
- ok · chain passes the deadline · 42.9 s
- ok · a stranger refunds · 1.3 s
- ok · the refund is final · 191 ms

**slip-onchain-arc**

- ok · the slip agrees with itself · 0 ms
- ok · Released carries the slip hash · 369 ms
- ok · the escrow stores the slip hash · 187 ms
- ok · the genuine slip verifies · 1.0 s
- ok · a tampered slip fails on chain · 830 ms

**refusals**

- ok · hub up · 425 ms
- ok · seller publishes use-arc · 299 ms
- ok · the hub's input gate refuses a bad input · 2 ms
- ok · an input the slip cannot hash is refused before any 402 · 6 ms
- ok · the buyer refuses a bad input before signing · 398 ms
- ok · over the budget · 393 ms
- ok · over the per-seller limit · 385 ms
- ok · seller not on the allowlist · 377 ms
- ok · envelope revoked · 386 ms
- ok · held above ask-above until the human approves · 369 ms
- ok · seller offline: refused, nothing charged · 360 ms

**ratings**

- ok · hub up · 385 ms
- ok · seller publishes use-arc with a 45 s deadline · 267 ms
- ok · a buyer's call is delivered · 3.7 s
- ok · the seller buys from itself · 3.5 s
- ok · a buyer's call fails delivery · 2.3 s
- ok · the seller's rating counts what the slips prove · 4 ms
- ok · hub stats agree · 1 ms
- ok · the hub's janitor refunds the failed call after its deadline · 54.5 s
- ok · the rating follows the refund · 4 ms

**whitechain**

- ok · relay up with the suite's gas wallet · 1.3 s
- ok · merchant server up · 215 ms
- ok · hub up on the Whitechain rail · 456 ms
- ok · merchant publishes whitechain-dev · 328 ms
- ok · buyer holds no gas before paying · 1.1 s
- ok · sale · envelope approves · 182 ms
- ok · sale · buyer pays in USDT, released · 17.3 s
- ok · sale · chain agrees, relayer paid every fee · 1.4 s
- ok · buyer holds no gas after paying · 735 ms
- ok · the merchant sees the order · 9 ms
- ok · merchant refunds in one click · 8.3 s
- ok · buyer holds no gas after the refund · 555 ms

**slip-onchain-whitechain**

- ok · the slip agrees with itself · 0 ms
- ok · Released carries the slip hash · 565 ms
- ok · the escrow stores the slip hash · 186 ms
- ok · the genuine slip verifies · 1.8 s
- ok · a tampered slip fails on chain · 1.4 s

**merchant**

- ok · relay up with the suite's gas wallet · 1.2 s
- ok · merchant server up · 234 ms
- ok · hub up on the Whitechain rail · 510 ms
- ok · merchant publishes whitechain-dev · 341 ms
- ok · sale · envelope approves · 194 ms
- ok · sale · buyer pays in USDT, released · 18.3 s
- ok · sale · chain agrees, relayer paid every fee · 1.6 s
- ok · totals match the chain · 55 ms
- ok · partial refund of 0.005 USDT · 5.1 s
- ok · totals move by the refund and nothing else · 2 ms
- ok · the accountant's export · 4 ms
- ok · no token, no refund · 2 ms

**discovery**

- ok · local hub up · 940 ms
- ok · seller publishes use-arc · 366 ms
- ok · local · healthz · 1 ms
- ok · local · offer list · 1 ms
- ok · local · A2A agent card · 5 ms
- ok · local · skills index · 1 ms
- ok · local · OpenAPI · 1 ms
- ok · local · Bazaar list · 1 ms
- ok · local · unpaid call answers 402 · 3 ms
- ok · public · healthz · 423 ms
- ok · public · offer list · 309 ms
- ok · public · A2A agent card · 1.5 s
- ok · public · skills index · 289 ms
- ok · public · OpenAPI · 320 ms
- ok · public · Bazaar list · 304 ms
- ok · public · unpaid call answers 402 · 292 ms

**public-spine**

- ok · the public hub lists a live Arc offer · 307 ms
- ok · envelope approves · 209 ms
- ok · buyer pays through the public hub · 7.5 s
- ok · chain agrees · 889 ms
- ok · slip verifies with no hub · 1.7 s

**erc8004-identity**

- ok · the seller owns its agent id · 33.0 s
- FAIL · the registration file is an ERC-8004 v1 file naming a hub and offers · 163.2 s · HTTP request failed.

**erc8004-arc**

- ok · the public hub names sellers with ERC-8004 identities · 4.9 s
- ok · agent 897802 is owned by its seller and registers this hub and its offers · 369 ms
- ok · agent 897803 is owned by its seller and registers this hub and its offers · 378 ms
- ok · every feedback the reputation registry holds for them is checked, and earned feedback exists · 1.2 s

**mpp**

- ok · demo server up on the mpp rail · 415 ms
- ok · the 402 names Tempo testnet, the price and the recipient, before anything pays · 4 ms
- ok · the named payer pays with the pinned mppx · 5.5 s
- ok · Moderato shows exactly the price moved from the payer to the recipient · 358 ms
- ok · a credential replayed is refused · 6.1 s

**production-console**

- ok · the console serves its default bundle · 4.3 s
- ok · the default bundle is live, not fixtures · 205 ms

**production-hub**

- ok · the hub has a listed offer and a settlement to read · 903 ms
- ok · production declares exactly the rails that return money · 309 ms
- ok · every endpoint a screen calls answers 200, open to the console · 3.4 s

**production-approvals**

- ok · the agent the phone follows · 300 ms
- ok · the approval routes answer a client with no token · 871 ms
- ok · without the approver's token the routes refuse · 0 ms
- ok · with the approver's token the routes answer · 879 ms
- ok · every approval route answers, open to the console · 305 ms
- ok · the approval decision passes CORS preflight · 294 ms

Artifacts for this run (bodies, logs, slips) stay on the build machine under `e2e/artifacts/20261106-172911-a2ff/`.
