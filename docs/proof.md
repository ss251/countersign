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
| the same through the hosted hub, 0.01 USDC | Offer `0x41536222…0ae0` (Circle's `use-usdc`, seller `0xA55a31E3…B093`, payable on escrow, gateway and hedera) bought on `https://hub-production-e85e.up.railway.app`: Gateway transfer `196e409b-4855-4001-bafc-37ddbaa80076`, slip `0x84072e3e140597a1bc903538ccb223fb6eab4dcf4781e51269933f48f418c529`, `body.rail = "gateway"` |

First deployment, made with `forge script` and verified on the explorer. The same beats ran on it first.

| | |
|---|---|
| `CountersignedEscrow` | [`0x44d11b8909485e3f575F6628b689383E4420f54a`](https://explorer.testnet.arc.io/address/0x44d11b8909485e3f575F6628b689383E4420f54a) |
| release | [`0xaf13a37c…3243`](https://explorer.testnet.arc.io/tx/0xaf13a37c5488ece7ec512384132349490becee2b5618b1bcb8315b6f43c83243), slip `0x9df8dddc1dc7c61c3dcc27b4c68a32767763f0030bbd3697bba99d13c853ff6b`, `VALID` with the hub stopped |
| price moved, reverted | [`0x827ceca7…7b17`](https://explorer.testnet.arc.io/tx/0x827ceca74a4250afc742dac86439cdb84cc85fef6547d4b9a1147ad606c57b17) |
| deadline refund | [`0xc96b85a8…f60a`](https://explorer.testnet.arc.io/tx/0xc96b85a87895a05063314e77115eb653e0d097069f30a0c6e8699b3da107f60a) |

## Whitechain Sepolia (chain 1874)

See [whitechain.md](whitechain.md) for the full list.

## Hedera testnet

See [hedera.md](hedera.md) for the full list.
