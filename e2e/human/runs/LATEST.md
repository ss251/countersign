<!-- the latest human acceptance run; its own file is 20261106-231115-4052.md -->
# human e2e run 20261106-231115-4052

| | |
|---|---|
| run | `20261106-231115-4052` |
| commit | `bfe15e8 with local changes` |
| console | https://web-production-a58de.up.railway.app |
| hub | https://hub-production-e85e.up.railway.app |
| started | 2026-11-06 23:11:15 UTC |
| duration | 1m 8s |

## privy — PASS

wallet: `0x90Df63D400a7242A7026cb894E1dC1dA012572fE`

| step | status | duration |
|---|---|---|
| `00-open` | ok | 1.3 s |
| `01-sign-in` | ok | 6.1 s |
| `02-wallet` | ok | 365 ms |
| `03-fund` | ok | 2.1 s |
| `04-balance` | ok | 507 ms |
| `05-buy` | ok | 12.9 s |
| `06-prove` | ok | 2.5 s |
| `07-slip` | ok | 2.0 s |
| `08-return` | ok | 179 ms |
| `09-buyer` | ok | 903 ms |
| `10-envelope` | ok | 3.0 s |
| `11-envelope-tab` | ok | 108 ms |

Notes

- offer: use-arc 0.01USDC Sold by 0x6BE9…ca4a
- review payee: 0x6BE98051B852824A3923E3B27f9781Ceb0C0ca4a
- review amount: 10000
- review job: 0x2a177194c8a4f6733dd958d6eaed89d41a62be363072638eb3371c43345dd9b5
- escrow: 0x10A3c07cc6A519C0106e315D2C42010eCbEFF3CE
- the console rebuilt the terms at Sign: job 0x2a177194… -> 0xa0782848…
- envelope opened from the page's envelope card (the tab bar is phone-only)
- envelope: cap 1 USDC, per seller 0.5, ask above 0.05, expires in 22 h

Transactions

- funding: [`0x71b99bb49860949445514c6a592569ce507d19c7152ecfc813e616acd744e331`](https://explorer.testnet.arc.io/tx/0x71b99bb49860949445514c6a592569ce507d19c7152ecfc813e616acd744e331)
- escrow fund: [`0x5be8b915fa7609dbc970e59e7078268f3350089cc2112f4d629b49dfdc77db6d`](https://explorer.testnet.arc.io/tx/0x5be8b915fa7609dbc970e59e7078268f3350089cc2112f4d629b49dfdc77db6d)
- release: [`0xfc5e1778c76cf0c81aef0fcabd6c77c4df3e8d3b96e144a2280e0595671aa47d`](https://explorer.testnet.arc.io/tx/0xfc5e1778c76cf0c81aef0fcabd6c77c4df3e8d3b96e144a2280e0595671aa47d)

slip: `0x298ee50d86b314d7605455099645ba88662e0292d46414a00d91a5cb1a603b46`

verifier: VALID

Artifacts

- `artifacts/20261106-231115-4052/privy/console.log`
- `artifacts/20261106-231115-4052/privy/00-open.png`
- `artifacts/20261106-231115-4052/privy/01-sign-in.png`
- `artifacts/20261106-231115-4052/privy/01-privy-modal.png`
- `artifacts/20261106-231115-4052/privy/01-signed-in.png`
- `artifacts/20261106-231115-4052/privy/02-wallet.png`
- `artifacts/20261106-231115-4052/privy/03-fund.png`
- `artifacts/20261106-231115-4052/privy/04-balance.png`
- `artifacts/20261106-231115-4052/privy/05-buy.png`
- `artifacts/20261106-231115-4052/privy/05-review.png`
- `artifacts/20261106-231115-4052/privy/06-prove.png`
- `artifacts/20261106-231115-4052/privy/slip.json`
- `artifacts/20261106-231115-4052/privy/offer.json`
- `artifacts/20261106-231115-4052/privy/07-slip.png`
- `artifacts/20261106-231115-4052/privy/08-return.png`
- `artifacts/20261106-231115-4052/privy/09-buyer.png`
- `artifacts/20261106-231115-4052/privy/10-envelope.png`
- `artifacts/20261106-231115-4052/privy/11-envelope-tab.png`

## injected — PASS

wallet: `0x1916a0a26B47285d2036c1CC29Be8571Fa1ec93c`

| step | status | duration |
|---|---|---|
| `00-open` | ok | 1.4 s |
| `01-sign-in` | ok | 2.6 s |
| `02-wallet` | ok | 175 ms |
| `03-fund` | ok | 1.7 s |
| `04-balance` | ok | 502 ms |
| `05-buy` | ok | 22.3 s |
| `06-prove` | ok | 2.0 s |
| `07-slip` | ok | 1.9 s |
| `08-return` | ok | 1.5 s |

Notes

- offer: use-arc 0.01USDC Sold by 0x6BE9…ca4a
- review payee: 0x6BE98051B852824A3923E3B27f9781Ceb0C0ca4a
- review amount: 10000
- review job: 0xaa90cb1b2aee58f7183f17e7c39d4cc0abee8f99d6aaa68a6eb12ed8c4d41e8b
- escrow: 0x10A3c07cc6A519C0106e315D2C42010eCbEFF3CE
- the console rebuilt the terms at Sign: job 0xaa90cb1b… -> 0x4f02b035…

Transactions

- funding: [`0x3718595beee6ac36a57c3780d35517bb997d311bdfa06c25a79bbee0823d6a34`](https://explorer.testnet.arc.io/tx/0x3718595beee6ac36a57c3780d35517bb997d311bdfa06c25a79bbee0823d6a34)
- escrow fund: [`0xa9ee5c7287f7897741faec13f33af8600b7424b584f1a290235c851a81b22a69`](https://explorer.testnet.arc.io/tx/0xa9ee5c7287f7897741faec13f33af8600b7424b584f1a290235c851a81b22a69)
- release: [`0x6dd59563d0a501a70606f5f1ab9080d784b5eb6035fd9055431c0d3993fda395`](https://explorer.testnet.arc.io/tx/0x6dd59563d0a501a70606f5f1ab9080d784b5eb6035fd9055431c0d3993fda395)

slip: `0xd281a12e57fa58f2f6c39cf43ab82e7a7b60470861a957e62ca35d96760a214a`

verifier: VALID

Artifacts

- `artifacts/20261106-231115-4052/injected/00-open.png`
- `artifacts/20261106-231115-4052/injected/01-sign-in.png`
- `artifacts/20261106-231115-4052/injected/02-wallet.png`
- `artifacts/20261106-231115-4052/injected/03-fund.png`
- `artifacts/20261106-231115-4052/injected/04-balance.png`
- `artifacts/20261106-231115-4052/injected/05-buy.png`
- `artifacts/20261106-231115-4052/injected/05-review.png`
- `artifacts/20261106-231115-4052/injected/06-prove.png`
- `artifacts/20261106-231115-4052/injected/slip.json`
- `artifacts/20261106-231115-4052/injected/offer.json`
- `artifacts/20261106-231115-4052/injected/07-slip.png`
- `artifacts/20261106-231115-4052/injected/08-return.png`
- `artifacts/20261106-231115-4052/injected/trace.zip`
