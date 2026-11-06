<!-- the latest full run; its own file is 20261106-141512-6a48.md -->
# e2e run 20261106-141512-6a48

| | |
|---|---|
| commit | `82a1dc5` on `HEAD` |
| started | 2026-11-06 14:15:12 UTC (19:45 IST) |
| duration | 336.4 s |
| scope | full run, every flow |
| result | 22 pass · 0 fail · 0 skipped · 2 not run |

| # | Flow | Status | Time | Failed step |
|---|---|---|---|---|
| 1 | `arc-spine` | PASS | 7.5 s |  |
| 1b | `runner-restart` | PASS | 2.9 s |  |
| 2 | `arc-wrong-amount` | PASS | 2.6 s |  |
| 3 | `arc-deadline-refund` | PASS | 48.3 s |  |
| 4a | `slip-onchain-arc` | PASS | 2.3 s |  |
| 10 | `arc-gateway` | PASS | 2.9 s |  |
| 11 | `refusals` | PASS | 4.5 s |  |
| 13 | `ratings` | PASS | 64.7 s |  |
| 5 | `whitechain` | PASS | 24.7 s |  |
| 4b | `slip-onchain-whitechain` | PASS | 4.2 s |  |
| 6 | `hedera` | PASS | 25.0 s |  |
| 7 | `merchant` | PASS | 30.3 s |  |
| 8 | `discovery` | PASS | 4.1 s |  |
| 12 | `public-spine` | PASS | 7.1 s |  |
| 15 | `public-hedera` | PASS | 13.1 s |  |
| 16 | `public-gateway` | PASS | 4.1 s |  |
| 17 | `hedera-mcp` | PASS | 12.9 s |  |
| 18 | `erc8004-identity` | PASS | 28.3 s |  |
| 18b | `erc8004-arc` | PASS | 4.1 s |  |
| 19 | `mpp` | PASS | 11.2 s |  |
| 20 | `hedera-schedule` | NOT RUN (on demand: about 0.18 HBAR a run; run it with --flow hedera-schedule) |  |  |
| 14a | `production-console` | PASS | 1.1 s |  |
| 14b | `production-hub` | PASS | 4.4 s |  |
| 9 | `web` | NOT RUN (cut: screenshot rounds cover it) |  |  |

## Transactions

**arc-spine**

- fund: [`0xf1d1a8f7…e2f6cf`](https://explorer.testnet.arc.io/tx/0xf1d1a8f7a6678f80b9b2f8e15b1482319b29ee08a8c5873291fa9529b7e2f6cf)
- release: [`0xeefb73de…7fbb10`](https://explorer.testnet.arc.io/tx/0xeefb73de6342f11cf759f1022286d149d48e1991fe4d391cbb7e5b26697fbb10)

**arc-wrong-amount**

- fund at twice the signed price (reverted, as expected): [`0x81d0c496…6211e9`](https://explorer.testnet.arc.io/tx/0x81d0c496b0491b16d1055e26c91c11a9d7c5a546fad308c9ae6f0ebc0e6211e9)

**arc-deadline-refund**

- fund: [`0x5ae33d73…6e0a07`](https://explorer.testnet.arc.io/tx/0x5ae33d73ef37dde5f78e7b079aa1ad2f14ac1ec8609429fd5690d303016e0a07)
- refund by a stranger: [`0x22373580…0177e5`](https://explorer.testnet.arc.io/tx/0x22373580f3c4245e62c9652c83e87c9f19f4a28b37fa0d7dc8ca1851ef0177e5)

**slip-onchain-arc**

- release: [`0xeefb73de…7fbb10`](https://explorer.testnet.arc.io/tx/0xeefb73de6342f11cf759f1022286d149d48e1991fe4d391cbb7e5b26697fbb10)

**ratings**

- refund by the hub's janitor: [`0xfd997fc3…7c0d91`](https://explorer.testnet.arc.io/tx/0xfd997fc3f06e59f26a993a40fb13ffaa6bc3e556ada39f08ecc61416e87c0d91)

**whitechain**

- sale fund: [`0xcee303f8…393f42`](https://explorer.testnet.whitechain.io/tx/0xcee303f8d57f8c9e7ad13a0aac95b15a9deadd5329d5b1199bfbff2568393f42)
- sale release: [`0xf6037cd5…a29baf`](https://explorer.testnet.whitechain.io/tx/0xf6037cd5eb90f7e4f5cde864ced32a0f9fdceaa79c1697a7a37420cafba29baf)
- one-click refund: [`0xcb8a56e8…5afda8`](https://explorer.testnet.whitechain.io/tx/0xcb8a56e8c0296519ba9f61fd1d3a3c451882596b78309b1b32beff1f5e5afda8)

**slip-onchain-whitechain**

- release: [`0xf6037cd5…a29baf`](https://explorer.testnet.whitechain.io/tx/0xf6037cd5eb90f7e4f5cde864ced32a0f9fdceaa79c1697a7a37420cafba29baf)

**hedera**

- agent payment: [`0.0.918580…788228`](https://hashscan.io/testnet/transaction/0.0.9185802@1793974700.087788228)

**merchant**

- sale fund: [`0x2aca8253…03f7c9`](https://explorer.testnet.whitechain.io/tx/0x2aca82536dad7a12f5876dfdcd1a0fec1396b8c5677b7cea4d99b37ec503f7c9)
- sale release: [`0x89bd7659…bed8e1`](https://explorer.testnet.whitechain.io/tx/0x89bd76593ba4012f4760d315794cf0296fe19617cbb716908e83477b5bbed8e1)
- partial refund: [`0xce47b5d3…eb3692`](https://explorer.testnet.whitechain.io/tx/0xce47b5d347768279f75bb02171aee5cfd02371a1d19a41d55347b2a1dceb3692)

**public-spine**

- fund (public hub): [`0xa9538a3a…3df180`](https://explorer.testnet.arc.io/tx/0xa9538a3a627f2e26e8234b499a5dff7a2997699d9e9e40797bd78c3df73df180)
- release (public hub): [`0x18c27f21…a65f17`](https://explorer.testnet.arc.io/tx/0x18c27f216f7e5d8a56e1ae63ffc2bfce9c2b2b6edb518123c2d901ac67a65f17)

**public-hedera**

- agent payment through the public hub: [`0.0.918580…848220`](https://hashscan.io/testnet/transaction/0.0.9185802@1793974765.444848220)

**hedera-mcp**

- agent payment for the MCP call: [`0.0.918580…609564`](https://hashscan.io/testnet/transaction/0.0.9185802@1793974782.895609564)

**erc8004-arc**

- earned feedback for agent 897802: [`0x3af33b85…0d1072`](https://explorer.testnet.arc.io/tx/0x3af33b85a60ab3bea32666b5ea627c56151018e70b7c4d00d8e9bc94600d1072)

**mpp**

- mpp payment: [`0x3b807196…404e31`](https://explore.testnet.tempo.xyz/tx/0x3b807196f0c49a47c4f544a781a77271905bc64bece270b26d731d479a404e31)
- mpp payment (signed credential): [`0xb560a622…792e46`](https://explore.testnet.tempo.xyz/tx/0xb560a622d5247e39e63b0a83213b945dc25d15b2c049ab8c4431d2cb9b792e46)

## Notes

- `arc-gateway`: Gateway transfer 1c1969ed-6d50-4bcd-9812-0d9d98205ea6; the seller is credited in Gateway's next batch
- `hedera`: facilitator: x402.org
- `hedera`: spend log: topic 0.0.11337070 sequence 58
- `hedera`: reconciled 1 agent payment(s) against 22 spend or schedule entries
- `public-spine`: bought use-arc 0xdd24c0f8 from seller 0x6BE98051B852824A3923E3B27f9781Ceb0C0ca4a
- `public-hedera`: paid use-usdc 0x41536222 to 0.0.11337065
- `public-gateway`: paid use-usdc 0x41536222 from seller 0xA55a31E3468E03E2Eb094535A8ae8e912e8CB093
- `public-gateway`: Gateway transfer 3ac00a14-9be6-4ff0-9b22-28ff26367e48
- `hedera-mcp`: paid MCP offer 0xa59402d5 (Hedera Agent Kit: an HBAR transfer, built for you to sign) to 0.0.11337065
- `erc8004-identity`: agent 158 in 0x8004A818BFB912233c491871b3d84c89A494BD9e on chain 296 is owned by 0xE4eBF122a912BeF5FeC9C56e003FD4Af2CBDB5fE
- `erc8004-arc`: agents: 897802 (0x6BE98051), 897803 (0xA55a31E3)
- `erc8004-arc`: feedback on Arc for these agents: 1, earned 1
- `production-console`: default bundle: index-CDu9B7ij.js
- `production-console`: fixture markers checked: 89
- `production-hub`: checked 11 endpoints for agent 0.0.11337064 and seller 0xd5882dBC7D41fBcf8ae0B05E9eAc1cbe93d6C71c
- `production-hub`: scoped out: /envelopes and /approvals. The per-call approval path is dropped (captain, 06 Nov 19:50 IST), so production runs without an approver and those routes answer 503 no-approver by design

## Steps

**arc-spine**

- ok · hub up · 480 ms
- ok · seller publishes use-arc · 236 ms
- ok · buyer discovers · 180 ms
- ok · envelope approves · 155 ms
- ok · seller balance before · 176 ms
- ok · countersign, fund, deliver, release · 3.3 s
- ok · hub job record · 3 ms
- ok · chain agrees · 1.1 s
- ok · slip names its rail · 758 ms
- ok · hub stopped · 7 ms
- ok · verifier VALID with the hub stopped · 1.1 s

**runner-restart**

- ok · hub up · 866 ms
- ok · runner serves use-arc · 303 ms
- ok · runner stops, offer goes offline · 4 ms
- ok · runner restarts: same offer, back online · 172 ms

**arc-wrong-amount**

- ok · hub up · 339 ms
- ok · seller publishes use-arc · 191 ms
- ok · 402 challenge · 4 ms
- ok · buyer countersigns the listed price · 4 ms
- ok · hub refuses a moved price · 187 ms
- ok · chain refuses a moved price · 1.7 s
- ok · the signature holds at the signed price · 182 ms

**arc-deadline-refund**

- ok · hub up · 358 ms
- ok · seller publishes use-arc with a 45 s deadline · 218 ms
- ok · envelope approves · 157 ms
- ok · buyer pays, seller cannot deliver · 2.2 s
- ok · escrow holds the money · 360 ms
- ok · hub stopped · 9 ms
- ok · a refund before the deadline is refused · 368 ms
- ok · chain passes the deadline · 43.1 s
- ok · a stranger refunds · 1.3 s
- ok · the refund is final · 188 ms

**slip-onchain-arc**

- ok · the slip agrees with itself · 0 ms
- ok · Released carries the slip hash · 374 ms
- ok · the escrow stores the slip hash · 179 ms
- ok · the genuine slip verifies · 1.1 s
- ok · a tampered slip fails on chain · 738 ms

**arc-gateway**

- ok · hub up with the escrow and Gateway rails · 908 ms
- ok · seller publishes use-arc on both rails · 233 ms
- ok · 402 offers Circle Gateway · 4 ms
- ok · envelope approves · 147 ms
- ok · buyer's Gateway balance before · 264 ms
- ok · buyer pays through Gateway · 904 ms
- ok · Gateway debits the buyer at once · 288 ms
- ok · slip names the gateway rail and verifies · 99 ms

**refusals**

- ok · hub up · 348 ms
- ok · seller publishes use-arc · 191 ms
- ok · the hub's input gate refuses a bad input · 2 ms
- ok · an input the slip cannot hash is refused before any 402 · 6 ms
- ok · the buyer refuses a bad input before signing · 342 ms
- ok · over the budget · 335 ms
- ok · over the per-seller limit · 485 ms
- ok · seller not on the allowlist · 520 ms
- ok · envelope revoked · 516 ms
- ok · held above ask-above until the human approves · 921 ms
- ok · seller offline: refused, nothing charged · 786 ms

**ratings**

- ok · hub up · 735 ms
- ok · seller publishes use-arc with a 45 s deadline · 377 ms
- ok · a buyer's call is delivered · 3.7 s
- ok · the seller buys from itself · 3.7 s
- ok · a buyer's call fails delivery · 2.3 s
- ok · the seller's rating counts what the slips prove · 5 ms
- ok · hub stats agree · 1 ms
- ok · the hub's janitor refunds the failed call after its deadline · 53.9 s
- ok · the rating follows the refund · 1 ms

**whitechain**

- ok · relay up with the suite's gas wallet · 1.2 s
- ok · merchant server up · 182 ms
- ok · hub up on the Whitechain rail · 413 ms
- ok · merchant publishes whitechain-dev · 251 ms
- ok · buyer holds no gas before paying · 985 ms
- ok · sale · envelope approves · 172 ms
- ok · sale · buyer pays in USDT, released · 13.8 s
- ok · sale · chain agrees, relayer paid every fee · 1.4 s
- ok · buyer holds no gas after paying · 848 ms
- ok · the merchant sees the order · 10 ms
- ok · merchant refunds in one click · 4.6 s
- ok · buyer holds no gas after the refund · 865 ms

**slip-onchain-whitechain**

- ok · the slip agrees with itself · 0 ms
- ok · Released carries the slip hash · 628 ms
- ok · the escrow stores the slip hash · 186 ms
- ok · the genuine slip verifies · 1.8 s
- ok · a tampered slip fails on chain · 1.6 s

**hedera**

- ok · hub up with the Hedera rail · 1.8 s
- ok · seller lists an offer paid on Hedera · 327 ms
- ok · 402 names the Hedera rail · 9 ms
- ok · agent pays with no human step · 9.9 s
- ok · mirror node confirms the transfer · 412 ms
- ok · spend log entry on HCS · 3.9 s
- ok · envelope refuses past its cap, and logs it · 7.6 s
- ok · the spend log is complete for this run · 1.1 s

**merchant**

- ok · relay up with the suite's gas wallet · 1.1 s
- ok · merchant server up · 161 ms
- ok · hub up on the Whitechain rail · 411 ms
- ok · merchant publishes whitechain-dev · 254 ms
- ok · sale · envelope approves · 186 ms
- ok · sale · buyer pays in USDT, released · 18.1 s
- ok · sale · chain agrees, relayer paid every fee · 930 ms
- ok · totals match the chain · 30 ms
- ok · partial refund of 0.005 USDT · 9.1 s
- ok · totals move by the refund and nothing else · 4 ms
- ok · the accountant's export · 3 ms
- ok · no token, no refund · 3 ms

**discovery**

- ok · local hub up · 519 ms
- ok · seller publishes use-arc · 236 ms
- ok · local · healthz · 1 ms
- ok · local · offer list · 1 ms
- ok · local · A2A agent card · 4 ms
- ok · local · skills index · 1 ms
- ok · local · OpenAPI · 2 ms
- ok · local · Bazaar list · 1 ms
- ok · local · unpaid call answers 402 · 3 ms
- ok · public · healthz · 456 ms
- ok · public · offer list · 324 ms
- ok · public · A2A agent card · 1.3 s
- ok · public · skills index · 301 ms
- ok · public · OpenAPI · 304 ms
- ok · public · Bazaar list · 327 ms
- ok · public · unpaid call answers 402 · 307 ms

**public-spine**

- ok · the public hub lists a live Arc offer · 326 ms
- ok · envelope approves · 146 ms
- ok · buyer pays through the public hub · 4.2 s
- ok · chain agrees · 854 ms
- ok · slip verifies with no hub · 1.6 s

**public-hedera**

- ok · the public hub lists a live Hedera offer · 327 ms
- ok · 402 names the Hedera rail on production · 308 ms
- ok · agent pays through the public hub, no human step · 7.2 s
- ok · mirror node confirms the transfer · 545 ms
- ok · spend log entry on HCS · 4.0 s
- ok · the public hub records the settlement and its slip verifies · 767 ms

**public-gateway**

- ok · the public hub lists a live Gateway offer · 326 ms
- ok · envelope approves · 231 ms
- ok · buyer's Gateway balance before · 502 ms
- ok · buyer pays through Gateway on the public hub · 2.3 s
- ok · Gateway debits the buyer at once · 264 ms
- ok · the public hub serves the same slip, and it verifies · 431 ms

**hedera-mcp**

- ok · the public hub lists the Agent Kit MCP offer · 326 ms
- ok · 402 names the Hedera rail · 332 ms
- ok · agent pays, the runner calls the tool · 6.9 s
- ok · mirror node confirms the payment · 720 ms
- ok · spend log entry on HCS · 3.9 s
- ok · the slip binds the MCP call · 765 ms
- ok · the tool's record matches the slip · 1 ms
- ok · the tool returned an unsigned transfer for the buyer · 9 ms

**erc8004-identity**

- ok · the seller owns its agent id · 19.0 s
- ok · the registration file is an ERC-8004 v1 file naming a hub and offers · 8.2 s
- ok · the A2A endpoint is this hub's card, and it lists the offer · 322 ms
- ok · every registered offer is the owner's and live on the hub · 313 ms
- ok · the declared wallet is the owner, on the chain the identity lives on · 445 ms

**erc8004-arc**

- ok · the public hub names sellers with ERC-8004 identities · 2.1 s
- ok · agent 897802 is owned by its seller and registers this hub and its offers · 356 ms
- ok · agent 897803 is owned by its seller and registers this hub and its offers · 356 ms
- ok · every feedback the reputation registry holds for them is checked, and earned feedback exists · 877 ms

**mpp**

- ok · demo server up on the mpp rail · 786 ms
- ok · the 402 names Tempo testnet, the price and the recipient, before anything pays · 20 ms
- ok · the named payer pays with the pinned mppx · 5.5 s
- ok · Moderato shows exactly the price moved from the payer to the recipient · 359 ms
- ok · a credential replayed is refused · 4.5 s

**production-console**

- ok · the console serves its default bundle · 971 ms
- ok · the default bundle is live, not fixtures · 170 ms

**production-hub**

- ok · the hub has a listed offer and a settlement to read · 616 ms
- ok · production declares every rail it claims · 320 ms
- ok · every endpoint a screen calls answers 200, open to the console · 3.5 s

Artifacts for this run (bodies, logs, slips) stay on the build machine under `e2e/artifacts/20261106-141512-6a48/`.
