<!-- the latest full run; its own file is 20261106-142917-cffb.md -->
# e2e run 20261106-142917-cffb

| | |
|---|---|
| commit | `1013bf2` on `cs/e2e` |
| started | 2026-11-06 14:29:17 UTC (19:59 IST) |
| duration | 309.4 s |
| scope | full run, every flow |
| result | 23 pass · 0 fail · 0 skipped · 2 not run |

| # | Flow | Status | Time | Failed step |
|---|---|---|---|---|
| 1 | `arc-spine` | PASS | 7.1 s |  |
| 1b | `runner-restart` | PASS | 2.4 s |  |
| 2 | `arc-wrong-amount` | PASS | 2.6 s |  |
| 3 | `arc-deadline-refund` | PASS | 50.5 s |  |
| 4a | `slip-onchain-arc` | PASS | 2.3 s |  |
| 10 | `arc-gateway` | PASS | 3.5 s |  |
| 11 | `refusals` | PASS | 5.5 s |  |
| 13 | `ratings` | PASS | 64.0 s |  |
| 5 | `whitechain` | PASS | 29.4 s |  |
| 4b | `slip-onchain-whitechain` | PASS | 4.2 s |  |
| 6 | `hedera` | PASS | 22.1 s |  |
| 7 | `merchant` | PASS | 26.3 s |  |
| 8 | `discovery` | PASS | 4.4 s |  |
| 12 | `public-spine` | PASS | 10.4 s |  |
| 15 | `public-hedera` | PASS | 13.7 s |  |
| 16 | `public-gateway` | PASS | 5.0 s |  |
| 17 | `hedera-mcp` | PASS | 14.5 s |  |
| 18 | `erc8004-identity` | PASS | 16.6 s |  |
| 18b | `erc8004-arc` | PASS | 3.2 s |  |
| 19 | `mpp` | PASS | 10.2 s |  |
| 20 | `hedera-schedule` | NOT RUN (on demand: about 0.18 HBAR a run; run it with --flow hedera-schedule) |  |  |
| 14a | `production-console` | PASS | 1.6 s |  |
| 14b | `production-hub` | PASS | 4.9 s |  |
| 14c | `production-approvals` | PASS | 2.8 s |  |
| 9 | `web` | NOT RUN (cut: screenshot rounds cover it) |  |  |

## Transactions

**arc-spine**

- fund: [`0x584cda25…1b0a8f`](https://explorer.testnet.arc.io/tx/0x584cda25d70be51a2c7a3f48b4cce814d3f8f3f99ecb4dd8f89c7dd0c31b0a8f)
- release: [`0x51189923…458fad`](https://explorer.testnet.arc.io/tx/0x511899233b852230e048f9b4d754b64b6b4e8c0821d9966df7b9fab7aa458fad)

**arc-wrong-amount**

- fund at twice the signed price (reverted, as expected): [`0x6693ff1a…45b89f`](https://explorer.testnet.arc.io/tx/0x6693ff1af665048f13cd9b43285bd4c556be70fc3b5fa4b81b81209ccc45b89f)

**arc-deadline-refund**

- fund: [`0x87dc6380…08ce1f`](https://explorer.testnet.arc.io/tx/0x87dc6380cd46557238906a13370243d1a3577bf4918c99db8d1ae8f2c608ce1f)
- refund by a stranger: [`0x9e7b5596…c4fd0a`](https://explorer.testnet.arc.io/tx/0x9e7b5596cea696304477a6298fdc0b4894e36df322453cdd587423c1d8c4fd0a)

**slip-onchain-arc**

- release: [`0x51189923…458fad`](https://explorer.testnet.arc.io/tx/0x511899233b852230e048f9b4d754b64b6b4e8c0821d9966df7b9fab7aa458fad)

**ratings**

- refund by the hub's janitor: [`0x966a3f8d…f2e29a`](https://explorer.testnet.arc.io/tx/0x966a3f8da3b931c787756b29551bb85ea5d81012731a711c3e46ff6835f2e29a)

**whitechain**

- sale fund: [`0x1a96f07a…bd9079`](https://explorer.testnet.whitechain.io/tx/0x1a96f07a23f6c553a2c02e64b274fd9211306934120896dd7eded86955bd9079)
- sale release: [`0xe3d80ea2…d65e30`](https://explorer.testnet.whitechain.io/tx/0xe3d80ea29ef57d4692d6057ddc85d4291b9cde16e40aa8abfa9328371dd65e30)
- one-click refund: [`0x1525a04c…101e39`](https://explorer.testnet.whitechain.io/tx/0x1525a04c7de34311629f52ca0bb24c016fe6a589d70c8accaa54c42a8a101e39)

**slip-onchain-whitechain**

- release: [`0xe3d80ea2…d65e30`](https://explorer.testnet.whitechain.io/tx/0xe3d80ea29ef57d4692d6057ddc85d4291b9cde16e40aa8abfa9328371dd65e30)

**hedera**

- agent payment: [`0.0.918580…209898`](https://hashscan.io/testnet/transaction/0.0.9185802@1793975527.240209898)

**merchant**

- sale fund: [`0x91728b2f…43eb59`](https://explorer.testnet.whitechain.io/tx/0x91728b2ff164b3824d05ea07de97a464fa475f002dcea444342541bffe43eb59)
- sale release: [`0xe756b8be…34e35d`](https://explorer.testnet.whitechain.io/tx/0xe756b8beae3add89cd83a945b3e850df2fdc09eb77b63cb10bc6f39be434e35d)
- partial refund: [`0x1b51e4d5…673dc3`](https://explorer.testnet.whitechain.io/tx/0x1b51e4d55e4cf7b2e635349d9fff218626c40c1ac2737dafe1a02060fa673dc3)

**public-spine**

- fund (public hub): [`0xfbf7dc00…903d8c`](https://explorer.testnet.arc.io/tx/0xfbf7dc0048e55ab9e1cccbcbafdabf87d21ebe39554fe11092eff4975b903d8c)
- release (public hub): [`0xa054ac1d…15791b`](https://explorer.testnet.arc.io/tx/0xa054ac1d70f9055dec3534c37c0a4cd0bfc4ea2bef3542d2c6906d6e4715791b)

**public-hedera**

- agent payment through the public hub: [`0.0.918580…745519`](https://hashscan.io/testnet/transaction/0.0.9185802@1793975592.751745519)

**hedera-mcp**

- agent payment for the MCP call: [`0.0.918580…172673`](https://hashscan.io/testnet/transaction/0.0.9185802@1793975609.374172673)

**erc8004-arc**

- earned feedback for agent 897802: [`0x3af33b85…0d1072`](https://explorer.testnet.arc.io/tx/0x3af33b85a60ab3bea32666b5ea627c56151018e70b7c4d00d8e9bc94600d1072)

**mpp**

- mpp payment: [`0x9a7a6970…22d452`](https://explore.testnet.tempo.xyz/tx/0x9a7a69708f6d5a3aa824252e3f0769a6965ba1dee8c895f5dfb5f9d1ca22d452)
- mpp payment (signed credential): [`0x39554db9…96961c`](https://explore.testnet.tempo.xyz/tx/0x39554db9b80ce14283ca90dddaf8f3644b5f6cdc2727a1fe3aff6f514196961c)

## Notes

- `arc-gateway`: Gateway transfer 7dbafa16-7628-4be0-ad79-15c188450a9a; the seller is credited in Gateway's next batch
- `hedera`: facilitator: x402.org
- `hedera`: spend log: topic 0.0.11337070 sequence 66
- `hedera`: reconciled 1 agent payment(s) against 26 spend or schedule entries
- `public-spine`: bought use-arc 0xdd24c0f8 from seller 0x6BE98051B852824A3923E3B27f9781Ceb0C0ca4a
- `public-hedera`: paid use-usdc 0x41536222 to 0.0.11337065
- `public-gateway`: paid use-usdc 0x41536222 from seller 0xA55a31E3468E03E2Eb094535A8ae8e912e8CB093
- `public-gateway`: Gateway transfer 0648b41e-37de-423c-b7e0-fd61e7dec8f8
- `hedera-mcp`: paid MCP offer 0xa59402d5 (Hedera Agent Kit: an HBAR transfer, built for you to sign) to 0.0.11337065
- `erc8004-identity`: agent 158 in 0x8004A818BFB912233c491871b3d84c89A494BD9e on chain 296 is owned by 0xE4eBF122a912BeF5FeC9C56e003FD4Af2CBDB5fE
- `erc8004-arc`: agents: 897802 (0x6BE98051)
- `erc8004-arc`: feedback on Arc for these agents: 1, earned 1
- `production-console`: default bundle: index-CDu9B7ij.js
- `production-console`: fixture markers checked: 89
- `production-hub`: checked 11 endpoints for agent 0.0.11337064 and seller 0xd5882dBC7D41fBcf8ae0B05E9eAc1cbe93d6C71c
- `production-hub`: the approval routes, /envelopes and /approvals, are checked by production-approvals: they depend on production's approver configuration
- `production-approvals`: the phone follows 0.0.11337064, which has published no envelope mirror here, so the phone shows its absent state

## Steps

**arc-spine**

- ok · hub up · 380 ms
- ok · seller publishes use-arc · 236 ms
- ok · buyer discovers · 133 ms
- ok · envelope approves · 143 ms
- ok · seller balance before · 183 ms
- ok · countersign, fund, deliver, release · 3.1 s
- ok · hub job record · 1 ms
- ok · chain agrees · 1.1 s
- ok · slip names its rail · 814 ms
- ok · hub stopped · 7 ms
- ok · verifier VALID with the hub stopped · 982 ms

**runner-restart**

- ok · hub up · 390 ms
- ok · runner serves use-arc · 335 ms
- ok · runner stops, offer goes offline · 6 ms
- ok · runner restarts: same offer, back online · 174 ms

**arc-wrong-amount**

- ok · hub up · 388 ms
- ok · seller publishes use-arc · 209 ms
- ok · 402 challenge · 8 ms
- ok · buyer countersigns the listed price · 4 ms
- ok · hub refuses a moved price · 189 ms
- ok · chain refuses a moved price · 1.7 s
- ok · the signature holds at the signed price · 184 ms

**arc-deadline-refund**

- ok · hub up · 1.3 s
- ok · seller publishes use-arc with a 45 s deadline · 701 ms
- ok · envelope approves · 459 ms
- ok · buyer pays, seller cannot deliver · 2.8 s
- ok · escrow holds the money · 372 ms
- ok · hub stopped · 8 ms
- ok · a refund before the deadline is refused · 365 ms
- ok · chain passes the deadline · 42.9 s
- ok · a stranger refunds · 1.3 s
- ok · the refund is final · 186 ms

**slip-onchain-arc**

- ok · the slip agrees with itself · 0 ms
- ok · Released carries the slip hash · 380 ms
- ok · the escrow stores the slip hash · 181 ms
- ok · the genuine slip verifies · 953 ms
- ok · a tampered slip fails on chain · 785 ms

**arc-gateway**

- ok · hub up with the escrow and Gateway rails · 762 ms
- ok · seller publishes use-arc on both rails · 248 ms
- ok · 402 offers Circle Gateway · 4 ms
- ok · envelope approves · 375 ms
- ok · buyer's Gateway balance before · 273 ms
- ok · buyer pays through Gateway · 1.5 s
- ok · Gateway debits the buyer at once · 267 ms
- ok · slip names the gateway rail and verifies · 133 ms

**refusals**

- ok · hub up · 507 ms
- ok · seller publishes use-arc · 476 ms
- ok · the hub's input gate refuses a bad input · 2 ms
- ok · an input the slip cannot hash is refused before any 402 · 6 ms
- ok · the buyer refuses a bad input before signing · 622 ms
- ok · over the budget · 709 ms
- ok · over the per-seller limit · 629 ms
- ok · seller not on the allowlist · 627 ms
- ok · envelope revoked · 566 ms
- ok · held above ask-above until the human approves · 795 ms
- ok · seller offline: refused, nothing charged · 581 ms

**ratings**

- ok · hub up · 835 ms
- ok · seller publishes use-arc with a 45 s deadline · 554 ms
- ok · a buyer's call is delivered · 8.2 s
- ok · the seller buys from itself · 3.5 s
- ok · a buyer's call fails delivery · 3.2 s
- ok · the seller's rating counts what the slips prove · 10 ms
- ok · hub stats agree · 1 ms
- ok · the hub's janitor refunds the failed call after its deadline · 47.8 s
- ok · the rating follows the refund · 3 ms

**whitechain**

- ok · relay up with the suite's gas wallet · 1.2 s
- ok · merchant server up · 297 ms
- ok · hub up on the Whitechain rail · 1.1 s
- ok · merchant publishes whitechain-dev · 487 ms
- ok · buyer holds no gas before paying · 990 ms
- ok · sale · envelope approves · 270 ms
- ok · sale · buyer pays in USDT, released · 17.9 s
- ok · sale · chain agrees, relayer paid every fee · 1.5 s
- ok · buyer holds no gas after paying · 632 ms
- ok · the merchant sees the order · 16 ms
- ok · merchant refunds in one click · 4.4 s
- ok · buyer holds no gas after the refund · 640 ms

**slip-onchain-whitechain**

- ok · the slip agrees with itself · 0 ms
- ok · Released carries the slip hash · 605 ms
- ok · the escrow stores the slip hash · 194 ms
- ok · the genuine slip verifies · 1.8 s
- ok · a tampered slip fails on chain · 1.5 s

**hedera**

- ok · hub up with the Hedera rail · 1.6 s
- ok · seller lists an offer paid on Hedera · 280 ms
- ok · 402 names the Hedera rail · 4 ms
- ok · agent pays with no human step · 6.9 s
- ok · mirror node confirms the transfer · 658 ms
- ok · spend log entry on HCS · 4.1 s
- ok · envelope refuses past its cap, and logs it · 7.5 s
- ok · the spend log is complete for this run · 1.1 s

**merchant**

- ok · relay up with the suite's gas wallet · 1.9 s
- ok · merchant server up · 1.2 s
- ok · hub up on the Whitechain rail · 1.4 s
- ok · merchant publishes whitechain-dev · 895 ms
- ok · sale · envelope approves · 583 ms
- ok · sale · buyer pays in USDT, released · 14.5 s
- ok · sale · chain agrees, relayer paid every fee · 973 ms
- ok · totals match the chain · 29 ms
- ok · partial refund of 0.005 USDT · 4.8 s
- ok · totals move by the refund and nothing else · 2 ms
- ok · the accountant's export · 2 ms
- ok · no token, no refund · 2 ms

**discovery**

- ok · local hub up · 578 ms
- ok · seller publishes use-arc · 323 ms
- ok · local · healthz · 1 ms
- ok · local · offer list · 1 ms
- ok · local · A2A agent card · 5 ms
- ok · local · skills index · 1 ms
- ok · local · OpenAPI · 1 ms
- ok · local · Bazaar list · 1 ms
- ok · local · unpaid call answers 402 · 3 ms
- ok · public · healthz · 480 ms
- ok · public · offer list · 314 ms
- ok · public · A2A agent card · 1.2 s
- ok · public · skills index · 307 ms
- ok · public · OpenAPI · 538 ms
- ok · public · Bazaar list · 303 ms
- ok · public · unpaid call answers 402 · 303 ms

**public-spine**

- ok · the public hub lists a live Arc offer · 323 ms
- ok · envelope approves · 153 ms
- ok · buyer pays through the public hub · 7.5 s
- ok · chain agrees · 891 ms
- ok · slip verifies with no hub · 1.6 s

**public-hedera**

- ok · the public hub lists a live Hedera offer · 330 ms
- ok · 402 names the Hedera rail on production · 305 ms
- ok · agent pays through the public hub, no human step · 8.0 s
- ok · mirror node confirms the transfer · 416 ms
- ok · spend log entry on HCS · 3.8 s
- ok · the public hub records the settlement and its slip verifies · 885 ms

**public-gateway**

- ok · the public hub lists a live Gateway offer · 305 ms
- ok · envelope approves · 516 ms
- ok · buyer's Gateway balance before · 369 ms
- ok · buyer pays through Gateway on the public hub · 3.1 s
- ok · Gateway debits the buyer at once · 260 ms
- ok · the public hub serves the same slip, and it verifies · 464 ms

**hedera-mcp**

- ok · the public hub lists the Agent Kit MCP offer · 314 ms
- ok · 402 names the Hedera rail · 326 ms
- ok · agent pays, the runner calls the tool · 8.6 s
- ok · mirror node confirms the payment · 419 ms
- ok · spend log entry on HCS · 3.8 s
- ok · the slip binds the MCP call · 953 ms
- ok · the tool's record matches the slip · 3 ms
- ok · the tool returned an unsigned transfer for the buyer · 47 ms

**erc8004-identity**

- ok · the seller owns its agent id · 852 ms
- ok · the registration file is an ERC-8004 v1 file naming a hub and offers · 11.1 s
- ok · the A2A endpoint is this hub's card, and it lists the offer · 321 ms
- ok · every registered offer is the owner's and live on the hub · 347 ms
- ok · the declared wallet is the owner, on the chain the identity lives on · 4.0 s

**erc8004-arc**

- ok · the public hub names sellers with ERC-8004 identities · 1.7 s
- ok · agent 897802 is owned by its seller and registers this hub and its offers · 365 ms
- ok · every feedback the reputation registry holds for them is checked, and earned feedback exists · 893 ms

**mpp**

- ok · demo server up on the mpp rail · 770 ms
- ok · the 402 names Tempo testnet, the price and the recipient, before anything pays · 61 ms
- ok · the named payer pays with the pinned mppx · 4.7 s
- ok · Moderato shows exactly the price moved from the payer to the recipient · 325 ms
- ok · a credential replayed is refused · 4.4 s

**production-console**

- ok · the console serves its default bundle · 973 ms
- ok · the default bundle is live, not fixtures · 623 ms

**production-hub**

- ok · the hub has a listed offer and a settlement to read · 635 ms
- ok · production declares every rail it claims · 345 ms
- ok · every endpoint a screen calls answers 200, open to the console · 3.9 s

**production-approvals**

- ok · the agent the phone follows · 305 ms
- ok · the approval routes answer a client with no token · 927 ms
- ok · without the approver's token the routes refuse · 0 ms
- ok · with the approver's token the routes answer · 939 ms
- ok · every approval route answers, open to the console · 314 ms
- ok · the approval decision passes CORS preflight · 315 ms

Artifacts for this run (bodies, logs, slips) stay on the build machine under `e2e/artifacts/20261106-142917-cffb/`.
