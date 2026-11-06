<!-- the latest human acceptance run; its own file is 20261106-192916-e0f5.md -->
# human e2e run 20261106-192916-e0f5

| | |
|---|---|
| run | `20261106-192916-e0f5` |
| commit | `26d6f76` |
| console | https://web-production-a58de.up.railway.app |
| hub | https://hub-production-e85e.up.railway.app |
| started | 2026-11-06 19:29:16 UTC |
| duration | 29.9 s |

## privy — PASS

wallet: `0x90Df63D400a7242A7026cb894E1dC1dA012572fE`

| step | status | duration |
|---|---|---|
| `00-open` | ok | 1.4 s |
| `01-sign-in` | ok | 4.4 s |
| `02-wallet` | ok | 125 ms |
| `03-fund` | ok | 2.2 s |
| `04-balance` | ok | 374 ms |
| `05-buy` | ok | 15.4 s |
| `06-prove` | ok | 1.7 s |
| `07-slip` | ok | 2.5 s |
| `08-return` | ok | 88 ms |

Notes

- offer: use-arc 0.01USDC Sold by 0x6BE9…ca4a
- review payee: 0x6BE98051B852824A3923E3B27f9781Ceb0C0ca4a
- review amount: 10000
- review job: 0x1ea68a73417b2ca0956cc61f8f0f8a348af087cb5f625bbed2022a89629c1957

Transactions

- funding: [`0xd37da78cf49d3acf427dcb41120000126a79e7e10ec9da8ed3a1508c6473e463`](https://explorer.testnet.arc.io/tx/0xd37da78cf49d3acf427dcb41120000126a79e7e10ec9da8ed3a1508c6473e463)
- escrow fund: [`0x0c1eef1b874464c131079d74717cbe1b1524bf976a546e1407d107c251ba30ed`](https://explorer.testnet.arc.io/tx/0x0c1eef1b874464c131079d74717cbe1b1524bf976a546e1407d107c251ba30ed)
- release: [`0xc331f38dc4a65fc6d1231a9a1cb5289d2ba2b0aee42a66a710668b535cbe523b`](https://explorer.testnet.arc.io/tx/0xc331f38dc4a65fc6d1231a9a1cb5289d2ba2b0aee42a66a710668b535cbe523b)

slip: `0x7d2d52fe2125141f70aeb20e844fcec474f2c33ffba25a6059cd35f6c791532d`

verifier: VALID

Artifacts

- `artifacts/20261106-192916-e0f5/privy/console.log`
- `artifacts/20261106-192916-e0f5/privy/00-open.png`
- `artifacts/20261106-192916-e0f5/privy/01-sign-in.png`
- `artifacts/20261106-192916-e0f5/privy/01-privy-modal.png`
- `artifacts/20261106-192916-e0f5/privy/01-signed-in.png`
- `artifacts/20261106-192916-e0f5/privy/02-wallet.png`
- `artifacts/20261106-192916-e0f5/privy/03-fund.png`
- `artifacts/20261106-192916-e0f5/privy/04-balance.png`
- `artifacts/20261106-192916-e0f5/privy/05-buy.png`
- `artifacts/20261106-192916-e0f5/privy/05-review.png`
- `artifacts/20261106-192916-e0f5/privy/06-prove.png`
- `artifacts/20261106-192916-e0f5/privy/slip.json`
- `artifacts/20261106-192916-e0f5/privy/offer.json`
- `artifacts/20261106-192916-e0f5/privy/07-slip.png`
- `artifacts/20261106-192916-e0f5/privy/08-return.png`
