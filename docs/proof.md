# Proof

Every claim below links to a public explorer. Times are IST, Fri 06 Nov 2026.

## Arc testnet (chain 5042002)

Escrow deployed through Arc Studio. The hub settles through it.

| | |
|---|---|
| `CountersignedEscrow` | [`0x19c27d770969291e6a0a305dc1be1a845e7c1b76`](https://explorer.testnet.arc.io/address/0x19c27d770969291e6a0a305dc1be1a845e7c1b76), deploy tx [`0x06638eb4…6c5a`](https://explorer.testnet.arc.io/tx/0x06638eb4cfa8db52b5e097778160fbc913561e88f56aa8fc2ec195cb6d596c5a) |
| `FeeSplit` (treasury) | [`0xbf9de410d4a17781df0d9d3dd160018aceb3fe87`](https://explorer.testnet.arc.io/address/0xbf9de410d4a17781df0d9d3dd160018aceb3fe87), deploy tx [`0xbb5b0fb2…2c8c`](https://explorer.testnet.arc.io/tx/0xbb5b0fb2f4666c9e3a0b2c114110cdda3519f350cbc6cbb4d5ce28a513322c8c) |

| Beat | Evidence |
|---|---|
| A buyer agent buys Circle's `use-arc` skill for 0.01 USDC. The hub funds the escrow, the seller's runner delivers, the seller signs the slip and the escrow releases. | release [`0x02b65aab…2809`](https://explorer.testnet.arc.io/tx/0x02b65aabec26062e828e1b91203a9d8de5cdab0a6717bbf087054c76b3702809), slip `0x9c455e56767f89d818605df4e1c405644f0ea92ca3239cca7ec314c1a41b260c` |
| The slip verifies with only the slip file and a public RPC. | `bun packages/verify/src/cli.ts <slip> --rpc https://rpc.testnet.arc.network` prints `VALID`, including `Released(job, slip)` in block 71012235 |
| **Refused: the price moved.** The buyer signed 0.01; a settlement at 0.02 is forced on chain and reverts. | [`0xca616278…0e76`](https://explorer.testnet.arc.io/tx/0xca61627848d1ea952c5953ac58df7b8bd780777563e24ebccf5bb90315d20e76) (status: reverted) |
| **Refused: the deadline passed.** A job is funded and nobody delivers. After the deadline a stranger refunds the full amount to the buyer. | fund [`0x6a103973…2eb7`](https://explorer.testnet.arc.io/tx/0x6a103973020747af341e008ec5b317cc97ac0ffef059c381fb19d9cdf9ca2eb7), refund [`0x1cd2a5a6…9e35`](https://explorer.testnet.arc.io/tx/0x1cd2a5a624a6c166d6b85e99dfaffcbd03c1c65c17fe7010109610872c499e35) |

Hosted backend: the hub runs on Railway at `https://hub-production-e85e.up.railway.app`, and a runner on the seller's machine dials out to it. A buyer agent bought through it and the escrow released in [`0x0a0118e9…ed69`](https://explorer.testnet.arc.io/tx/0x0a0118e9e81c21517eaf0f387e7801e1fafef947cfccd1c05ff989201433ed69). Slip `0x3204ff870ffad20b38d9504622e5889508d889a10f3f1efef05d16046ab2fe85`; its `Released` event is in block 71014448.

Circle Gateway nanopayment (rail `gateway`):

| | |
|---|---|
| buyer's Gateway deposit (1 USDC) | [`0x4ae04719…1cbc`](https://explorer.testnet.arc.io/tx/0x4ae047192cda083df967bfe371359dd4f4a7bfde7cde1f61ea9b2a9ddab91cbc) |
| paid call, 0.01 USDC | Gateway transfer `a69f94c8-8771-4d8b-96ba-fe189501f80c`, status `received`. The buyer's Gateway balance dropped from 1 to 0.99 immediately. The seller is credited in Gateway's next batch, so there is no per-call chain tx. |
| slip | `0xe6822cb77d95f59798fba6560692fd4a7b62008465e29d72f2645cbc292426f4`, `body.rail = "gateway"` |
| the same through the hosted hub, 0.01 USDC | Offer `0x41536222…0ae0` (Circle's `use-usdc`, seller `0xA55a31E3…B093`, then payable on escrow, gateway and hedera) bought on `https://hub-production-e85e.up.railway.app`: Gateway transfer `196e409b-4855-4001-bafc-37ddbaa80076`, slip `0x84072e3e140597a1bc903538ccb223fb6eab4dcf4781e51269933f48f418c529`, `body.rail = "gateway"` |

First deployment, made with `forge script` and verified on the explorer. The same beats ran on it first.

| | |
|---|---|
| `CountersignedEscrow` | [`0x44d11b8909485e3f575F6628b689383E4420f54a`](https://explorer.testnet.arc.io/address/0x44d11b8909485e3f575F6628b689383E4420f54a) |
| release | [`0xaf13a37c…3243`](https://explorer.testnet.arc.io/tx/0xaf13a37c5488ece7ec512384132349490becee2b5618b1bcb8315b6f43c83243), slip `0x9df8dddc1dc7c61c3dcc27b4c68a32767763f0030bbd3697bba99d13c853ff6b`, `VALID` with the hub stopped |
| price moved, reverted | [`0x827ceca7…7b17`](https://explorer.testnet.arc.io/tx/0x827ceca74a4250afc742dac86439cdb84cc85fef6547d4b9a1147ad606c57b17) |
| deadline refund | [`0xc96b85a8…f60a`](https://explorer.testnet.arc.io/tx/0xc96b85a87895a05063314e77115eb653e0d097069f30a0c6e8699b3da107f60a) |

Escrow v2, deployed from `52b7c7c` on 07 Nov and verified on Blockscout. Production does not use it yet: the `escrow` rail still settles through `0x19c2…1b76` above.

| | |
|---|---|
| `CountersignedEscrow` v2 | [`0x10A3c07cc6A519C0106e315D2C42010eCbEFF3CE`](https://explorer.testnet.arc.io/address/0x10A3c07cc6A519C0106e315D2C42010eCbEFF3CE), deploy tx [`0x650b6fd9…1207`](https://explorer.testnet.arc.io/tx/0x650b6fd9eaab6c4c4988a773412e063cef230610104f975df7b433ff594c1207) |
| Read on chain | `arbiter()` the hub relayer `0xE37F64A73225f5eA06BABcb1cc5440F01446C267`, `token()` USDC `0x3600…0000`, `treasury()` the FeeSplit above, `tollBps()` 100 |

| Beat | Evidence |
|---|---|
| **A bonded seller fails to deliver, and the buyer gets the price plus the bond.** Run by `scripts/demo/prove-bonded-fail-delivery.ts`, not through the hub. The hub path, [#244](https://github.com/ss251/countersign/pull/244), is on `main` through promotion [#269](https://github.com/ss251/countersign/pull/269) (`cd3a005`) and deployed, but production's escrow is v1, so the path does not run yet. The payee sets a 0.01 USDC bond on a 0.01 USDC price and deposits it; the arbiter funds the job with the payee's `Lock`; the payee delivers nothing; the arbiter calls `failDelivery`. | terms [`0x61e17b6c…2b88`](https://explorer.testnet.arc.io/tx/0x61e17b6cac0ce44e722f94b6f86e6cdc2a247b293e3c8c902c71298ef7242b88), bond deposit [`0xdd6f0c52…93a6`](https://explorer.testnet.arc.io/tx/0xdd6f0c5245c89bee37ef1803e655feae9f7c130faee62b8fd5949d9f6b7393a6), fund [`0x55876211…4d68`](https://explorer.testnet.arc.io/tx/0x558762117125d76f2e35da7f3ef10e428c8397519cbbfe690eaaca87d9354d68), `failDelivery` [`0x973476ed…5e2d`](https://explorer.testnet.arc.io/tx/0x973476ed251384f84e33ddfc3deb97b10840da0e6410572a2a92c6edff8b5e2d): a transfer of 0.02 USDC from the escrow to the buyer, and the job reads `Failed` |

## Whitechain Sepolia (chain 1874)

See [whitechain.md](whitechain.md) for the full list.

Escrow v2, deployed from `52b7c7c` on 07 Nov and verified on Blockscout. Production's `whitechain` rail settles through it since 06 Nov 21:35Z, for unbonded jobs. The first purchase funded [`0x5f78…87e5`](https://explorer.testnet.whitechain.io/tx/0x5f78d37fe28f642aec1548745772e64522748a8308fa502c420b98ceb9f787e5) and released [`0x55f5…6a31`](https://explorer.testnet.whitechain.io/tx/0x55f569d40f9be0d2cbcc4de50fbaeac74c54cb2bf6d8700ecfea723f40e06a31). Its slip `0xb17f830162e819ad2f6ef16ca2ea652059c1e6288495bc71597065ef42ea8d70` is `VALID` with the chain read, and v2's `Released` event carries its hash.

| | |
|---|---|
| `CountersignedEscrow` v2 | [`0x55b3d98C17Ba0878DC93fB1521c76c9a10778391`](https://explorer.testnet.whitechain.io/address/0x55b3d98C17Ba0878DC93fB1521c76c9a10778391), deploy tx [`0xf15e1c98…9ae1`](https://explorer.testnet.whitechain.io/tx/0xf15e1c98547b7b475feae83319b71e176518580c244dff39fe32d1408c249ae1) |
| `FeeSplit` | [`0xB4930a8D096AE69dfA8DC305dA0427BE5B889b6c`](https://explorer.testnet.whitechain.io/address/0xB4930a8D096AE69dfA8DC305dA0427BE5B889b6c), deploy tx [`0x8612c6d7…9432`](https://explorer.testnet.whitechain.io/tx/0x8612c6d77bdfd1e316c99cbf10e77fa0872df2143a3e091e752c07c8ef639432) |
| Read on chain | `arbiter()` the relay key `0xa2EEfc657138eE5367291F8e2Ac45BAC28486006`, `token()` USDT `0xcedf…55a7`, `treasury()` the FeeSplit above, `tollBps()` 100 |

## Hedera testnet

See [hedera.md](hedera.md) for the full list.

## Tempo testnet, Moderato (chain 42431): the mpp rail

The `mppx` CLI paid 0.01 pathUSD from the project payer `0xEacEb7fD58157a39b6d4aF7A7Ca7A3AEba37486C` to the recipient `0xBfa03aCe72e48490C020Ab7CEe4beba2858f7231` through the localhost demo endpoint. Details are in [mpp.md](mpp.md).

| Route | Transaction | Receipt |
|---|---|---|
| `GET /paid` (mppx's handler) | [`0x254397b0…5df6`](https://explore.testnet.tempo.xyz/tx/0x254397b0afa7479e089948cddd58830b359b470d87dc96c56b71450f40d15df6), block 42848312 | `Payment-Receipt` status `success`; `reference` is the transaction |
| `GET /rail/paid` (countersign's `mpp` rail) | [`0xd525b18b…5c33`](https://explore.testnet.tempo.xyz/tx/0xd525b18b225c939c1ba9c819fb536e036fd0405f0090c2ded0aabaf519b35c33), block 42848372 | `Payment-Receipt` status `success`; `reference` is the transaction |
| `GET /rail/paid`, after the review fix (a nonce in every challenge) | [`0x4866e130…a89f`](https://explore.testnet.tempo.xyz/tx/0x4866e130e21972d08eb7c52eab353bb6259b0f9866621979682cef2179e3a89f), block 42856928 | `Payment-Receipt` status `success`; `reference` is the transaction |
