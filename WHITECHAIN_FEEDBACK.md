# Whitechain feedback

Written as we hit things during the build, newest at the bottom. Times are IST, Friday 6 November 2026.

## What worked

- **14:45** — The `whitechain-dev` skill gave us chain ID, RPC, explorer and the Blockscout verifier URL in one read. The RPC answered `cast chain-id` with `1874` on the first try.
- **14:50** — The explorer's API is easy to work with. `/api/v2/smart-contracts/{address}` named the proxy implementation (`TetherTokenV2`), and `/verification/config` listed every compiler and EVM target, so we could check verification would succeed before deploying anything.

- **15:02** — Forking 1874 locally worked well. We ran our escrow against the real `TetherTokenV2` and the live WWBT/USDT pool in a forge simulation before spending any gas, and the token's EIP-3009 `receiveWithAuthorization` behaved exactly as on USDC.
- **15:04** — Verification took one command. `forge script --verify --verifier blockscout --verifier-url https://explorer.testnet.whitechain.io/api/` verified both contracts (one of them with dynamic-array constructor args) about 20 seconds after deploy, with no API key.

## Where we got stuck

- **14:50** — Two different tokens called USDT. The prize requires `0xcedfB561…f55a7`, but the token list in the docs gives `0xaa7962d0…8f46` as USDT. That contract reports `USDT.e` (bridged from Tron). The docs never mention `0xcedf…`. We only confirmed it was the right token by reading its proxy and its minter (`USDTBridge`) on the explorer.
- **14:55** — We found no documented way to get `0xcedf…` USDT: no faucet and no bridge route in the docs. We found the WWBT/USDT Uniswap v3 pool by reading the token's transfer history, and we buy test USDT there with faucet WBT.
- **14:55** — The faucet amount is stated three ways. The docs and the help centre say 0.5 WBT per claim. The faucet's own `/api/info` says `"payout": "2"`.
- **14:58** — On `0xcedf…`, both `version()` and `eip712Domain()` revert, so anyone building EIP-3009 or permit signatures has to guess the EIP-712 domain version. We worked out `1` by recomputing `DOMAIN_SEPARATOR()` for each candidate.

- **15:06** — Two RPC hostnames differ by a single character. `rpc.testnet.whitechain.io` is Whitechain Sepolia (1874). `rpc-testnet.whitechain.io` is the old testnet (2625), and it still answers. On 2625 every balance we checked read zero, which looks like a funding failure rather than the wrong chain. A deprecation notice on the old host, or an error from it, would have saved us a scare.

## What the docs were missing

- A USDT page. It should give the prize token's address, its EIP-712 domain (`Tether USD`, version `1`), which EIP-3009 functions it supports, and how to get some for testing.
- Guidance for a signer that runs unattended. The skill rightly says never to paste keys and to use an interactive keystore. A gas relayer, though, has to sign with no human present. One paragraph on server-side key handling (env file at mode 0600, a separate hot wallet, a spending ceiling) would cover the relayer case the Scale track asks for.
- A licence file in `whitechain-labs/skills`. The README says MIT, but the repository has no `LICENSE`, so GitHub shows it as unlicensed.
