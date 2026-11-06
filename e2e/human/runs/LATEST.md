<!-- the latest human acceptance run; its own file is 20261106-194755-5804.md -->
# human e2e run 20261106-194755-5804

| | |
|---|---|
| run | `20261106-194755-5804` |
| commit | `7e2dc4b with local changes` |
| console | https://web-production-a58de.up.railway.app |
| hub | https://hub-production-e85e.up.railway.app |
| started | 2026-11-06 19:47:55 UTC |
| duration | 26.8 s |

## privy — PASS

wallet: `0x90Df63D400a7242A7026cb894E1dC1dA012572fE`

| step | status | duration |
|---|---|---|
| `00-open` | ok | 1.3 s |
| `01-sign-in` | ok | 5.7 s |
| `02-wallet` | ok | 162 ms |
| `03-fund` | ok | 1.8 s |
| `04-balance` | ok | 382 ms |
| `05-buy` | ok | 12.6 s |
| `06-prove` | ok | 1.7 s |
| `07-slip` | ok | 1.9 s |
| `08-return` | ok | 156 ms |

Notes

- offer: use-arc 0.01USDC Sold by 0x6BE9…ca4a
- review payee: 0x6BE98051B852824A3923E3B27f9781Ceb0C0ca4a
- review amount: 10000
- review job: 0xe83ec7d8854a05a8b0f56238d1549269ea4d28ab78ac3ace9813deb35e4904a9

Transactions

- funding: [`0xf1da77449696b8b9d88599a36d5d91755161a635ccc56aeb19d6f4a9044ea88b`](https://explorer.testnet.arc.io/tx/0xf1da77449696b8b9d88599a36d5d91755161a635ccc56aeb19d6f4a9044ea88b)
- escrow fund: [`0x08d369df95c681dccc3a44db6c68771baab9b800898f5ddd8d030b20e05a18bf`](https://explorer.testnet.arc.io/tx/0x08d369df95c681dccc3a44db6c68771baab9b800898f5ddd8d030b20e05a18bf)
- release: [`0x8b06e32716383841de6f0a473c978e56623a48fb0f98837fa2fe9e959542585f`](https://explorer.testnet.arc.io/tx/0x8b06e32716383841de6f0a473c978e56623a48fb0f98837fa2fe9e959542585f)

slip: `0x835c75470e4b16d91c6d3998966ecc1b99c815578ea5f8c7b6d8f749d977346e`

verifier: VALID

Artifacts

- `artifacts/20261106-194755-5804/privy/console.log`
- `artifacts/20261106-194755-5804/privy/00-open.png`
- `artifacts/20261106-194755-5804/privy/01-sign-in.png`
- `artifacts/20261106-194755-5804/privy/01-privy-modal.png`
- `artifacts/20261106-194755-5804/privy/01-signed-in.png`
- `artifacts/20261106-194755-5804/privy/02-wallet.png`
- `artifacts/20261106-194755-5804/privy/03-fund.png`
- `artifacts/20261106-194755-5804/privy/04-balance.png`
- `artifacts/20261106-194755-5804/privy/05-buy.png`
- `artifacts/20261106-194755-5804/privy/05-review.png`
- `artifacts/20261106-194755-5804/privy/06-prove.png`
- `artifacts/20261106-194755-5804/privy/slip.json`
- `artifacts/20261106-194755-5804/privy/offer.json`
- `artifacts/20261106-194755-5804/privy/07-slip.png`
- `artifacts/20261106-194755-5804/privy/08-return.png`
