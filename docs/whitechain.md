# Whitechain

How countersign runs on Whitechain Sepolia: network facts, the USDT it settles in, how the gas relayer pays for the buyer, and how contracts get verified. Every value below was read from the chain or the explorer on 2026-11-06, not copied from a list.

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
| Highest EVM target | `prague`. Our contracts compile for `paris` (see `docs/decisions.md` D3) |

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

**Where the relayer's WBT comes from.** Today it comes from the testnet faucet. On every escrow payment, half of the 1% toll goes through `FeeSplit` to the relayer's address. The business's fee pays for the gas, and the relayer can swap that USDT for WBT on the same pool.

## Verifying contracts

Blockscout takes Foundry's `blockscout` verifier on the Etherscan-compatible endpoint:

```
forge verify-contract <address> contracts/src/CountersignedEscrow.sol:CountersignedEscrow \
  --chain 1874 --verifier blockscout \
  --verifier-url https://explorer.testnet.whitechain.io/api/ \
  --constructor-args <abi-encoded args>
```

The REST API also accepts `standard-input`, `multi-part` and `flattened-code` at `POST /api/v2/smart-contracts/{address}/verification/via/<method>`; `contract_name` is required there. `v0.8.28+commit.7893614a` and the `paris` EVM target are both on the explorer's list. Poll `GET /api/v2/smart-contracts/{address}` until `is_verified` is true.

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
