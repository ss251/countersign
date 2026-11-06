<!-- the latest human acceptance run; its own file is 20261106-235434-0867.md -->
# human e2e run 20261106-235434-0867

| | |
|---|---|
| run | `20261106-235434-0867` |
| commit | `a054a0f with local changes` |
| console | https://web-production-a58de.up.railway.app |
| hub | https://hub-production-e85e.up.railway.app |
| started | 2026-11-06 23:54:34 UTC |
| duration | 37.0 s |

## privy — PASS

wallet: `0x90Df63D400a7242A7026cb894E1dC1dA012572fE`

| step | status | duration |
|---|---|---|
| `00-open` | ok | 1.5 s |
| `01-sign-in` | ok | 6.7 s |
| `02-wallet` | ok | 492 ms |
| `03-fund` | ok | 2.1 s |
| `04-balance` | ok | 426 ms |
| `05-buy` | ok | 15.3 s |
| `06-prove` | ok | 2.2 s |
| `07-slip` | ok | 1.9 s |
| `08-return` | ok | 139 ms |
| `09-buyer` | ok | 866 ms |
| `10-envelope` | ok | 3.0 s |
| `11-envelope-tab` | ok | 322 ms |

Notes

- offer: use-arc 0.01USDC Sold by 0x6BE9…ca4a
- review payee: 0x6BE98051B852824A3923E3B27f9781Ceb0C0ca4a
- review amount: 10000
- review job: 0xed6cd64900447bca32e31ca342c60db9cccbb7d78cdd3c977221e59795f1053b
- escrow: 0x10A3c07cc6A519C0106e315D2C42010eCbEFF3CE
- the console rebuilt the terms at Sign: job 0xed6cd649… -> 0xa9e17554…
- envelope opened from the page's envelope card (the tab bar is phone-only)
- envelope: cap 1 USDC, per seller 0.5, ask above 0.05, expires in 22 h

Transactions

- funding: [`0xd716e1a4232e610bb28163d3e51c9467f9260e5ce621d524f9e411f4c25096bd`](https://explorer.testnet.arc.io/tx/0xd716e1a4232e610bb28163d3e51c9467f9260e5ce621d524f9e411f4c25096bd)
- escrow fund: [`0xb09ed43f922064bc331e9d005a20de4f3290e00ecd9f378ca0630b9590908537`](https://explorer.testnet.arc.io/tx/0xb09ed43f922064bc331e9d005a20de4f3290e00ecd9f378ca0630b9590908537)
- release: [`0xe34d563e3a1ca043b532fb8828efb0e6286463d65d034ceffb068fab3cbada86`](https://explorer.testnet.arc.io/tx/0xe34d563e3a1ca043b532fb8828efb0e6286463d65d034ceffb068fab3cbada86)

slip: `0xf77edbd180cb89d227c27727494faf0f52ae20c1fe67332ab6aa77a30e22f7fd`

verifier: VALID

Artifacts

- `artifacts/20261106-235434-0867/privy/console.log`
- `artifacts/20261106-235434-0867/privy/00-open.png`
- `artifacts/20261106-235434-0867/privy/01-sign-in.png`
- `artifacts/20261106-235434-0867/privy/01-privy-modal.png`
- `artifacts/20261106-235434-0867/privy/01-signed-in.png`
- `artifacts/20261106-235434-0867/privy/02-wallet.png`
- `artifacts/20261106-235434-0867/privy/03-fund.png`
- `artifacts/20261106-235434-0867/privy/04-balance.png`
- `artifacts/20261106-235434-0867/privy/05-buy.png`
- `artifacts/20261106-235434-0867/privy/05-review.png`
- `artifacts/20261106-235434-0867/privy/06-prove.png`
- `artifacts/20261106-235434-0867/privy/slip.json`
- `artifacts/20261106-235434-0867/privy/offer.json`
- `artifacts/20261106-235434-0867/privy/07-slip.png`
- `artifacts/20261106-235434-0867/privy/08-return.png`
- `artifacts/20261106-235434-0867/privy/09-buyer.png`
- `artifacts/20261106-235434-0867/privy/10-envelope.png`
- `artifacts/20261106-235434-0867/privy/11-envelope-tab.png`
