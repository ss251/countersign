<!-- the latest full run; its own file is 20261106-145831-2a04.md -->
# e2e run 20261106-145831-2a04

| | |
|---|---|
| commit | `4b1a47d` on `cs/e2e` |
| started | 2026-11-06 14:58:31 UTC (20:28 IST) |
| duration | 345.6 s |
| scope | full run, every flow |
| result | 23 pass · 0 fail · 0 skipped · 2 not run |

| # | Flow | Status | Time | Failed step |
|---|---|---|---|---|
| 1 | `arc-spine` | PASS | 8.5 s |  |
| 1b | `runner-restart` | PASS | 2.5 s |  |
| 2 | `arc-wrong-amount` | PASS | 2.8 s |  |
| 3 | `arc-deadline-refund` | PASS | 51.3 s |  |
| 4a | `slip-onchain-arc` | PASS | 2.7 s |  |
| 10 | `arc-gateway` | PASS | 3.2 s |  |
| 11 | `refusals` | PASS | 3.6 s |  |
| 13 | `ratings` | PASS | 67.6 s |  |
| 5 | `whitechain` | PASS | 26.3 s |  |
| 4b | `slip-onchain-whitechain` | PASS | 3.9 s |  |
| 6 | `hedera` | PASS | 26.3 s |  |
| 7 | `merchant` | PASS | 29.4 s |  |
| 8 | `discovery` | PASS | 5.1 s |  |
| 12 | `public-spine` | PASS | 16.4 s |  |
| 15 | `public-hedera` | PASS | 20.1 s |  |
| 16 | `public-gateway` | PASS | 4.0 s |  |
| 17 | `hedera-mcp` | PASS | 38.9 s |  |
| 18 | `erc8004-identity` | PASS | 3.9 s |  |
| 18b | `erc8004-arc` | PASS | 4.0 s |  |
| 19 | `mpp` | PASS | 12.5 s |  |
| 20 | `hedera-schedule` | NOT RUN (on demand: about 0.18 HBAR a run; run it with --flow hedera-schedule) |  |  |
| 14a | `production-console` | PASS | 4.1 s |  |
| 14b | `production-hub` | PASS | 4.3 s |  |
| 14c | `production-approvals` | PASS | 2.7 s |  |
| 9 | `web` | NOT RUN (cut: screenshot rounds cover it) |  |  |

## Transactions

**arc-spine**

- fund: [`0xb9bc86fb…ac1a83`](https://explorer.testnet.arc.io/tx/0xb9bc86fb3ad8fd7151102ec934309c1e967dfa18b3558204f4b541437eac1a83)
- release: [`0x1b355780…1937e3`](https://explorer.testnet.arc.io/tx/0x1b35578040cc77ec9d25d299a93aefb804c376cd0a7bba118abc45ffbb1937e3)

**arc-wrong-amount**

- fund at twice the signed price (reverted, as expected): [`0x3f4347a5…d022d9`](https://explorer.testnet.arc.io/tx/0x3f4347a59e7d9f09b02c4704219390e8ec033bc456dcdf61ed72b8c263d022d9)

**arc-deadline-refund**

- fund: [`0x7c1abb14…f6d034`](https://explorer.testnet.arc.io/tx/0x7c1abb141c4b03848f0bffe6b6cd87ec35a0445c5581a3ece7c03462e8f6d034)
- refund by a stranger: [`0xfb40427a…4d563e`](https://explorer.testnet.arc.io/tx/0xfb40427a6cd9dff7fa551e7a11bf858f78a1262665502a4b4aefec0d6d4d563e)

**slip-onchain-arc**

- release: [`0x1b355780…1937e3`](https://explorer.testnet.arc.io/tx/0x1b35578040cc77ec9d25d299a93aefb804c376cd0a7bba118abc45ffbb1937e3)

**ratings**

- refund by the hub's janitor: [`0xec0cc01c…d8dc09`](https://explorer.testnet.arc.io/tx/0xec0cc01c5612bc1a8159483abb2d4dde714ee851ec098a71c6cbb1b98bd8dc09)

**whitechain**

- sale fund: [`0x874c2169…aa8c79`](https://explorer.testnet.whitechain.io/tx/0x874c2169dfad2508fdb21fec389c1c98089554662ef65f55e6c3ec9681aa8c79)
- sale release: [`0x78e77bee…a6644d`](https://explorer.testnet.whitechain.io/tx/0x78e77bee0cd8d5fe261850d6918da6a7523f81f69be9fca1172d719c35a6644d)
- one-click refund: [`0x127c7ef2…88833d`](https://explorer.testnet.whitechain.io/tx/0x127c7ef2113d1edb03ee9d6a5e9802491b1d0e4e77406bbba799e6a58788833d)

**slip-onchain-whitechain**

- release: [`0x78e77bee…a6644d`](https://explorer.testnet.whitechain.io/tx/0x78e77bee0cd8d5fe261850d6918da6a7523f81f69be9fca1172d719c35a6644d)

**hedera**

- agent payment: [`0.0.918580…623244`](https://hashscan.io/testnet/transaction/0.0.9185802@1793977283.293623244)

**merchant**

- sale fund: [`0x406e1dbd…6de934`](https://explorer.testnet.whitechain.io/tx/0x406e1dbd42254ca598293e54ab9042e6563bf140220a309e095fd959b56de934)
- sale release: [`0xbe821074…0f0df6`](https://explorer.testnet.whitechain.io/tx/0xbe8210741d00beaa66444fe2e241a69c89d2142eee5ac15a8f2f9cdab00f0df6)
- partial refund: [`0xc4de6fe5…27e15c`](https://explorer.testnet.whitechain.io/tx/0xc4de6fe52df3f311be49155dc8536db82bcc29502c6bb39eda9fad2a3227e15c)

**public-spine**

- fund (public hub): [`0x579b7164…08f6a5`](https://explorer.testnet.arc.io/tx/0x579b7164e366b88a272cbd12b8aad317dc81fe17b3cb06b6adbdc56e0d08f6a5)
- release (public hub): [`0xfd24a9ae…f6c25d`](https://explorer.testnet.arc.io/tx/0xfd24a9ae18e433f4d5c1da0e9a2a345c7edbd91de39d83741df8ef3860f6c25d)

**public-hedera**

- agent payment through the public hub: [`0.0.918580…223531`](https://hashscan.io/testnet/transaction/0.0.9185802@1793977364.357223531)

**hedera-mcp**

- agent payment for the MCP call: [`0.0.918580…139662`](https://hashscan.io/testnet/transaction/0.0.9185802@1793977387.614139662)

**erc8004-arc**

- earned feedback for agent 897802: [`0x3af33b85…0d1072`](https://explorer.testnet.arc.io/tx/0x3af33b85a60ab3bea32666b5ea627c56151018e70b7c4d00d8e9bc94600d1072)

**mpp**

- mpp payment: [`0xc6cf69b8…e862e7`](https://explore.testnet.tempo.xyz/tx/0xc6cf69b85215b987ae3e46cc6e598af859a59c33983c06218d75e95fd3e862e7)
- mpp payment (signed credential): [`0xc865dd2c…c889e1`](https://explore.testnet.tempo.xyz/tx/0xc865dd2c3392183f2cdd9f4ced050b187a2c335ffab9f103d926887790c889e1)

## Notes

- `arc-gateway`: Gateway transfer fc8574de-5680-442f-be64-a8e9dce2ab0e; the seller is credited in Gateway's next batch
- `hedera`: facilitator: x402.org
- `hedera`: spend log: topic 0.0.11337070 sequence 73
- `hedera`: reconciled 1 agent payment(s) against 26 spend or schedule entries
- `public-spine`: bought use-arc 0xdd24c0f8 from seller 0x6BE98051B852824A3923E3B27f9781Ceb0C0ca4a
- `public-hedera`: paid use-usdc 0x41536222 to 0.0.11337065
- `public-gateway`: paid use-usdc 0x41536222 from seller 0xA55a31E3468E03E2Eb094535A8ae8e912e8CB093
- `public-gateway`: Gateway transfer cfd32305-d82d-4e54-83fc-b053bb7242e9
- `hedera-mcp`: paid MCP offer 0xa59402d5 (Hedera Agent Kit: an HBAR transfer, built for you to sign) to 0.0.11337065
- `erc8004-identity`: agent 158 in 0x8004A818BFB912233c491871b3d84c89A494BD9e on chain 296 is owned by 0xE4eBF122a912BeF5FeC9C56e003FD4Af2CBDB5fE
- `erc8004-arc`: agents: 897802 (0x6BE98051), 897803 (0xA55a31E3)
- `erc8004-arc`: feedback on Arc for these agents: 1, earned 1
- `production-console`: default bundle: index-D7nrkdoA.js, rolldown-runtime-BWaJ3C7D.js, utils-Bpv4vmSW.js, chain-DGHNkaZc.js, hashTypedData-OJxD_jjD.js, hashMessage-NC5SDVnI.js, ccip-Cx9Un7-3.js, _esm-BdNswz-Z.js, src-NnqN028C.js, approver-DioVlLqE.js, model-sTAEdp3S.js
- `production-console`: fixture markers checked: 89
- `production-hub`: checked 11 endpoints for agent 0.0.11337064 and seller 0xd5882dBC7D41fBcf8ae0B05E9eAc1cbe93d6C71c
- `production-hub`: the approval routes, /envelopes and /approvals, are checked by production-approvals: they depend on production's approver configuration
- `production-approvals`: the phone follows 0.0.11337064, which has published no envelope mirror here, so the phone shows its absent state

## Steps

**arc-spine**

- ok · hub up · 532 ms
- ok · seller publishes use-arc · 548 ms
- ok · buyer discovers · 302 ms
- ok · envelope approves · 346 ms
- ok · seller balance before · 180 ms
- ok · countersign, fund, deliver, release · 3.8 s
- ok · hub job record · 1 ms
- ok · chain agrees · 1.1 s
- ok · slip names its rail · 733 ms
- ok · hub stopped · 7 ms
- ok · verifier VALID with the hub stopped · 1.0 s

**runner-restart**

- ok · hub up · 403 ms
- ok · runner serves use-arc · 314 ms
- ok · runner stops, offer goes offline · 7 ms
- ok · runner restarts: same offer, back online · 260 ms

**arc-wrong-amount**

- ok · hub up · 421 ms
- ok · seller publishes use-arc · 349 ms
- ok · 402 challenge · 4 ms
- ok · buyer countersigns the listed price · 4 ms
- ok · hub refuses a moved price · 184 ms
- ok · chain refuses a moved price · 1.7 s
- ok · the signature holds at the signed price · 183 ms

**arc-deadline-refund**

- ok · hub up · 732 ms
- ok · seller publishes use-arc with a 45 s deadline · 863 ms
- ok · envelope approves · 616 ms
- ok · buyer pays, seller cannot deliver · 2.8 s
- ok · escrow holds the money · 364 ms
- ok · hub stopped · 9 ms
- ok · a refund before the deadline is refused · 391 ms
- ok · chain passes the deadline · 44.0 s
- ok · a stranger refunds · 1.3 s
- ok · the refund is final · 181 ms

**slip-onchain-arc**

- ok · the slip agrees with itself · 0 ms
- ok · Released carries the slip hash · 368 ms
- ok · the escrow stores the slip hash · 186 ms
- ok · the genuine slip verifies · 1.0 s
- ok · a tampered slip fails on chain · 1.1 s

**arc-gateway**

- ok · hub up with the escrow and Gateway rails · 900 ms
- ok · seller publishes use-arc on both rails · 364 ms
- ok · 402 offers Circle Gateway · 5 ms
- ok · envelope approves · 191 ms
- ok · buyer's Gateway balance before · 265 ms
- ok · buyer pays through Gateway · 1.0 s
- ok · Gateway debits the buyer at once · 293 ms
- ok · slip names the gateway rail and verifies · 177 ms

**refusals**

- ok · hub up · 423 ms
- ok · seller publishes use-arc · 299 ms
- ok · the hub's input gate refuses a bad input · 2 ms
- ok · an input the slip cannot hash is refused before any 402 · 6 ms
- ok · the buyer refuses a bad input before signing · 431 ms
- ok · over the budget · 448 ms
- ok · over the per-seller limit · 391 ms
- ok · seller not on the allowlist · 385 ms
- ok · envelope revoked · 375 ms
- ok · held above ask-above until the human approves · 426 ms
- ok · seller offline: refused, nothing charged · 371 ms

**ratings**

- ok · hub up · 395 ms
- ok · seller publishes use-arc with a 45 s deadline · 332 ms
- ok · a buyer's call is delivered · 3.7 s
- ok · the seller buys from itself · 7.5 s
- ok · a buyer's call fails delivery · 3.2 s
- ok · the seller's rating counts what the slips prove · 4 ms
- ok · hub stats agree · 1 ms
- ok · the hub's janitor refunds the failed call after its deadline · 52.4 s
- ok · the rating follows the refund · 2 ms

**whitechain**

- ok · relay up with the suite's gas wallet · 1.2 s
- ok · merchant server up · 201 ms
- ok · hub up on the Whitechain rail · 478 ms
- ok · merchant publishes whitechain-dev · 337 ms
- ok · buyer holds no gas before paying · 1.0 s
- ok · sale · envelope approves · 202 ms
- ok · sale · buyer pays in USDT, released · 11.2 s
- ok · sale · chain agrees, relayer paid every fee · 1.4 s
- ok · buyer holds no gas after paying · 683 ms
- ok · the merchant sees the order · 23 ms
- ok · merchant refunds in one click · 8.9 s
- ok · buyer holds no gas after the refund · 624 ms

**slip-onchain-whitechain**

- ok · the slip agrees with itself · 0 ms
- ok · Released carries the slip hash · 640 ms
- ok · the escrow stores the slip hash · 188 ms
- ok · the genuine slip verifies · 1.7 s
- ok · a tampered slip fails on chain · 1.4 s

**hedera**

- ok · hub up with the Hedera rail · 1.5 s
- ok · seller lists an offer paid on Hedera · 346 ms
- ok · 402 names the Hedera rail · 3 ms
- ok · agent pays with no human step · 7.0 s
- ok · mirror node confirms the transfer · 8.3 s
- ok · spend log entry on HCS · 409 ms
- ok · envelope refuses past its cap, and logs it · 7.5 s
- ok · the spend log is complete for this run · 1.1 s

**merchant**

- ok · relay up with the suite's gas wallet · 1.2 s
- ok · merchant server up · 197 ms
- ok · hub up on the Whitechain rail · 409 ms
- ok · merchant publishes whitechain-dev · 317 ms
- ok · sale · envelope approves · 178 ms
- ok · sale · buyer pays in USDT, released · 17.8 s
- ok · sale · chain agrees, relayer paid every fee · 905 ms
- ok · totals match the chain · 16 ms
- ok · partial refund of 0.005 USDT · 8.3 s
- ok · totals move by the refund and nothing else · 20 ms
- ok · the accountant's export · 9 ms
- ok · no token, no refund · 48 ms

**discovery**

- ok · local hub up · 1.0 s
- ok · seller publishes use-arc · 627 ms
- ok · local · healthz · 5 ms
- ok · local · offer list · 2 ms
- ok · local · A2A agent card · 10 ms
- ok · local · skills index · 2 ms
- ok · local · OpenAPI · 3 ms
- ok · local · Bazaar list · 2 ms
- ok · local · unpaid call answers 402 · 12 ms
- ok · public · healthz · 446 ms
- ok · public · offer list · 342 ms
- ok · public · A2A agent card · 1.2 s
- ok · public · skills index · 300 ms
- ok · public · OpenAPI · 299 ms
- ok · public · Bazaar list · 305 ms
- ok · public · unpaid call answers 402 · 473 ms

**public-spine**

- ok · the public hub lists a live Arc offer · 313 ms
- ok · envelope approves · 528 ms
- ok · buyer pays through the public hub · 12.0 s
- ok · chain agrees · 847 ms
- ok · slip verifies with no hub · 2.7 s

**public-hedera**

- ok · the public hub lists a live Hedera offer · 3.7 s
- ok · 402 names the Hedera rail on production · 426 ms
- ok · agent pays through the public hub, no human step · 10.6 s
- ok · mirror node confirms the transfer · 428 ms
- ok · spend log entry on HCS · 3.8 s
- ok · the public hub records the settlement and its slip verifies · 1.2 s

**public-gateway**

- ok · the public hub lists a live Gateway offer · 313 ms
- ok · envelope approves · 242 ms
- ok · buyer's Gateway balance before · 301 ms
- ok · buyer pays through Gateway on the public hub · 2.4 s
- ok · Gateway debits the buyer at once · 281 ms
- ok · the public hub serves the same slip, and it verifies · 472 ms

**hedera-mcp**

- ok · the public hub lists the Agent Kit MCP offer · 556 ms
- ok · 402 names the Hedera rail · 310 ms
- ok · agent pays, the runner calls the tool · 23.0 s
- ok · mirror node confirms the payment · 13.3 s
- ok · spend log entry on HCS · 890 ms
- ok · the slip binds the MCP call · 834 ms
- ok · the tool's record matches the slip · 1 ms
- ok · the tool returned an unsigned transfer for the buyer · 9 ms

**erc8004-identity**

- ok · the seller owns its agent id · 2.1 s
- ok · the registration file is an ERC-8004 v1 file naming a hub and offers · 728 ms
- ok · the A2A endpoint is this hub's card, and it lists the offer · 318 ms
- ok · every registered offer is the owner's and live on the hub · 300 ms
- ok · the declared wallet is the owner, on the chain the identity lives on · 452 ms

**erc8004-arc**

- ok · the public hub names sellers with ERC-8004 identities · 2.1 s
- ok · agent 897802 is owned by its seller and registers this hub and its offers · 392 ms
- ok · agent 897803 is owned by its seller and registers this hub and its offers · 392 ms
- ok · every feedback the reputation registry holds for them is checked, and earned feedback exists · 864 ms

**mpp**

- ok · demo server up on the mpp rail · 430 ms
- ok · the 402 names Tempo testnet, the price and the recipient, before anything pays · 19 ms
- ok · the named payer pays with the pinned mppx · 5.6 s
- ok · Moderato shows exactly the price moved from the payer to the recipient · 376 ms
- ok · a credential replayed is refused · 6.2 s

**production-console**

- ok · the console serves its default bundle · 3.9 s
- ok · the default bundle is live, not fixtures · 217 ms

**production-hub**

- ok · the hub has a listed offer and a settlement to read · 613 ms
- ok · production declares every rail it claims · 300 ms
- ok · every endpoint a screen calls answers 200, open to the console · 3.4 s

**production-approvals**

- ok · the agent the phone follows · 287 ms
- ok · the approval routes answer a client with no token · 898 ms
- ok · without the approver's token the routes refuse · 0 ms
- ok · with the approver's token the routes answer · 888 ms
- ok · every approval route answers, open to the console · 313 ms
- ok · the approval decision passes CORS preflight · 292 ms

Artifacts for this run (bodies, logs, slips) stay on the build machine under `e2e/artifacts/20261106-145831-2a04/`.
