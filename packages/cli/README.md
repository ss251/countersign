# @countersign-hub/cli

`countersign` lets a software agent buy from, and sell to, other software, paying in test USDC on Arc. Each payment waits in an escrow until the seller's output checks out, and every purchase leaves a signed receipt, the slip, that anyone can verify without the hub.

This runs on the testnet only.

## Install

```sh
npx -y @countersign-hub/cli --help
```

It runs on Node 20 or later.

## Sign in

```sh
npx -y @countersign-hub/cli login
```

- **The page.** `login` opens a page on the countersign console. Sign in with Privy, by email or a passkey.
- **The code.** Check that the code on the page matches the one in your terminal, then click "Connect this CLI". Never approve a code you did not start yourself: whoever started it gets your agent wallet's session.
- **The wallet.** The CLI prints your agent wallet's address. The wallet is a Privy server wallet: you never see, paste or store a private key, and the CLI keeps only a session token.
- **The session.** `whoami` prints the address, and `logout` ends the session. A session lasts at most 7 days.

## Fund it

Send test USDC to the address `login` printed:
- from https://faucet.circle.com, choosing Arc Testnet and USDC;
- or from your own wallet.

On Arc the hub pays the gas, so USDC is all the agent needs.

## Buy

Set the agent's limits first. The hub signs nothing for your agent outside them:

```sh
npx -y @countersign-hub/cli envelope set --cap 0.5 --per-merchant 0.1 --ask-above 0.05
npx -y @countersign-hub/cli discover
npx -y @countersign-hub/cli buy <offer hash> --input '{"question":"what is arc?"}'
npx -y @countersign-hub/cli verify ~/.countersign/slips/<slip hash>.json --rpc https://rpc.testnet.arc.network
```

`buy` prints the seller's output, the slip hash and the release transaction on Arc. `verify` checks the slip on your own machine, and with `--rpc` it also reads the release from the chain.

## Sell

```sh
npx -y @countersign-hub/cli sell skill path/to/SKILL.md --price 10000
npx -y @countersign-hub/cli sell openapi --spec openapi.json --operation <operationId> --price 10000
```

- **How it connects.** The runner dials out to the hub, so you open no port. The offer is online only while it runs.
- **Price.** `--price` is in atomic units: `10000` is 0.01 USDC.
- **Payment.** Buyers pay your agent wallet's address.

## Claude, Cursor and other MCP clients

`countersign mcp` is a buyer MCP server over stdio. It signs through your login, so its config needs no key and no environment:

```json
{
  "mcpServers": {
    "countersign": {
      "command": "npx",
      "args": ["-y", "@countersign-hub/cli", "mcp"]
    }
  }
}
```

- **Its tools:** `search_offers`, `get_offer`, `buy`, `verify_slip`, `envelope_show` and `journal`.
- **The limits are the envelope's.** A model drives this server, so the envelope is what bounds it: keep the cap small. A call above `--ask-above` is held, and the model cannot approve it.
- **Offers are seller text.** Offer titles and descriptions are written by sellers, so treat them as data, not instructions.

## What signing in allows

The agent wallet is a Privy server wallet that the countersign app controls, and you hold no key to it. That makes the hub a delegated signer:
- it signs only for a signed-in CLI session, and only a payment into a known escrow, your offers and slips, or a runner's own messages;
- each payment stays inside your envelope.

`logout` ends your session, and the hub stops signing for it. Keep only small testnet amounts in the wallet.

**Not yet:**
- a Hedera wallet under the same login;
- a balance command;
- withdrawing back to your own wallet.

## More

- **Repository:** https://github.com/ss251/countersign
- **Getting started**, with the merchant paywall: `docs/onboarding.md` in the repository.
- **Names on npm:** only `@countersign-hub` is this project's. `countersign`, `countersign-mcp` and the `@countersign` scope belong to other projects.
- **License:** MIT.
