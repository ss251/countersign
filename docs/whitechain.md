# Whitechain

How countersign runs on Whitechain Sepolia: network facts, the USDT it settles in, how the gas relayer pays for the buyer, and how contracts get verified. Every value below was read from the chain or the explorer on 2026-11-06, not copied from a list.

## Why this needs onchain settlement

For the README, in one line:

> The buyer is software, so the payment has to enforce itself. On Whitechain a USDT payment refuses to settle at a price the buyer did not sign, waits in escrow until the work is delivered, returns itself when a deadline passes with no dispute desk, and leaves a public record the customer can check without trusting us. A card network cannot bind a payment to an offer hash, release it on a delivery receipt, or settle a five-cent call in a second. With the relayer paying gas, neither the customer nor the merchant ever holds WBT.

## What the merchant and the customer each get

- **Customer:** signs one authorisation and never sees gas, a seed phrase or a chain picker. Any payment or refund can be checked on the explorer, or on the receipt page at `#/merchant/receipt/<order id>`.
- **Merchant:** sees every order at `#/merchant` as it settles. Refunds an order in one click: a held escrow order is cancelled, and a paid order is sent back as a gasless USDT transfer. Exports a CSV for the accountant. Never holds WBT.
- **Business side of gas:** the relayer holds the WBT. Half of every escrow toll flows back to it through `FeeSplit`. The guards in [What stops the relayer being drained](#what-stops-the-relayer-being-drained) bound what anyone can make it spend.

The merchant desk reads a seller's orders from the hub (`GET /orders?seller=`). When the hub does not serve that route or does not answer, it reads the Whitechain relay's records instead and says so on the page. Production runs the Whitechain rail: its hub reaches the relay hosted alone on Railway (see [Hosting the relay](#hosting-the-relay), which also holds the first paid call through production). Refunds go through the merchant's own service (`packages/relay/src/merchant-server.ts`), which runs on the merchant's machine, so the public console shows orders but cannot refund them. The earlier payments, refunds and export below ran on the build machine.

## Network

| | |
|---|---|
| Name | Whitechain Sepolia (OP Stack L2 on Ethereum Sepolia) |
| Chain ID | `1874` (`0x752`) |
| RPC | `https://rpc.testnet.whitechain.io` — public, no key, 50 rps sustained / 500 burst per IP, `429` with `Retry-After: 1` past that |
| RPC, second | `https://rpc.ankr.com/whitechain_testnet` (Ankr, also answers `1874`) |
| RPC trap | `https://rpc-testnet.whitechain.io`, with a hyphen, is the **old testnet, chain 2625**. It answers every query and reports zero balances for our addresses. Never use it. The relay checks `eth_chainId` at startup and refuses to run on anything but `1874`. |
| WebSocket | `wss://rpc.testnet.whitechain.io/ws` |
| Explorer | `https://explorer.testnet.whitechain.io` (Blockscout) |
| Explorer API | `https://explorer.testnet.whitechain.io/api/v2` (REST) and `/api` (Etherscan-compatible) |
| Gas token | WBT, 18 decimals |
| Block time | 1 s |
| Base fee seen | 5 gwei; block gas limit 40,000,000 |
| Highest EVM target | `prague`. Our contracts compile for `cancun` (see `docs/decisions.md` D3) |

## Settlement token: USDT

The token is `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7`. Every Whitechain payment in countersign settles in it.

| | |
|---|---|
| Name / symbol | `Tether USD` / `USDT` |
| Decimals | 6 |
| Shape | EIP-1967 proxy → `TetherTokenV2` at `0x26425662D126412128967ECf0a02EC48573026F7` (verified, solc 0.8.4) |
| Minter | `USDTBridge` proxy `0x8790832Ba493Cc16a4dBC5c961B0C4950632799c` mints on bridge-in; there is no public mint |
| EIP-712 domain | name `Tether USD`, version `1`, chainId `1874`, verifyingContract = the proxy |
| `DOMAIN_SEPARATOR()` | `0xcdcfacb6b15c8238b4e5fbb47bdb83b7f83f50a531d264bf9763d2bd1d3d2a25` |
| EIP-3009 | `transferWithAuthorization`, `receiveWithAuthorization` (both `v,r,s` and `bytes signature` overloads), `cancelAuthorization`, `authorizationState` |
| EIP-2612 | `permit` |

`version()` and `eip712Domain()` both revert on this token. The version `1` above comes from recomputing `DOMAIN_SEPARATOR()` for each candidate and matching it. Arc's USDC uses version `2`, so the rail must pass the version per chain rather than assume one.

The typehashes are the standard EIP-3009 ones:

- `TRANSFER_WITH_AUTHORIZATION_TYPEHASH` `0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267`
- `RECEIVE_WITH_AUTHORIZATION_TYPEHASH` `0xd099cc98ef71107a616c4f0f941f04c322d8e254fe26b3c6668db87aae413de8`
- `CANCEL_AUTHORIZATION_TYPEHASH` `0x158b0a9edf7a828aad02f63cd515c68ef2f50ba807396f6d12842833a1597429`

Don't confuse it with the "USDT" entry in Whitechain's published token list. That one is `0xaa7962d073935D387e8d442DA1D7149C81388f46`, which reports itself as `USDT.e` (Portal-bridged from Tron). It is not the token the event's prizes require.

## Getting test funds

- **WBT:** `https://faucet.testnet.whitechain.io`. A human has to sign in with GitHub (account at least 30 days old) and pass a Cloudflare captcha, so no script can claim. You get one claim per rolling 24 hours, limited separately by address, IP and GitHub account. The docs say 0.5 WBT per claim; the faucet's own `/api/info` reports a payout of `2`.
- **USDT:** there is no faucet. A Uniswap v3 WWBT/USDT pool runs on testnet, so test WBT can buy test USDT:
  - pool `0x5645101Ca8d2F7BaBC27b10359555767a1BdF999`, fee 0.3%;
  - factory `0x94aFa2aB80E44163362D2952bdf1E95b81900738`;
  - `SwapRouter02` `0xe208cC685cD95D56E8ec6DEC9816476567fc6962`;
  - WWBT `0x4200000000000000000000000000000000000006`.

  On 2026-11-06 the pool priced 1 WBT at about 73 USDT.

## Lane addresses

These are fresh keys made for this project. The private keys live only in `~/.config/countersign/wc.env` (mode 0600) and never appear in argv, logs or git.

| Role | Address | Holds |
|---|---|---|
| deployer | `0xca4Fde0786758681d083E6515C7E3584BE75D11C` | WBT for deploys |
| relayer | `0xa2EEfc657138eE5367291F8e2Ac45BAC28486006` | WBT for every buyer and merchant call |
| merchant | `0xd5882dBC7D41fBcf8ae0B05E9eAc1cbe93d6C71c` | USDT it was paid, never WBT |
| buyer | `0xcb39cEfBF97d1FE8b0606f25721F6F9E32924298` | USDT only, never WBT |

### How the lane wallets were funded

The relayer is the only wallet that ever gets WBT from outside, and it pays for everything after that. Buyers get no WBT at any point.

| When (UTC) | What | Tx |
|---|---|---|
| 2026-11-06 09:27 | relayer receives 1.9 WBT | [`0xd41d2ecd…9779`](https://explorer.testnet.whitechain.io/tx/0xd41d2ecd6aa2a8bd5d173a51b331bddc8b46cf47c078a70a8b5f1c0703e97779) |
| 2026-11-06 09:33 | relayer swaps 0.2 WBT for 14.664556 USDT, paid to the buyer (`BuyTestUsdt.s.sol`) | [`0x0c1bb12a…0301`](https://explorer.testnet.whitechain.io/tx/0x0c1bb12ac1af1e49f4285703a8c1f23b67391601857548c64484818226bb0301) |
| 2026-11-06 09:34 | relayer sends 0.1 WBT to the deployer (`TopUpWbt.s.sol`) | [`0xdf4ab567…935b`](https://explorer.testnet.whitechain.io/tx/0xdf4ab567d18958c673c423ed9df7622e22ffd046d8640262ecf2808b20b8935b) |
| 2026-11-06 09:54 | relayer swaps 0.02 WBT for 1.46572 USDT, paid to the merchant as a refund float. After release the merchant holds the price minus the 1% toll, but a full refund returns the whole price | [`0x5c7d0b07…c0e`](https://explorer.testnet.whitechain.io/tx/0x5c7d0b0709cb83bc1452278fdc789e02e9aa6de645d70ccf2c059c87437c8c0e) |

Both scripts read keys from the environment through `vm.envUint`, so a key never appears in a command line:

```
set -a; . ~/.config/countersign/wc.env; set +a
WC_SWAP_SIGNER=RELAYER WC_SWAP_RECIPIENT=$WC_BUYER_ADDRESS WC_SWAP_WBT_WEI=200000000000000000 WC_SWAP_MIN_USDT=13500000 \
  forge script contracts/script/whitechain/BuyTestUsdt.s.sol:BuyTestUsdt --rpc-url https://rpc.testnet.whitechain.io --broadcast --slow
```

## Payments on chain

Every payment below was settled in USDT `0xcedf…55a7` through the relay (`packages/relay`). That relay is the x402 facilitator countersign runs for Whitechain. Neither the buyer nor the merchant has ever held WBT: the relayer paid every gas fee.

| When (UTC) | What | Tx |
|---|---|---|
| 2026-11-06 09:41 | Buyer `0xcb39…4298` pays merchant `0xd588…C71c` 0.25 USDT with x402 `exact`, one EIP-3009 signature, no gas | [`0x4dc46065…42bc`](https://explorer.testnet.whitechain.io/tx/0x4dc460652c20607ee4a16f699c90f3a0bb94b3ce3696099932cbeb1d95fd42bc) |
| 2026-11-06 09:42 | Merchant refunds the full 0.25 USDT in one click. The merchant signs an EIP-3009 transfer back, and the relay pays its gas | [`0x565830d7…88e5`](https://explorer.testnet.whitechain.io/tx/0x565830d7a63f64b7ab3c910b2063345f3d75695d6405d4ffb5495d53e79388e5) |
| 2026-11-06 09:49 | Buyer pays 0.30 USDT into the countersign escrow with x402 `countersign`. One `ReceiveWithAuthorization` signature binds offer, payee, amount and deadline. Job `0xd3247aa4…8e7e` | [`0x3e82355d…2447`](https://explorer.testnet.whitechain.io/tx/0x3e82355da37166f668d4bc1c428d8b03a262915ef2a856ebb10b1423b89e2447) |
| 2026-11-06 09:50 | Merchant refunds the held order in one click. The merchant signs `Cancel(jobId)`, the relay submits `cancel`, and the escrow returns the full 0.30 USDT with no toll | [`0x1e99d1ac…c5d9`](https://explorer.testnet.whitechain.io/tx/0x1e99d1aceab0ddfcebc3f91e6c6650c0c9214f737552382ff68098704cfec5d9) |

| 2026-11-06 10:09 | An AI agent buys a forecast from a separate shop app over x402, with no gas, no seed phrase and no chain choice. The shop adds a USDT price to one route with `whitechainPaywall` (`packages/relay/examples/shop.ts`, 23 lines). The agent pays with `createPayFetch` under a per-call limit (`packages/relay/examples/agent.ts`, 17 lines). 0.05 USDT | [`0x1c366946…5f07`](https://explorer.testnet.whitechain.io/tx/0x1c366946e8dc6e1256e16880c9345b2cb84613fd5cef920f2214ae840b475f07) |

### The main flow, through the hub

The same hub code as `apps/hub`, run with the `whitechain` rail (`packages/relay/scripts/whitechain-hub.ts`). The seller runner serves `whitechain-dev`, the Whitechain skill, under the merchant's key. The buyer agent buys it under its envelope (2 USDT budget, 1 per seller), with no human step and no gas.

| When (UTC) | What | Tx |
|---|---|---|
| 2026-11-06 10:13 | Buyer funds the escrow for `whitechain-dev`, 0.05 USDT, job `0x01a66ebc…b231` | [`0x415bddc8…b08c`](https://explorer.testnet.whitechain.io/tx/0x415bddc897b459a2d2342809e1a2621ac3999ca1d5812b3670b563fce504b08c) |
| 2026-11-06 10:13 | Runner delivers and the hub checks the output against the offer's schema. The relay then releases: 0.0495 USDT to the merchant, 0.0005 to `FeeSplit`. `Released` carries the slip hash `0x7f69ea83…df6c` | [`0x90ed826a…c812`](https://explorer.testnet.whitechain.io/tx/0x90ed826a41f21290db924e4afc1e06bffe806e2966d8582618a074efa0c3c812) |
| 2026-11-06 10:18 | An earlier call asked for a section the skill does not have. The runner refused, the hub refused the delivery, and once the deadline passed the hub's janitor refunded the full 0.05 USDT through the relay. No one decided anything | [`0xebf26b54…a7a2`](https://explorer.testnet.whitechain.io/tx/0xebf26b543f81853ef12824ada9fb1096dac25d03a39986a4d5e2abe44228a7a2) |

The same purchase also runs through the **main hub**, once that hub has `WC_RELAY_URL` set. On the day below it declared four rails: escrow on Arc, whitechain, gateway and hedera. Since main 7565080 it declares escrow, whitechain and hedera-scheduled:

| When (UTC) | What | Tx |
|---|---|---|
| 2026-11-06 10:57 | Buyer funds `whitechain-dev` through the main hub, 0.05 USDT, job `0x32088a56…a53e` | [`0x7743ce20…ddbf`](https://explorer.testnet.whitechain.io/tx/0x7743ce200d4cdbda262f0ca1879119cd5c0cf4480b47b1fb37ae6226e533ddbf) |
| 2026-11-06 10:57 | The escrow releases with slip hash `0x96c3a275…b427` | [`0x15535057…9bf7`](https://explorer.testnet.whitechain.io/tx/0x15535057c9a69560eca1bd189bdd15dc44be5349627eca9f7217a44af62e9bf7) |
| 2026-11-06 10:58 | The merchant refunds the order in one click. The full 0.05 USDT goes back and the merchant absorbs the toll | [`0xba2f82ea…0b6f`](https://explorer.testnet.whitechain.io/tx/0xba2f82eaa95415f48b1178937252709b9348f144012bc9979ae945d9fb940b6f) |

`packages/verify` passes all six checks on that slip: hash, seller, terms, countersignature, the known Whitechain escrow, and `Released(job, slip)` on chain in block 12366264.

The slip was checked with the hub stopped, reading chain 1874 through `https://rpc.ankr.com/whitechain_testnet`. All five checks passed: hash, seller, terms, countersignature, and on chain, where `Released(job, slip)` comes from escrow `0x9279…7eb4` in block 12363646.

```
bun packages/verify/src/cli.ts slip.json --rpc https://rpc.ankr.com/whitechain_testnet
...
ok   onchain           Released(job, slip) by 0x9279D3edeef4c3738a0b200D762e2985Ff3B7eb4 in block 12363646
VALID
```

### The drop-in, in about 20 lines each side

A business that wants USDT on Whitechain for an API adds one middleware to a route:

```ts
app.get("/forecast",
  whitechainPaywall({ price: "0.05", payTo: MERCHANT, facilitator: "http://127.0.0.1:8402" }),
  (c) => c.json(forecast()));
```

The agent that pays wraps `fetch` once, with its own spend limits. Every call over the limit is refused before anything is signed:

```ts
const pay = createPayFetch({ account, maxPerCall: "0.10", budget: "5.00" });
const res = await pay("https://shop.example/forecast");   // 402 -> signs one EIP-3009 authorisation -> 200
```

Verification and settlement go through the relay, the facilitator countersign runs. The relay pays the gas, so neither side ever holds WBT.

To reproduce, run the relay, the merchant's server and the buyer, each with only its own key in its environment:

```
# relay (holds WBT, pays gas)       -> :8402
( set -a; . ~/.config/countersign/wc.env; set +a; unset WC_DEPLOYER_PRIVATE_KEY WC_MERCHANT_PRIVATE_KEY WC_BUYER_PRIVATE_KEY
  exec bun run packages/relay/src/server.ts )
# merchant's own backend (holds the merchant key, signs refunds) -> :8403
( set -a; . ~/.config/countersign/wc.env; set +a; unset WC_DEPLOYER_PRIVATE_KEY WC_RELAYER_PRIVATE_KEY WC_BUYER_PRIVATE_KEY
  RELAY_URL=http://127.0.0.1:8402 exec bun run packages/relay/src/merchant-server.ts )
# buyer pays 0.25 USDT, then the merchant refunds it
( set -a; . ~/.config/countersign/wc.env; set +a; bun run packages/relay/scripts/pay-exact.ts --amount 0.25 )
curl -X POST http://127.0.0.1:8403/refund/<settlement tx>
curl http://127.0.0.1:8403/payments.csv
```

A local relay must not sign with the hosted relay's key while the hosted one runs, or the two race on nonces. Give a local relay a key of its own.

## Hosting the relay

Production's relay runs alone on Railway as the service `whitechain-relay`, at `https://whitechain-relay-production.up.railway.app`. `deploy/railway/deploy-relay.sh` builds it from an exact commit with `deploy/railway/relay.Dockerfile`, using `git archive`, so nothing local goes in. The production hub reaches it through `WC_RELAY_URL`, and `/rails` lists `whitechain` on `eip155:1874`. The hub holds no Whitechain key.

| Variable | Value |
|---|---|
| `WC_RELAYER_PRIVATE_KEY` | A Railway secret, set once with `railway variable set WC_RELAYER_PRIVATE_KEY --stdin`, never in argv |
| `RELAY_PAYEES` | The merchant only, `0xd5882dBC7D41fBcf8ae0B05E9eAc1cbe93d6C71c` |
| `RELAY_CAP_WEI_PER_HOUR` | `50000000000000000`, the hourly ceiling of 0.05 WBT. The defaults of 200 transactions and 30 per payer also apply |
| `WHITECHAIN_RPC_URLS` | `https://rpc.ankr.com/whitechain_testnet` |
| `RELAY_DB` | `/data/relay.sqlite`, on the service's volume |
| `PORT`, `RELAY_PORT` | `8402` |
| `RELAY_URL` | Its own public URL |

`GET /status` on that URL shows the signer, the pinned payees and how much of the hourly ceiling is used.

**The first paid call through production** was on 2026-11-06. The merchant's runner published `whitechain-dev` at 0.01 USDT on the `whitechain` rail, and a buyer agent holding no WBT bought it through the production hub. The hosted relay sent both transactions:

| Step | Transaction |
|---|---|
| Fund: 0.01 USDT moves from the buyer into the escrow | [`0x1d45e70f…1e73`](https://explorer.testnet.whitechain.io/tx/0x1d45e70ff0ac33d9fee2b503f7acb22370a107232a98eb3d7afa7b7d4d321e73) |
| Release: 0.0099 USDT goes to the merchant and a 0.0001 toll to the FeeSplit | [`0xd60dd634…5971`](https://explorer.testnet.whitechain.io/tx/0xd60dd634a1b326947ef855eee129cf7f994f0c6fdd5b58843f3d5310fdcc5971) |

The offer is online only while the merchant's runner is running. The runner is the seller's own process, not part of the hosted service.

## What stops the relayer being drained

The relayer pays gas for strangers, so every call goes through `Relayer.submit` (`packages/relay/src/relayer.ts`), which applies these checks in order. Each refusal happens before anything is broadcast:

1. **Allowlist.** It only ever calls the USDT token's `transferWithAuthorization` and the countersign escrow. Arbitrary calldata is never accepted.
2. **Simulation first.** A call that would revert is refused before it is sent, so a bad signature, a spent nonce or an empty balance costs the relayer nothing.
3. **Fee cap.** Nothing is sent while the network asks more than `RELAY_MAX_FEE_GWEI` (default 50 gwei).
4. **Hourly ceiling.** The worst-case cost of each call is reserved against a rolling one-hour budget before it is sent. The defaults are 0.05 WBT, 200 transactions, and 30 per payer. A call past any of them is refused with `relay_ceiling_reached`. `GET /status` shows what is used and what remains.
5. **Balance floor.** The relayer never spends below `RELAY_MIN_BALANCE_WEI` (default 0.02 WBT). Past that it answers `relay_balance_low`.
6. **One transaction at a time.** Submissions are serialised, so nonces never race and a burst cannot fan out.
7. **Refunds must point at a real payment.** The refund path only carries a transfer that runs from a recorded payment's merchant back to that payment's payer, for no more than what is still refundable. It cannot be used as a free transfer service.

The relay also refuses to start if its RPC does not answer as chain 1874.

**What a call costs the relayer.** These are the fees the explorer reports at the 5 gwei base fee:

| Call | Fee |
|---|---|
| EIP-3009 transfer (exact payment or refund) | 0.00051 WBT |
| escrow `fund` | 0.00108 WBT |
| escrow `cancel` | 0.00033 WBT |

One faucet drip of about 1.5 WBT therefore pays for roughly 1,400 to 3,000 customer calls.

**Where the relayer's WBT comes from.** Today it comes from the testnet faucet. On every escrow payment, half of the 1% toll goes through `FeeSplit` to the relayer's address. The business's fee pays for the gas, and the relayer can swap that USDT for WBT on the same pool.

## Verifying contracts

Blockscout takes Foundry's `blockscout` verifier on the Etherscan-compatible endpoint:

```
forge verify-contract <address> contracts/src/CountersignedEscrow.sol:CountersignedEscrow \
  --chain 1874 --verifier blockscout \
  --verifier-url https://explorer.testnet.whitechain.io/api/ \
  --constructor-args <abi-encoded args>
```

The REST API also accepts `standard-input`, `multi-part` and `flattened-code` at `POST /api/v2/smart-contracts/{address}/verification/via/<method>`; `contract_name` is required there. `v0.8.28+commit.7893614a` and the `cancun` EVM target are both on the explorer's list. Poll `GET /api/v2/smart-contracts/{address}` until `is_verified` is true.

## Deployments

Both contracts were deployed by `DeployWhitechain.s.sol` on 2026-11-06 and verified on Blockscout in the same run (`--verify --verifier blockscout`): solc 0.8.28, cancun, 200 optimizer runs. The machine-readable record is `contracts/deployments/whitechain-sepolia.json`.

| Contract | Address | Deploy tx |
|---|---|---|
| CountersignedEscrow | [`0x9279D3edeef4c3738a0b200D762e2985Ff3B7eb4`](https://explorer.testnet.whitechain.io/address/0x9279D3edeef4c3738a0b200D762e2985Ff3B7eb4) | [`0x256544f7…303c`](https://explorer.testnet.whitechain.io/tx/0x256544f7d967714fd5efa02e04c95ba6512c004d20742ba08ec1532f7247303c) |
| FeeSplit (the escrow's treasury) | [`0xeaDfF48cdF0b44FbF22e512b7ece1830E473725F`](https://explorer.testnet.whitechain.io/address/0xeaDfF48cdF0b44FbF22e512b7ece1830E473725F) | [`0x0f3309ca…2a6a`](https://explorer.testnet.whitechain.io/tx/0x0f3309ca5193279ade7333e2bba97d285d738cb07e8516fd11b897651bb92a6a) |

- Escrow token: USDT `0xcedf…55a7`. Toll: 100 bps (1%), fixed at deploy, with no owner who could change it.
- Escrow EIP-712 domain: `{ name: "Countersign", version: "1", chainId: 1874, verifyingContract: <escrow> }`, separator `0x04e836f1dcf972a17d79a66f67763c7c9a67bd5af92e6182d5677bae9236ab3f`.
- FeeSplit sends 50% of every toll to the relayer and 50% to the deployer. The relayer's half is how the business side pays for gas: the toll accrues in USDT, and the relayer can swap it for WBT on the same pool the buyer's USDT came from.

Before deploying, `EscrowForkCheck.s.sol` ran the escrow against the real TetherTokenV2 in a local simulation of chain 1874, broadcasting nothing. These all held:

- fund then release, with 99% to the payee and 1% to the treasury;
- a replayed countersignature is refused;
- a settlement at a moved price is refused before any money moves;
- the payee's cancel through a relayer returns the full amount;
- a stranger's refund after the deadline returns the full amount.

```
forge script contracts/script/whitechain/EscrowForkCheck.s.sol --fork-url https://rpc.testnet.whitechain.io
```

## Demo beat, 45 seconds: the refund and the gasless payer

Show the artifact first. Every step below runs against live Whitechain Sepolia.

1. **The payer.** The buyer agent buys `whitechain-dev` through the hub on rail `whitechain`. Its envelope approves the 0.05 USDT. There is no gas prompt, no seed phrase and no chain to pick. The terminal prints `Released. Slip minted.`
2. **The merchant.** The order appears on `#/merchant` within 2.5 s and briefly highlights in blue. It shows as **Paid**, with its **Received** time, and the line above the table says the relayer paid the gas.
3. **The refund.** Click **Refund** on that row. A four-second **Undo** window runs out, then the row reads `Refunded. 0.05 USDT returned to 0xcb39…4298.` Its explorer link opens a USDT transfer from the merchant back to the customer, with the gas paid by the relayer.
4. **The customer's record.** Open **View receipt** on a phone. It shows the status, the amount, the returned line, and proof links that open on the explorer without countersign.
5. **The accountant.** Click **Export for accountant**. The CSV opens with fees, refunds and net per order.

Closing line: *"Every payment and every refund is USDT on Whitechain, and nobody but the relayer ever held WBT."*
