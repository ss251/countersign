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

Filled in as they land, each with its explorer link.

| Contract | Address | Tx |
|---|---|---|
| CountersignedEscrow | pending | |
